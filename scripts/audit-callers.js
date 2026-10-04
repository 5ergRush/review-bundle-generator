// Authored static-call expectations, with explicit negative/unsupported cases.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir, devNull } from 'node:os';
import { execFileSync } from 'node:child_process';
import { stringify } from 'yaml';
import { createReviewBundle, createReviewerRequest } from '../src/index.js';

const output = resolve(process.argv[2] ?? 'fixtures/acceptance'); await mkdir(output, { recursive: true });
const alias = "import { validate as check } from './target';\nexport function caller() { return check(-1); }\nfunction validate() { return true; }\nvalidate();\n";
const cases = [
  { id: 'deletion-only-target', before: alias, after: alias, old: 1, new: 1, pureDeletion: true },
  { id: 'aliased-import', before: alias, after: alias, old: 1, new: 1 },
  { id: 'new-caller', before: 'export const value = 1;\n', after: alias, old: 0, new: 1 },
  { id: 'same-name-only', before: 'function validate() { return true; }\nvalidate();\n', after: 'function validate() { return true; }\nvalidate();\n', old: 0, new: 0 },
  { id: 'indirect-variable-call', before: "import { validate } from './target';\nconst invoke = validate;\ninvoke(-1);\n", after: "import { validate } from './target';\nconst invoke = validate;\ninvoke(-1);\n", old: 0, new: 0, limitation: 'Runtime caller exists but variable indirection is not resolved by this static subset; zero matches is not proof of no callers.' },
];
const rulesYaml = stringify({ schemaVersion: 'review-rules/v3', rules: [{ id: 'amount-invariant', title: 'Review amount enforcement at callers', instruction: 'Check whether callers can pass non-positive amounts after this changed validation. Require actual caller evidence and consider alternative enforcement.', scope: { paths: ['src/target.ts'] }, when: { changedSyntax: [{ side: 'removed', kind: 'throw-guard', identifiers: ['amount'], within: 'validate' }] } }] });
const results = [];
for (const item of cases) {
  const repo = await mkdtemp(join(tmpdir(), 'review-caller-audit-'));
  try {
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull,
      GIT_AUTHOR_NAME: 'Acceptance', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Acceptance', GIT_COMMITTER_EMAIL: 'fixture@example.invalid', GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
    const git = (...args) => execFileSync('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'commit.gpgSign=false', ...args], { cwd: repo, env, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 }).trim();
    git('init', '-q', '--template=', '--initial-branch=main'); await mkdir(join(repo, 'src'));
    const before = "export function validate(amount: number) {\n  if (amount <= 0) throw new Error('invalid');\n  return true;\n}\n";
    const after = before.replace("  if (amount <= 0) throw new Error('invalid');\n", '');
    const targetAfter = item.pureDeletion ? after : after.replace('return true;', 'return amount >= 0;');
    const commit = async (target, caller) => { await writeFile(join(repo, 'src/target.ts'), target); await writeFile(join(repo, 'src/caller.ts'), caller); git('add', '-A'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
    const base = await commit(before, item.before); const head = await commit(targetAfter, item.after);
    const options = { repo, base, head, comparison: 'direct', semantic: true, rulesYaml };
    const initial = await createReviewBundle(options); assert.equal(initial.ruleSelection.decisions[0].status, 'matched');
    const requests = ['old', 'new'].map(side => {
      const declaration = initial.semanticAnalysis.declarations.find(d => d.side === side && d.name === 'validate' && d.origin.path === 'src/target.ts');
      if (item.pureDeletion && side === 'new') { assert.equal(declaration?.basis, 'structural-counterpart'); assert(initial.semanticAnalysis.counterparts.some(d => d.status === 'matched' && d.newTargetId === declaration.id)); }
      assert(declaration); return { kind: 'direct-callers', targetId: declaration.id };
    });
    const bundle = await createReviewBundle({ ...options, contextRequests: requests.filter(Boolean) });
    const packet = createReviewerRequest(bundle, { id: 'chatgpt-provisional', version: 'caller-acceptance-v1' });
    assert.equal(packet.selectedRules[0].id, 'amount-invariant'); assert.deepEqual(bundle.ruleSelection, initial.ruleSelection);
    const counts = {};
    for (const side of ['old', 'new']) {
      if (item[side] === null) { counts[side] = null; continue; }
      const decision = bundle.contextExpansion.decisions.find(d => d.targetId === requests[side === 'old' ? 0 : 1].targetId);
      assert.equal(decision.status, 'complete-static-matches'); assert.equal(decision.matches.length, item[side]); counts[side] = decision.matches.length;
      for (const match of decision.matches) {
        assert.equal(match.origin.path, 'src/caller.ts'); assert.equal(match.origin.commit, side === 'old' ? base : head); assert.equal(match.origin.start.line, 2); assert.equal(match.omission, null);
        const evidence = bundle.evidence.find(e => e.id === match.evidenceId); assert(evidence); assert.equal(evidence.origin.commit, match.origin.commit); assert(evidence.content.includes('check(-1)')); assert(!evidence.content.includes('function validate'));
      }
    }
    results.push({ caseId: item.id, status: item.limitation ? 'limitation-confirmed' : 'passed', expectedStaticMatches: { old: item.old, new: item.new }, observedStaticMatches: counts, ...(item.limitation ? { limitation: item.limitation } : {}) });
    await writeFile(join(output, `${item.id}.packet.json`), JSON.stringify(packet, null, 2) + '\n');
  } finally { await rm(repo, { recursive: true, force: true }); }
}
const report = { schemaVersion: 'caller-acceptance/v1', evidenceKind: 'authored-synthetic-real-git-static-analysis', results, contractChecksPassed: true, completeCallerCoverage: false, limitations: ['No framework/runtime execution or real corporate MR.', 'Rule selection is triggered by changed syntax, not by caller existence.', 'Caller evidence requires explicit requests; no automatic rule-directed expansion is implemented.', 'Only statically resolved pinned local symbols are returned; zero matches is not a completeness guarantee.'], reviewerImprovement: 'not-measured' };
await writeFile(join(output, 'caller-report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));

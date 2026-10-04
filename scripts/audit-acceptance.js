// Independent, authored expectations; never derive labels from compiler output.
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { stringify, parse } from 'yaml';
import { createReviewBundle, createReviewerRequest } from '../src/index.js';

const output = resolve(process.argv[2] ?? 'fixtures/acceptance');
await mkdir(output, { recursive: true });
const cases = JSON.parse(await readFile(new URL('../fixtures/acceptance/cases.json', import.meta.url), 'utf8'));
const angularRules = parse(await readFile(new URL('../examples/angular-invariant-rules.yaml', import.meta.url), 'utf8'));
const rules = stringify({ schemaVersion: 'review-rules/v3', rules: [
  { id: 'authorization-guard', title: 'Authorization invariant', instruction: 'The caller passes externally supplied roles. Verify that unauthorized roles cannot reach the protected action. A removed guard needs equivalent enforcement; request caller evidence rather than assume it.', scope: { paths: ['src/access.ts'] }, when: { minRemovedLines: 1, changedSyntax: [{ side: 'removed', kind: 'throw-guard', identifiers: ['role'] }] } },
  { id: 'money-boundary', title: 'Money invariant', instruction: 'Amounts passed to the payment boundary must remain positive integer minor units. Check validation changes, including zero, negative and fractional inputs; do not assume the UI enforces the invariant.', scope: { paths: ['src/payment.ts'] }, when: { minRemovedLines: 1, changedSyntax: [{ side: 'removed', kind: 'throw-guard', identifiers: ['amount'] }] } },
  ...angularRules.rules,
] });
const results = [];
for (const item of cases) {
  const repo = await mkdtemp(join(tmpdir(), 'review-acceptance-'));
  try {
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull,
      GIT_AUTHOR_NAME: 'Acceptance', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Acceptance', GIT_COMMITTER_EMAIL: 'fixture@example.invalid', GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
    const git = (...args) => execFileSync('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'commit.gpgSign=false', ...args], { cwd: repo, env, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 }).trim();
    git('init', '-q', '--template=', '--initial-branch=main'); await mkdir(join(repo, 'src'));
    await writeFile(join(repo, item.path), item.before); git('add', '-A'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
    await writeFile(join(repo, item.path), item.after); git('add', '-A'); git('commit', '-qm', 'head'); const head = git('rev-parse', 'HEAD');
    const bundle = await createReviewBundle({ repo, base, head, comparison: 'direct', rulesYaml: rules, semantic: true });
    assert.equal(bundle.changes.length, 1); const change = bundle.changes[0];
    assert.equal(change.status, 'M'); assert.equal(change.oldPath, item.path); assert.equal(change.newPath, item.path);
    const fact = bundle.facts.find(f => f.type === 'text-change');
    assert.equal(fact.value.addedLines, item.expectedAdded); assert.equal(fact.value.removedLines, item.expectedRemoved);
    const evidence = bundle.evidence.find(e => e.id === change.evidenceIds[0]);
    assert.equal(evidence.origin.old.commit, base); assert.equal(evidence.origin.new.commit, head);
    for (const line of item.requiredPatchLines) assert(evidence.content.split('\n').includes(line), `${item.id}: missing exact evidence`);
    const packet = createReviewerRequest(bundle, { id: 'chatgpt-provisional', version: 'acceptance-v1' });
    const selected = packet.selectedRules.map(r => r.id).sort();
    assert.deepEqual(selected, bundle.ruleSelection.decisions.filter(d => d.status === 'matched').map(d => d.ruleId).sort());
    const falseSelections = selected.filter(id => !item.expectedRules.includes(id));
    const missedRules = item.expectedRules.filter(id => !selected.includes(id));
    results.push({ caseId: item.id, facts: 'passed', packetIntegrity: 'passed', expectedRules: item.expectedRules, selectedRules: selected, falseSelections, missedRules, specificity: falseSelections.length || missedRules.length ? 'failed' : 'passed' });
    await writeFile(join(output, `${item.id}.packet.json`), JSON.stringify(packet, null, 2) + '\n');
    await writeFile(join(output, `${item.id}.diff.patch`), evidence.content);
  } finally { await rm(repo, { recursive: true, force: true }); }
}
const report = { schemaVersion: 'acceptance-audit/v1', evidenceKind: 'authored-synthetic-cases-with-real-git-and-compiler', priority: 'facts-and-rule-specificity-first', results,
  factsPassed: results.every(r => r.facts === 'passed'), packetIntegrityPassed: results.every(r => r.packetIntegrity === 'passed'), specificityPassed: results.every(r => r.specificity === 'passed'),
  reviewerImprovement: 'not-measured', limitations: ['Not real corporate MRs or Angular runtime validation.', 'Expected relevance is authored policy, not proof of a defect.', 'No AI reviewer responses or quality deltas are fabricated.', 'Same-author unblinded reviews cannot establish independent improvement.'] };
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
// Version 2 now has an acceptance gate for the fixed authored relevance cases.
assert.equal(report.specificityPassed, true, 'Rule specificity acceptance failed; inspect report.json.');

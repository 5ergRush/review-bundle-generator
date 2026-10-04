import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { stringify } from 'yaml';
import { createHash } from 'node:crypto';
import { createReviewBundle, createReviewerRequest, parseRulesYaml } from '../src/index.js';
import { observeChangedSyntax } from '../src/changed-syntax.js';

const predicate = { side: 'removed', kind: 'throw-guard', identifiers: ['role'] };
const rules = (conditions = [predicate], version = 'review-rules/v2', scope = { paths: ['src/**'] }) => stringify({ schemaVersion: version, rules: [{ id: 'policy', title: 'Check invariant', instruction: 'Check authorization against supplied evidence.', scope, when: { changedSyntax: JSON.parse(JSON.stringify(conditions)) } }] });
const wrap = body => `export function action(role: string) {\n${body}\n  return true;\n}\n`;
const guard = "  if (role !== 'admin') throw new Error('denied');";
async function run(t, before, after, yaml = rules(), file = 'src/access.ts') {
  const repo = await mkdtemp(join(tmpdir(), 'review-syntax-')); t.after(() => rm(repo, { recursive: true, force: true }));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull,
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = (...args) => execFileSync('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'commit.gpgSign=false', ...args], { cwd: repo, env, encoding: 'utf8', timeout: 10000 }).trim();
  git('init', '-q', '--template=', '--initial-branch=main'); await mkdir(join(repo, 'src'));
  const commit = content => { execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: repo }); return writeFile(join(repo, file), content).then(() => { git('add', '-A'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); }); };
  const base = await commit(before); const head = await commit(after);
  const bundle = await createReviewBundle({ repo, base, head, comparison: 'direct', rulesYaml: yaml });
  const packet = createReviewerRequest(bundle, { id: 'test', version: 'v2' });
  return { bundle, packet, decision: bundle.ruleSelection.decisions[0] };
}

test('v1 rejects new predicates; v2 validates fields and normalizes predicate ordering', () => {
  assert.throws(() => parseRulesYaml(rules([predicate], 'review-rules/v1')), { code: 'INVALID_RULES' });
  const added = { ...predicate, side: 'added' };
  assert.deepEqual(parseRulesYaml(rules([predicate, added, predicate])), parseRulesYaml(rules([added, predicate])));
  for (const bad of [{ ...predicate, side: 'both' }, { ...predicate, kind: 'eval' }, { ...predicate, identifiers: ['a.b'] }, { ...predicate, callee: 'foo' }, { side: 'added', kind: 'call' }, { side: 'added', kind: 'call', callee: 'a[0]' }, { ...predicate, extra: true }]) assert.throws(() => parseRulesYaml(rules([bad])), { code: 'INVALID_RULES' });
});

test('removed guard is selected with exact evidence coordinates and survives packet validation', async t => {
  const r = await run(t, wrap(guard), wrap(''));
  assert.equal(r.bundle.ruleSelection.schemaVersion, 'rule-selection/v2'); assert.equal(r.decision.status, 'matched');
  const observed = r.decision.matches[0].syntaxMatches[0][0];
  assert.equal(observed.startLine, 2); assert.equal(observed.endLine, 2); assert.equal(observed.side, 'removed');
  assert.equal(observed.evidenceId, r.bundle.evidence[0].id); assert.equal(r.packet.selectedRules.length, 1);
});

for (const [name, before, after] of [
  ['comment after guard', wrap(guard), wrap(guard + ' // unchanged')],
  ['guard-like comment', wrap('// if (role) throw new Error();'), wrap('// harmless')],
  ['guard-like string', wrap('const label = "if (role) throw new Error();";'), wrap('const label = "hello";')],
  ['unrelated body edit', wrap(guard), wrap(guard).replace('return true', 'return false')],
  ['guard formatting', wrap(guard), wrap(guard.replace('if (role', 'if( role'))],
  ['unrelated guard identifier', wrap(guard.replaceAll('role', 'user')), wrap('')],
]) test(`${name} does not trigger authorization selector`, async t => {
  const r = await run(t, before, after); assert.equal(r.decision.status, 'skipped'); assert.equal(r.decision.reason, 'changed-syntax-not-matched'); assert.equal(r.packet.selectedRules.length, 0);
});

test('condition replacement and added guard have independent old/new observations', async t => {
  const changed = guard.replace("'admin'", "'guest'");
  const r = await run(t, wrap(guard), wrap(changed), rules([predicate, { ...predicate, side: 'added' }]));
  assert.equal(r.decision.status, 'matched'); assert.equal(r.decision.matches[0].syntaxMatches.length, 2);
});

test('call predicate matches actual changed literal callee, excludes same name strings', async t => {
  const condition = { side: 'added', kind: 'call', callee: 'Number.isInteger', identifiers: ['amount'] };
  const positive = await run(t, 'export const amount = 1;\n', 'export const amount = Number.isInteger(1);\n', rules([{ ...condition, identifiers: undefined }]));
  assert.equal(positive.decision.status, 'matched');
  const negative = await run(t, 'export const label = "old";\n', 'export const label = "Number.isInteger(amount)";\n', rules([condition]));
  assert.equal(negative.decision.status, 'skipped');
});

test('all predicates must pass the same change', async t => {
  const r = await run(t, wrap(guard), wrap(''), rules([predicate, { side: 'added', kind: 'call', callee: 'audit' }]));
  assert.equal(r.decision.status, 'skipped');
});

test('incomplete hunk context is explicitly unavailable, never treated as proof of absence', async t => {
  const padding = Array.from({ length: 20 }, (_, i) => `  const x${i} = ${i};`).join('\n');
  const r = await run(t, wrap(padding + '\n' + guard), wrap(padding + '\n'));
  assert.equal(r.decision.status, 'skipped'); assert.equal(r.decision.reason, 'syntax-evidence-unavailable');
});

test('non-TypeScript context is explicitly unsupported', async t => {
  const r = await run(t, wrap(guard), wrap(''), rules(), 'src/access.js');
  assert.equal(r.decision.reason, 'syntax-evidence-unavailable');
});

test('duplicate syntactic guards retain occurrence counts', async t => {
  const r = await run(t, wrap(guard + '\n' + guard), wrap(guard)); assert.equal(r.decision.status, 'matched');
});

test('forged decisions fail imported packet validation even with recomputed bundle ID', async t => {
  const r = await run(t, wrap(guard), wrap('')); const copy = structuredClone(r.bundle);
  copy.ruleSelection.decisions[0].matches[0].syntaxMatches[0][0].startLine = 99;
  const { id, ...payload } = copy; copy.id = 'bundle:' + createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  assert.throws(() => createReviewerRequest(copy, { id: 'test', version: 'v2' }), { code: 'INVALID_REVIEW_BUNDLE' });
});

test('oversized hunk side yields unavailable and token work consumes deterministic budget', () => {
  const change = { oldPath: 'a.ts', newPath: 'a.ts', coverage: 'text-diff', evidenceIds: ['e'] };
  const evidence = [{ id: 'e', type: 'git-patch', content: '@@ -1 +1 @@\n-' + 'a'.repeat(128 * 1024 + 1) + '\n+x\n' }];
  const r = observeChangedSyntax(change, evidence, () => {}); assert.equal(r.available, false);
  assert.throws(() => observeChangedSyntax(change, evidence, () => { throw new Error('budget'); }), /budget/u);
});

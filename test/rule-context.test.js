import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { stringify } from 'yaml';
import { createRuleContextBundle, createReviewerRequest } from '../src/index.js';

const rule = (id, extra = {}) => ({ id, title: id, instruction: 'Check validation and actual callers.', scope: { paths: ['target.ts'] }, when: { changedSyntax: [{ side: 'removed', kind: 'throw-guard', identifiers: ['amount'], within: 'validate' }] }, ...extra });
const policy = (ruleId = 'amount') => ({ ruleId, kind: 'direct-callers', sides: ['old', 'new'] });
const before = "export function validate(amount: number) {\n  if (amount <= 0) throw new Error('invalid');\n  return true;\n}\nexport function other(amount: number) {\n  if (amount <= 0) throw new Error('other');\n  return true;\n}\n";
async function fixture(t, { old = before, next = before.replace("  if (amount <= 0) throw new Error('invalid');\n", '').replace("  if (amount <= 0) throw new Error('other');\n", ''), rules = [rule('amount')], version = 'review-rules/v3' } = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'review-rule-context-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = (...args) => execFileSync('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'commit.gpgSign=false', ...args], { cwd: repo, env, encoding: 'utf8' }).trim();
  git('init', '-q', '--template=', '--initial-branch=main');
  const put = (path, content) => writeFile(join(repo, path), content);
  const commit = async content => { await put('target.ts', content); git('add', '-A'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  await put('caller.ts', "import { validate as check, other } from './target';\ncheck(-1);\nother(-1);\n");
  const base = await commit(old); const head = await commit(next);
  return { repo, put, commit, options: { repo, base, head, comparison: 'direct', rulesYaml: stringify({ schemaVersion: version, rules }), contextPolicy: [policy()] } };
}

test('automatic syntax anchors choose one function among two edited functions and pin both caller revisions', async t => {
  const f = await fixture(t); const result = await createRuleContextBundle(f.options);
  assert.equal(result.schemaVersion, 'rule-context-bundle/v1'); assert(Object.isFrozen(result.contextPlan));
  assert.equal(result.contextPlan.requests.length, 2); assert.equal(result.contextPlan.decisions[0].omissions.length, 0);
  for (const target of result.contextPlan.decisions[0].targets) {
    const declaration = result.bundle.semanticAnalysis.declarations.find(item => item.id === target.targetId);
    assert.equal(declaration.name, 'validate'); assert.equal(target.anchor.within, 'validate');
    assert.equal(target.commit, target.side === 'old' ? f.options.base : f.options.head);
    const expansion = result.bundle.contextExpansion.decisions.find(item => item.targetId === target.targetId);
    assert.equal(expansion.matches.length, 1); assert.equal(expansion.matches[0].origin.start.line, 2);
  }
  assert.equal(createReviewerRequest(result.bundle, { id: 'test', version: '1' }).selectedRules[0].id, 'amount');
  const requestIds = result.contextPlan.requests.map(item => item.targetId);
  assert(requestIds.every(id => result.bundle.semanticAnalysis.declarations.find(d => d.id === id).name === 'validate'));
  await f.put('target.ts', 'dirty'); await f.put('caller.ts', 'dirty');
  assert.deepEqual(await createRuleContextBundle(f.options), result);
});

test('two selected rules deduplicate requests while retaining both rule sources and deterministic target omissions', async t => {
  const f = await fixture(t, { rules: [rule('amount'), rule('second')] });
  f.options.contextPolicy.push(policy('second'));
  const result = await createRuleContextBundle({ ...f.options, maxTargets: 1 });
  assert.equal(result.contextPlan.requests.length, 1); assert.equal(result.contextPlan.omittedTargetIds.length, 1);
  for (const decision of result.contextPlan.decisions) {
    assert.equal(decision.targets.filter(item => item.reason === 'target-limit').length, 1);
    assert.equal(decision.targets.filter(item => item.status === 'requested').length, 1);
  }
  const reversed = { ...f.options, maxTargets: 1, contextPolicy: [...f.options.contextPolicy].reverse().map(item => ({ ...item, sides: [...item.sides].reverse() })) };
  assert.deepEqual(await createRuleContextBundle(reversed), result);
  assert.deepEqual(f.options.contextPolicy[0].sides, ['old', 'new']);
});

test('skipped and disabled rules request no callers; path-only matches have explicit omissions', async t => {
  const f = await fixture(t, { rules: [rule('amount', { enabled: false }), rule('missing', { scope: { paths: ['absent.ts'] } }), rule('path', { when: {} })] });
  f.options.contextPolicy = ['amount', 'missing', 'path'].map(policy);
  const result = await createRuleContextBundle(f.options);
  assert.equal(result.contextPlan.requests.length, 0);
  assert.deepEqual(result.contextPlan.decisions.map(d => d.omissions[0].reason), ['rule-not-selected', 'rule-not-selected', 'syntax-anchor-required']);
  assert.equal(result.bundle.coverage.stages.contextExpansion, 'not-requested');
});

test('whole-function removal cannot request new-side adjacent function callers', async t => {
  const adjacent = 'export function other(amount: number) { return true; }\n';
  const f = await fixture(t, { old: before.slice(0, before.indexOf('export function other')) + adjacent, next: adjacent });
  const result = await createRuleContextBundle(f.options);
  assert.equal(result.contextPlan.requests.length, 1);
  assert.equal(result.contextPlan.decisions[0].targets[0].side, 'old');
  assert.equal(result.contextPlan.decisions[0].omissions[0].reason, 'missing');
  assert.equal(result.contextPlan.decisions[0].omissions[0].side, 'new');
});

test('anonymous callbacks cannot inherit their enclosing named function as a caller target', async t => {
  const old = "export function validate(amount: number) {\n  [1].map(() => {\n    if (amount <= 0) throw new Error('invalid');\n    return amount;\n  });\n}\n";
  const f = await fixture(t, { old, next: old.replace("    if (amount <= 0) throw new Error('invalid');\n", ''), rules: [rule('amount', { when: { changedSyntax: [{ side: 'removed', kind: 'throw-guard', identifiers: ['amount'] }] } })] });
  const result = await createRuleContextBundle(f.options);
  assert.equal(result.contextPlan.decisions[0].selectionStatus, 'matched');
  assert.equal(result.contextPlan.requests.length, 0);
  assert.equal(result.contextPlan.decisions[0].omissions[0].reason, 'named-scope-unavailable');
});

test('legacy v2 syntax selects a rule but omits caller planning without nearest scope provenance', async t => {
  const f = await fixture(t, { version: 'review-rules/v2', rules: [rule('amount', { when: { changedSyntax: [{ side: 'removed', kind: 'throw-guard', identifiers: ['amount'] }] } })] });
  const result = await createRuleContextBundle(f.options);
  assert.equal(result.contextPlan.decisions[0].selectionStatus, 'matched'); assert.equal(result.contextPlan.requests.length, 0);
  assert.equal(result.contextPlan.decisions[0].omissions[0].reason, 'named-scope-unavailable');
});

test('named methods use their own caller targets rather than the containing class', async t => {
  const old = "export class Service {\n  validate(amount: number) {\n    if (amount <= 0) throw new Error('invalid');\n    return amount;\n  }\n}\n";
  const f = await fixture(t, { old, next: old.replace("    if (amount <= 0) throw new Error('invalid');\n", '') });
  const result = await createRuleContextBundle(f.options);
  assert.equal(result.contextPlan.requests.length, 2);
  for (const request of result.contextPlan.requests) assert.equal(result.bundle.semanticAnalysis.declarations.find(item => item.id === request.targetId).kind, 'MethodDeclaration');
});

test('added-only callable requests only new callers and records unavailable old association', async t => {
  const f = await fixture(t, { old: 'export const initial = 1;\n', next: before.slice(0, before.indexOf('export function other')), rules: [rule('amount', { when: { changedSyntax: [{ side: 'added', kind: 'throw-guard', identifiers: ['amount'], within: 'validate' }] } })] });
  const result = await createRuleContextBundle(f.options);
  assert.equal(result.contextPlan.requests.length, 1); assert.equal(result.contextPlan.decisions[0].targets[0].side, 'new');
  assert.equal(result.contextPlan.decisions[0].omissions[0].reason, 'counterpart-unavailable');
});

test('full source parse errors outside otherwise valid patch anchors explicitly omit callers', async t => {
  const suffix = '// spacing\n'.repeat(12) + 'function broken( {\n';
  const target = before.slice(0, before.indexOf('export function other'));
  const f = await fixture(t, { old: target + suffix, next: target.replace("  if (amount <= 0) throw new Error('invalid');\n", '') + suffix });
  const result = await createRuleContextBundle(f.options);
  assert.equal(result.contextPlan.decisions[0].selectionStatus, 'matched'); assert.equal(result.contextPlan.requests.length, 0);
  assert.equal(result.contextPlan.decisions[0].omissions[0].reason, 'parse-unavailable');
});

test('strict trusted policy rejects unknown, duplicate, malformed, executable and oversized inputs', async t => {
  const f = await fixture(t);
  for (const contextPolicy of [[policy('unknown')], [policy(), policy()], [{ ...policy(), kind: 'recursive-callers' }], [{ ...policy(), sides: ['old', 'old'] }], [{ ...policy(), extra: true }], null, Array(51).fill(policy())]) {
    await assert.rejects(createRuleContextBundle({ ...f.options, contextPolicy }), { code: 'INVALID_CONTEXT_POLICY' });
  }
  let accessed = false; const evil = {}; Object.defineProperty(evil, 'ruleId', { enumerable: true, get() { accessed = true; return 'amount'; } });
  await assert.rejects(createRuleContextBundle({ ...f.options, contextPolicy: [evil] }), { code: 'INVALID_CONTEXT_POLICY' }); assert.equal(accessed, false);
  await assert.rejects(createRuleContextBundle({ ...f.options, contextPolicy: ['x'.repeat(256 * 1024 + 1)] }), { code: 'CONTEXT_LIMIT' });
  for (const maxTargets of [0, 51, 1.5]) await assert.rejects(createRuleContextBundle({ ...f.options, maxTargets }), { code: 'INVALID_CONTEXT_POLICY' });
  await assert.rejects(createRuleContextBundle({ ...f.options, semantic: true }), { code: 'INVALID_CONTEXT_POLICY' });
  await assert.rejects(createRuleContextBundle({ ...f.options, contextRequests: [] }), { code: 'INVALID_CONTEXT_POLICY' });
  await assert.rejects(createRuleContextBundle({ ...f.options, maxEnvelopeBytes: 1 }), { code: 'CONTEXT_LIMIT' });
});

test('CLI shape emits compatible inner bundle and JSON failures for bad context policy', async t => {
  const f = await fixture(t); await f.put('rules.yaml', f.options.rulesYaml); await f.put('policy.json', JSON.stringify(f.options.contextPolicy));
  const args = [resolve('src/cli.js'), 'rule-context-bundle', '--repo', f.repo, '--base', f.options.base, '--head', f.options.head, '--rules', join(f.repo, 'rules.yaml'), '--context-policy', join(f.repo, 'policy.json')];
  const run = spawnSync(process.execPath, args, { encoding: 'utf8' }); assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout); assert.equal(result.contextPlan.requests.length, 2);
  createReviewerRequest(result.bundle, { id: 'test', version: '1' });
  await f.put('policy.json', JSON.stringify([policy('bad')]));
  const bad = spawnSync(process.execPath, args, { encoding: 'utf8' }); assert.equal(bad.status, 1); assert.equal(bad.stdout, ''); assert.equal(JSON.parse(bad.stderr).error.code, 'INVALID_CONTEXT_POLICY');
});

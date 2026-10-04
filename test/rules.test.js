import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { stringify } from 'yaml';
import { parseRulesYaml, createReviewBundle, compileReviewBundle, ingestGitDiff } from '../src/index.js';
import { readRulesFile, selectRules, MAX_RULE_BYTES } from '../src/rules.js';

const rule = (id = 'test-rule', extra = {}) => ({ id, title: 'Check this change', instruction: 'Check the changed behavior using the supplied evidence.', scope: { paths: ['**'] }, ...extra });
const yaml = rules => stringify({ schemaVersion: 'review-rules/v1', rules });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'review-rules-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env,
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } }).trim();
  git('init', '-q', '--initial-branch=main');
  const put = async (path, content) => { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), content); };
  const commit = message => { git('add', '-A'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
  await put('src/service.ts', 'old\n'); await put('src/service.spec.ts', 'old test\n'); await put('src/rename.ts', 'rename\n');
  const base = commit('base');
  await put('src/service.ts', 'new\nsecond\n'); await put('src/service.spec.ts', 'new test\n');
  await put('src/binary.ts', Buffer.from([0, 255, 0]));
  await mkdir(join(root, 'tests'));
  await rename(join(root, 'src/rename.ts'), join(root, 'tests/rename.js'));
  commit('head');
  return { root, base, git, put, commit };
}

test('strict YAML normalization gives stable config IDs across comments, ordering and defaults', () => {
  const a = parseRulesYaml(yaml([rule('z-rule'), rule('a-rule')]));
  const b = parseRulesYaml('# comment\n' + yaml([rule('a-rule', { enabled: true, severity: 'warning',
    scope: { paths: ['**', '**'], excludePaths: [], statuses: ['T', 'R', 'D', 'M', 'A'], entryKinds: ['file'] } }), rule('z-rule')]));
  assert.deepEqual(a, b);
  assert.deepEqual(a.rules.map(r => r.id), ['a-rule', 'z-rule']);
  assert.notEqual(parseRulesYaml(yaml([rule('a-rule', { instruction: 'Different instruction.' }), rule('z-rule')])).id, a.id);
});

test('rejects ambiguous YAML, unsafe features, directives and structural abuse', () => {
  for (const source of ['schemaVersion: review-rules/v1\nrules: []\nrules: []',
    'schemaVersion: review-rules/v1\nrules: []\n---\nrules: []',
    '%YAML 1.1\n---\nschemaVersion: review-rules/v1\nrules: []',
    'schemaVersion: review-rules/v1\nrules: &r []',
    'schemaVersion: review-rules/v1\nrules: *missing',
    'schemaVersion: review-rules/v1\nrules: !!seq []',
    'schemaVersion: review-rules/v1\nrules: !custom []', 'rules: [unfinished']) {
    assert.throws(() => parseRulesYaml(source), { code: 'INVALID_YAML' });
  }
  assert.throws(() => parseRulesYaml('x: ' + '['.repeat(20) + 'a' + ']'.repeat(20)), { code: 'RULE_INPUT_LIMIT' });
  assert.throws(() => parseRulesYaml('x'.repeat(MAX_RULE_BYTES + 1)), { code: 'RULE_INPUT_LIMIT' });
});

test('rejects invalid schemas, duplicate rule IDs, unknown keys and mistyped conditions', () => {
  const bad = [rule('Bad ID'), rule('test', { enabled: null }), rule('test', { enabled: 'yes' }),
    rule('test', { severity: 'fatal' }), rule('test', { severity: null }), rule('test', { instruction: '' }),
    rule('test', { scope: { paths: ['**'], language: 'typescript' } }),
    rule('test', { scope: { paths: ['**'], statuses: null } }), rule('test', { scope: { paths: ['**'], entryKinds: null } }),
    rule('test', { scope: { paths: ['**'], extensions: ['.TS'] } }), rule('test', { when: { minAddedLines: '1' } }),
    rule('test', { when: { minRemovedLines: -1 } }), rule('test', { script: 'do-not-execute' })];
  for (const r of bad) assert.throws(() => parseRulesYaml(yaml([r])), { code: 'INVALID_RULES' });
  assert.throws(() => parseRulesYaml(yaml([rule(), rule()])), { code: 'INVALID_RULES' });
  assert.throws(() => parseRulesYaml('schemaVersion: unknown\nrules: []'), { code: 'INVALID_RULES' });
  assert.throws(() => parseRulesYaml(yaml(Array.from({ length: 251 }, (_, i) => rule(`rule-${i}`)))), { code: 'INVALID_RULES' });
});

test('restricted glob validation rejects unsupported syntax and traversal', () => {
  for (const pattern of ['/src/**', '../src/**', 'src//**', './src/**', 'a**b', 'src\\**', '**/*.{ts,js}', '**/[ab].ts', '!tests/**', 'src/\n.ts']) {
    assert.throws(() => parseRulesYaml(yaml([rule('test', { scope: { paths: [pattern] } })])), { code: 'INVALID_RULES' });
  }
});

test('v2 selection records matching change/evidence/fact links and excludes tests', async (t) => {
  const f = await fixture(t);
  const bundle = await createReviewBundle({ repo: f.root, base: f.base, rulesYaml: yaml([
    rule('typescript-change', { scope: { paths: ['src/**/*.ts'], excludePaths: ['**/*.spec.ts'], statuses: ['M'], extensions: ['.ts'] }, when: { minAddedLines: 2, minRemovedLines: 1 } }),
  ]) });
  assert.equal(bundle.schemaVersion, 'review-bundle/v2');
  assert.equal(bundle.coverage.stages.ruleSelection, 'complete');
  assert.equal(bundle.coverage.stages.semanticAnalysis, 'not-run');
  const decision = bundle.ruleSelection.decisions[0];
  assert.equal(decision.status, 'matched'); assert.equal(decision.matches.length, 1);
  const match = decision.matches[0];
  assert.equal(bundle.changes.find(c => c.id === match.changeId).newPath, 'src/service.ts');
  assert(match.evidenceIds.every(id => bundle.evidence.some(e => e.id === id)));
  assert(match.conditionFactIds.every(id => bundle.facts.some(f => f.id === id && f.type === 'text-change')));
});

test('every skipped rule has stable reasons, including unavailable text evidence', async (t) => {
  const f = await fixture(t);
  const rules = [rule('disabled', { enabled: false }), rule('missing-path', { scope: { paths: ['backend/**'] } }),
    rule('wrong-status', { scope: { paths: ['**'], statuses: ['D'] } }),
    rule('too-many-lines', { scope: { paths: ['src/service.ts'] }, when: { minAddedLines: 100 } }),
    rule('binary-threshold', { scope: { paths: ['src/binary.ts'] }, when: { minAddedLines: 0 } })];
  const bundle = await createReviewBundle({ repo: f.root, base: f.base, rulesYaml: yaml(rules) });
  assert.deepEqual(Object.fromEntries(bundle.ruleSelection.decisions.map(d => [d.ruleId, d.reason])), {
    'binary-threshold': 'text-evidence-unavailable', disabled: 'disabled', 'missing-path': 'scope-not-matched',
    'too-many-lines': 'line-threshold-not-met', 'wrong-status': 'status-not-matched' });
  assert(bundle.ruleSelection.decisions.every(d => d.status === 'skipped' && d.matches.length === 0));
});

test('rename scope conditions apply to the same side, not a mix of old/new paths', async (t) => {
  const f = await fixture(t);
  const bundle = await createReviewBundle({ repo: f.root, base: f.base, rulesYaml: yaml([
    rule('old-source', { scope: { paths: ['src/**'], extensions: ['.ts'], statuses: ['R'] } }),
    rule('new-test', { scope: { paths: ['tests/**'], extensions: ['.js'], statuses: ['R'] } }),
    rule('cross-side', { scope: { paths: ['src/**'], extensions: ['.js'], statuses: ['R'] } }),
  ]) });
  const decisions = Object.fromEntries(bundle.ruleSelection.decisions.map(d => [d.ruleId, d]));
  assert.equal(decisions['cross-side'].status, 'skipped');
  assert.deepEqual(decisions['old-source'].matches[0].matchedPaths, [{ side: 'old', path: 'src/rename.ts' }]);
  assert.deepEqual(decisions['new-test'].matches[0].matchedPaths, [{ side: 'new', path: 'tests/rename.js' }]);
});

test('glob star/question/globstar match Unicode, root files and nested paths literally', () => {
  const config = parseRulesYaml(yaml([rule('glob', { scope: { paths: ['**/?.ts'] } })]));
  const changes = ['ա.ts', 'nested/x.ts', 'nested/deep/y.ts', 'nested/xx.ts', 'foo.js'].map((path, i) => ({ id: `${i}`, status: 'A', oldPath: null, newPath: path, oldKind: null, newKind: 'file', evidenceIds: [`e${i}`] }));
  assert.deepEqual(selectRules(config, changes, []).decisions[0].matches.map(m => m.changeId), ['0', '1', '2']);
});

test('default scopes exclude special entries; explicit entryKinds include them', async (t) => {
  const f = await fixture(t);
  const base = f.git('rev-parse', 'HEAD');
  f.git('update-index', '--add', '--cacheinfo', `160000,${base},submodule`); f.git('commit', '-qm', 'gitlink');
  const bundle = await createReviewBundle({ repo: f.root, base, rulesYaml: yaml([
    rule('default-file'), rule('special', { scope: { paths: ['**'], entryKinds: ['gitlink'] } }),
    rule('special-text', { scope: { paths: ['**'], entryKinds: ['gitlink'] }, when: { minAddedLines: 0 } }),
  ]) });
  assert.equal(bundle.ruleSelection.decisions.find(d => d.ruleId === 'default-file').status, 'skipped');
  assert.equal(bundle.ruleSelection.decisions.find(d => d.ruleId === 'special').status, 'matched');
  assert.equal(bundle.ruleSelection.decisions.find(d => d.ruleId === 'special-text').reason, 'text-evidence-unavailable');
});

test('no-rules output stays v1; empty supplied rules are a completed empty selection', async (t) => {
  const f = await fixture(t);
  const snapshot = await ingestGitDiff({ repo: f.root, base: f.base });
  const original = compileReviewBundle(snapshot);
  assert.equal(original.schemaVersion, 'review-bundle/v1'); assert.equal(original.ruleSelection, undefined);
  const empty = compileReviewBundle(snapshot, { rulesYaml: yaml([]) });
  assert.equal(empty.schemaVersion, 'review-bundle/v2'); assert.deepEqual(empty.ruleSelection.decisions, []);
  assert.notEqual(empty.id, original.id);
  const noChanges = await createReviewBundle({ repo: f.root, base: 'HEAD', rulesYaml: yaml([rule()]) });
  assert.equal(noChanges.ruleSelection.decisions[0].reason, 'no-changes');
});

test('semantic config ordering/comments do not change bundle identity; instructions do', async (t) => {
  const f = await fixture(t);
  const snapshot = await ingestGitDiff({ repo: f.root, base: f.base });
  const a = compileReviewBundle(snapshot, { rulesYaml: yaml([rule('z'), rule('a')]) });
  const b = compileReviewBundle(snapshot, { rulesYaml: '# ignored comment\n' + yaml([rule('a'), rule('z')]) });
  assert.deepEqual(a, b);
  assert.notEqual(compileReviewBundle(snapshot, { rulesYaml: yaml([rule('a', { instruction: 'Changed instructions.' }), rule('z')]) }).id, a.id);
  assert.throws(() => compileReviewBundle(snapshot, { rulesYaml: yaml([rule()]), maxBundleBytes: 1 }), { code: 'BUNDLE_LIMIT' });
});

test('selection operation/path limits fail without partial decisions', () => {
  const config = parseRulesYaml(yaml([rule()]));
  const change = { id: 'c', status: 'A', oldPath: null, newPath: 'x'.repeat(4097), oldKind: null, newKind: 'file', evidenceIds: [] };
  assert.throws(() => selectRules(config, [change], []), { code: 'SELECTION_LIMIT' });
  const expensive = parseRulesYaml(yaml([rule('a', { scope: { paths: ['*'] } }), rule('b', { scope: { paths: ['*'] } }), rule('c', { scope: { paths: ['*'] } })]));
  assert.throws(() => selectRules(expensive, Array.from({ length: 500 }, (_, i) => ({ ...change, id: `${i}`, newPath: 'x'.repeat(4000) })), []), { code: 'SELECTION_LIMIT' });
});

test('bounded rule file reads and CLI rules integration report explicit errors', async (t) => {
  const f = await fixture(t);
  const rulesPath = join(f.root, 'rules.yaml');
  await writeFile(rulesPath, yaml([rule()]));
  assert.equal(parseRulesYaml(await readRulesFile(rulesPath)).rules.length, 1);
  const cli = resolve('src/cli.js');
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const good = run('bundle', '--repo', f.root, '--base', f.base, '--rules', rulesPath);
  assert.equal(good.status, 0); assert.equal(JSON.parse(good.stdout).schemaVersion, 'review-bundle/v2');
  await writeFile(rulesPath, 'rules: [broken');
  const bad = run('bundle', '--repo', f.root, '--base', f.base, '--rules', rulesPath);
  assert.equal(bad.status, 1); assert.equal(bad.stdout, ''); assert.equal(JSON.parse(bad.stderr).error.code, 'INVALID_YAML');
  assert.equal(run('ingest', '--rules', rulesPath).status, 1);
  await writeFile(rulesPath, Buffer.from([0xff]));
  await assert.rejects(readRulesFile(rulesPath), { code: 'INVALID_YAML' });
  await writeFile(rulesPath, 'x'.repeat(MAX_RULE_BYTES + 1));
  await assert.rejects(readRulesFile(rulesPath), { code: 'RULE_INPUT_LIMIT' });
  await assert.rejects(readRulesFile(f.root), { code: 'INVALID_RULE_FILE' });
  await assert.rejects(readRulesFile(join(f.root, 'missing')), { code: 'INVALID_RULE_FILE' });
});

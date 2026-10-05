import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReviewBundle, parseRulesYaml, compileReviewBundle, ingestGitDiff, createReviewerRequest, createRuleContextBundle,
  normalizeGitLabMergeRequest, createGitLabReviewBundle, auditReviewBundle } from '../src/index.js';

const predicate = { side: 'removed', kind: 'member-call', callee: 'this.subscription.unsubscribe', within: 'ngOnDestroy', angularComponent: true };
const yaml = (predicates = [predicate], version = 'review-rules/v4') => JSON.stringify({ schemaVersion: version, rules: [{ id: 'teardown', title: 'Component teardown', instruction: 'Check equivalent cleanup.', scope: { paths: ['*.ts'] }, when: { changedSyntax: predicates } }] });
const source = (imports = "import { Component as View } from '@angular/core';", decorator = '@View({})', name = 'Panel') => `${imports}\n${decorator}\nexport class ${name} {\n ngOnDestroy() {\n  this.subscription.unsubscribe();\n }\n}\n`;
const remove = text => text.replace('  this.subscription.unsubscribe();\n', '');
const identity = { id: 'component-contract', version: '1' };
const selected = bundle => bundle.ruleSelection.decisions[0];
const clone = value => JSON.parse(JSON.stringify(value));
async function fixture(t, before = source(), after = remove(before)) {
  const repo = await mkdtemp(join(tmpdir(), 'component-rules-')); t.after(() => rm(repo, { recursive: true, force: true }));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = (...args) => execFileSync('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'commit.gpgSign=false', ...args], { cwd: repo, env, encoding: 'utf8', timeout: 10000 }).trim();
  git('init', '-q', '--template=', '--initial-branch=main');
  const commit = async text => { if (text === null) await rm(join(repo, 'target.ts')); else await writeFile(join(repo, 'target.ts'), text); git('add', '-A'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  // Start an added-file fixture from a nonempty repository.
  await writeFile(join(repo, 'readme.txt'), 'fixture\n');
  const base = before === null ? (git('add', '-A'), git('commit', '-qm', 'base'), git('rev-parse', 'HEAD')) : await commit(before);
  const head = await commit(after);
  return { repo, options: { repo, base, head, comparison: 'direct', ruleSource: 'pinned', rulesYaml: yaml() } };
}

test('v4 accepts only explicit true component qualifiers and normalizes without changing v3', () => {
  assert.equal(parseRulesYaml(yaml()).schemaVersion, 'review-rules/v4');
  for (const value of [false, null, 'true', 1]) assert.throws(() => parseRulesYaml(yaml([{ ...predicate, angularComponent: value }])), { code: 'INVALID_RULES' });
  for (const version of ['review-rules/v1', 'review-rules/v2', 'review-rules/v3']) assert.throws(() => parseRulesYaml(yaml([predicate], version)), { code: 'INVALID_RULES' });
  assert.deepEqual(parseRulesYaml(yaml([predicate, predicate])), parseRulesYaml(yaml()));
  const unqualified = { ...predicate }; delete unqualified.angularComponent;
  assert.notEqual(parseRulesYaml(yaml()).id, parseRulesYaml(yaml([unqualified])).id);
});

test('component qualification links pinned class/decorator/import evidence outside the edited hunk', async t => {
  const before = source().replace(' ngOnDestroy()', ' padding = 1;\n'.repeat(20) + ' ngOnDestroy()');
  const f = await fixture(t, before); await writeFile(join(f.repo, 'target.ts'), 'dirty bytes');
  const bundle = await createReviewBundle(f.options); assert.equal(bundle.schemaVersion, 'review-bundle/v4'); assert.equal(bundle.ruleSelection.schemaVersion, 'rule-selection/v5');
  assert.equal(selected(bundle).status, 'matched'); const observation = selected(bundle).matches[0].syntaxMatches[0][0];
  const context = observation.angularComponentContext; assert.equal(context.status, 'included'); assert.equal(context.component.name, 'Panel');
  assert.equal(context.component.origin.commit, f.options.base); assert.equal(context.component.decorator.binding.kind, 'named-import');
  assert.equal(context.component.decorator.binding.origin.start.line, 1); assert.equal(context.component.origin.start.line, 2);
  const evidence = bundle.evidence.find(e => e.id === observation.sourceEvidenceId); assert.equal(evidence.content, before);
  assert.equal(evidence.origin.object, context.component.origin.object); createReviewerRequest(bundle, identity);
});

for (const [name, before] of [
  ['namespace runtime import', source("import * as ng from '@angular/core';", '@ng.Component({})')],
  ['component without literal template metadata', source(undefined, '@View(resolveMetadata())')],
  ['component without template properties', source(undefined, '@View({selector: "panel"})')],
]) test(`${name} qualifies the changed syntax without requiring template expansion`, async t => {
  const f = await fixture(t, before); const b = await createReviewBundle(f.options); assert.equal(selected(b).status, 'matched'); assert(!b.angularTemplateContext); createReviewerRequest(b, identity);
});

for (const [name, before] of [
  ['ordinary class with the same method', source('', '')],
  ['custom Component import', source("import { Component as View } from './custom';")],
  ['type-only Component import', source("import type { Component as View } from '@angular/core';")],
  ['shadowed Component parameter', "import { Component as View } from '@angular/core';\nfunction wrap(View: any) {\n" + source('', '') .replace('\nexport class', '\n@View({})\nclass') + '}\n'],
  ['different lifecycle method', source().replace('ngOnDestroy', 'refresh')],
  ['nested undecorated class', "import { Component as View } from '@angular/core';\n@View({})\nclass Outer { build() {\n" + source('', '').replace('export class', 'class') + '} }\n'],
  ['undecorated subclass', "import { Component as View } from '@angular/core';\n@View({})\nclass Base {}\n" + source('', '').replace('class Panel', 'class Panel extends Base')],
  ['free function with lifecycle spelling', 'function ngOnDestroy() {\n  this.subscription.unsubscribe();\n}\n'],
]) test(`${name} does not select a qualified component rule`, async t => {
  const f = await fixture(t, before); const b = await createReviewBundle(f.options); assert.equal(selected(b).status, 'skipped'); assert.equal(selected(b).reason, 'changed-syntax-not-matched'); createReviewerRequest(b, identity);
});

test('same-class positive/negative controls distinguish qualification from method spelling', async t => {
  const f = await fixture(t, source('', ''));
  const plain = { ...predicate }; delete plain.angularComponent;
  const unqualified = await createReviewBundle({ ...f.options, rulesYaml: yaml([plain], 'review-rules/v3') });
  const qualified = await createReviewBundle(f.options); assert.equal(selected(unqualified).status, 'matched'); assert.equal(selected(qualified).status, 'skipped');
  assert.deepEqual(unqualified.facts, qualified.facts); assert.deepEqual(unqualified.changes, qualified.changes);
});

test('ambiguous decorators and anonymous class expressions remain explicitly unavailable', async t => {
  for (const before of [source(undefined, '@View({})\n@View({})'), source().replace('export class Panel', 'const Panel = class').replace('@View({})\n', '')]) {
    const f = await fixture(t, before); const b = await createReviewBundle(f.options); assert.equal(selected(b).reason, 'syntax-evidence-unavailable'); createReviewerRequest(b, identity);
  }
});

test('same-source revision qualification cannot borrow the opposite side decorator', async t => {
  const before = source(); const after = source('', '').replace('this.subscription.unsubscribe()', 'this.subscription.unsubscribe(); this.subscription.unsubscribe()');
  const f = await fixture(t, before, after); const added = { ...predicate, side: 'added' };
  const b = await createReviewBundle({ ...f.options, rulesYaml: yaml([added]) }); assert.equal(selected(b).status, 'skipped');
  const deleting = await fixture(t, before, remove(before).replace('@View({})\n', ''));
  const old = await createReviewBundle(deleting.options); assert.equal(selected(old).status, 'matched');
  assert.equal(selected(old).matches[0].syntaxMatches[0][0].angularComponentContext.component.origin.commit, deleting.options.base);
});

test('added and deleted components keep available-side ownership', async t => {
  for (const deleted of [true, false]) {
    const f = await fixture(t, deleted ? source() : null, deleted ? null : source());
    const b = await createReviewBundle({ ...f.options, rulesYaml: yaml([{ ...predicate, side: deleted ? 'removed' : 'added' }]) });
    assert.equal(selected(b).status, 'matched'); const o = selected(b).matches[0].syntaxMatches[0][0]; assert.equal(o.angularComponentContext.component.origin.commit, deleted ? f.options.base : f.options.head); createReviewerRequest(b, identity);
  }
});

test('qualifier alone does not select comments, unchanged syntax or decorator-only edits', async t => {
  const before = source();
  for (const after of [before.replace('unsubscribe();', 'unsubscribe(); // comment'), before.replace('@View({})', '@View({selector: "other"})')]) {
    const f = await fixture(t, before, after); assert.equal(selected(await createReviewBundle(f.options)).status, 'skipped');
  }
});

test('same-named block-local classes cannot cancel a call moved out of a bound component', async t => {
  const before = "import { Component as View } from '@angular/core';\n{\n@View({})\nclass Panel { ngOnDestroy() {\n this.subscription.unsubscribe();\n} }\n}\n{\nclass Panel { ngOnDestroy() {\n} }\n}\n";
  const after = before.replace(' this.subscription.unsubscribe();\n', '').replace('{\nclass Panel { ngOnDestroy() {\n', '{\nclass Panel { ngOnDestroy() {\n this.subscription.unsubscribe();\n');
  const f = await fixture(t, before, after); const b = await createReviewBundle(f.options); assert.equal(selected(b).status, 'matched'); createReviewerRequest(b, identity);
});

test('v4 full-source parse errors remain unavailable before qualification', async t => {
  const before = source() + 'function broken( {\n'; const f = await fixture(t, before, remove(before));
  const b = await createReviewBundle(f.options); assert.equal(selected(b).reason, 'syntax-evidence-unavailable'); assert.equal(b.ruleSelection.sourceCoverage[0].reason, 'parse-unavailable'); createReviewerRequest(b, identity);
});

test('v4 rejects patch mode in both generation and compilation', async t => {
  const f = await fixture(t); await assert.rejects(createReviewBundle({ ...f.options, ruleSource: 'patch' }), { code: 'INVALID_INPUT' });
  const snapshot = await ingestGitDiff({ repo: f.repo, base: f.options.base, head: f.options.head, comparison: 'direct' });
  assert.throws(() => compileReviewBundle(snapshot, { rulesYaml: yaml() }), { code: 'INVALID_INPUT' });
});

test('packets reject rehashed component and import provenance forgeries', async t => {
  const f = await fixture(t); const b = await createReviewBundle(f.options);
  for (const mutate of [c => c.component.name = 'Other', c => c.component.origin.commit = 'a'.repeat(40), c => c.component.decorator.binding.origin.start.line = 2,
    c => c.status = 'not-component', c => c.component.decorator.binding.kind = 'namespace-import']) {
    const forged = clone(b); mutate(selected(forged).matches[0].syntaxMatches[0][0].angularComponentContext);
    const { id, ...payload } = forged; forged.id = 'bundle:' + createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    assert.throws(() => createReviewerRequest(forged, identity), { code: 'INVALID_REVIEW_BUNDLE' });
  }
});

test('v4 integrates with template/binding/owner modes, automatic callers, GitLab and offline acceptance', async t => {
  const f = await fixture(t, source(undefined, "@View({template: '{{loading}}'})"));
  const b = await createReviewBundle({ ...f.options, angularTemplates: true, angularBindings: true, angularOwnerPaths: ['target.ts'] });
  assert.equal(b.schemaVersion, 'review-bundle/v7'); assert.equal(b.ruleSelection.schemaVersion, 'rule-selection/v5'); createReviewerRequest(b, identity);
  const callers = await createRuleContextBundle({ ...f.options, contextPolicy: [{ ruleId: 'teardown', kind: 'direct-callers', sides: ['old', 'new'] }] });
  assert.equal(callers.contextPlan.requests.length, 2); createReviewerRequest(callers.bundle, identity);
  const mr = normalizeGitLabMergeRequest({ id: 7, iid: 2, project_id: 3, target_project_id: 3, source_project_id: 3, title: 'Synthetic', state: 'opened', sha: f.options.head,
    diff_refs: { base_sha: f.options.base, start_sha: f.options.base, head_sha: f.options.head } }, { instanceUrl: 'https://gitlab.example.invalid', projectId: 3, mergeRequestIid: 2 });
  const gl = await createGitLabReviewBundle({ repo: f.repo, rulesYaml: yaml(), ruleSource: 'pinned', mergeRequest: mr }); createReviewerRequest(gl.bundle, identity);
  const expectations = { schemaVersion: 'review-acceptance-expectations/v1', caseId: 'component-removal', cohort: 'development', provenance: { kind: 'synthetic', author: 'contract-test', revision: '1' },
    revisions: b.provenance.revisions, ruleConfigId: parseRulesYaml(yaml()).id, ruleSource: 'pinned', changes: [{ status: 'M', oldPath: 'target.ts', newPath: 'target.ts', oldKind: 'file', newKind: 'file', coverage: 'text-diff',
      addedLines: 0, removedLines: 1, selectedRuleIds: ['teardown'], requiredPatchLines: ['-  this.subscription.unsubscribe();'], sourceCoverage: { available: true, reason: 'parsed-pinned-sources' } }] };
  assert.equal(auditReviewBundle(b, expectations).passed, true);
});

test('CLI supports pinned v4 and rejects implicit patch mode', async t => {
  const f = await fixture(t); const rulePath = join(f.repo, 'rules.json'); await writeFile(rulePath, yaml());
  const run = extra => spawnSync(process.execPath, [resolve('src/cli.js'), 'bundle', '--repo', f.repo, '--base', f.options.base, '--head', f.options.head, '--comparison', 'direct', '--rules', rulePath, ...extra], { encoding: 'utf8', timeout: 20000 });
  const good = run(['--rule-source', 'pinned']); assert.equal(good.status, 0); assert.equal(JSON.parse(good.stdout).ruleSelection.schemaVersion, 'rule-selection/v5');
  const bad = run([]); assert.equal(bad.status, 1); assert.equal(bad.stdout, '');
});

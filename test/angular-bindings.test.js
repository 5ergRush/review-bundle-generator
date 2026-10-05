import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReviewBundle, createReviewerRequest, createRuleContextBundle, normalizeGitLabMergeRequest, createGitLabReviewBundle, auditReviewBundle } from '../src/index.js';

const identity = { id: 'binding-test', version: '1' };
const rulesYaml = JSON.stringify({ schemaVersion: 'review-rules/v3', rules: [{ id: 'loading', title: 'State consumer', instruction: 'Check template consumers before reporting.', scope: { paths: ['panel.ts'] }, when: { changedSyntax: [{ side: 'removed', kind: 'assignment', target: 'this.loading', within: 'load' }] } }] });
const component = metadata => `import { Component } from '@angular/core';\n@Component({${metadata}})\nclass Panel {\n loading = false;\n items = [];\n user = {name: 'x'};\n load(value?: unknown) { this.loading = true; }\n}\n`;
async function fixture(t, content, { inline = false, members = '', metadata = '', suffix = '' } = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'binding-test-')); t.after(() => rm(repo, { recursive: true, force: true }));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = (...args) => execFileSync('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'commit.gpgSign=false', ...args], { cwd: repo, env, encoding: 'utf8', timeout: 10000 }).trim();
  git('init', '-q', '--template=', '--initial-branch=main');
  const before = component((inline ? `template: ${JSON.stringify(content)}` : "templateUrl: './panel.view'") + metadata).replace(' items = [];', members + '\n items = [];') + suffix;
  await writeFile(join(repo, 'panel.ts'), before); if (!inline) await writeFile(join(repo, 'panel.view'), content);
  git('add', '-A'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  await writeFile(join(repo, 'panel.ts'), before.replaceAll('this.loading = true;', '')); git('add', '-A'); git('commit', '-qm', 'head'); const head = git('rev-parse', 'HEAD');
  return { repo, base, head, options: { repo, base, head, comparison: 'direct', rulesYaml, ruleSource: 'pinned', angularTemplates: true, angularBindings: true } };
}
const decision = b => b.angularTemplateBindings.decisions.find(d => d.anchor);
const references = b => decision(b).bindings.flatMap(binding => binding.references);
const rehash = b => { const { id, ...payload } = b; b.id = 'bundle:' + createHash('sha256').update(JSON.stringify(payload)).digest('hex'); return b; };

test('binding opt-in preserves facts, rules and ownership and links declared component state and handler', async t => {
  const content = '<button [disabled]="loading" (click)="load($event)">{{user?.name}}</button>';
  const f = await fixture(t, content); const b = await createReviewBundle(f.options);
  const old = await createReviewBundle({ ...f.options, angularBindings: false });
  assert.equal(b.schemaVersion, 'review-bundle/v6'); assert.equal(old.schemaVersion, 'review-bundle/v5');
  assert.deepEqual(b.facts, old.facts); assert.deepEqual(b.ruleSelection, old.ruleSelection); assert.deepEqual(b.angularTemplateContext, old.angularTemplateContext);
  assert.equal(b.coverage.stages.angularBindings, 'partial');
  const refs = references(b); assert.deepEqual(refs.map(r => [r.name, r.classification, r.access]), [['loading', 'component-member', 'read'], ['load', 'component-member', 'call'], ['$event', 'event-local', 'read'], ['user', 'component-member', 'read']]);
  assert.equal(refs[0].member.origin.commit, f.base); assert.equal(refs[1].member.kind, 'MethodDeclaration');
  for (const r of refs) assert.equal(content.slice(r.range.startOffset, r.range.endOffset), r.name);
  assert(!refs.some(r => r.name === 'name')); createReviewerRequest(b, identity);
  assert.deepEqual(await createReviewBundle(f.options), b);
});

test('loop locals shadow component members, explicit this links the class and tracking scope is unresolved', async t => {
  const f = await fixture(t, '@for (loading of items; track loading.id; let i = $index) { {{loading}} {{this.loading}} {{i}} } {{loading}}');
  const b = await createReviewBundle(f.options); const refs = references(b);
  assert.deepEqual(refs.map(r => [r.name, r.classification]), [['items', 'component-member'], ['loading', 'unresolved'], ['loading', 'template-local'], ['loading', 'component-member'], ['i', 'template-local'], ['loading', 'component-member']]);
  assert.equal(refs[1].reason, 'for-track-scope-unavailable'); assert.equal(refs[2].declaration.name, 'loading');
  assert.equal(refs[3].receiver, 'explicit-this'); createReviewerRequest(b, identity);
});

test('structural directive variables, references and conditional aliases preserve lexical scope', async t => {
  for (const content of ['<div *ngFor="let loading of items">{{loading}}</div>{{loading}}', '<input #loading><span>{{loading.value}}</span>', '@if (user; as loading) { {{loading}} } {{loading}}']) {
    const f = await fixture(t, content); const b = await createReviewBundle(f.options);
    assert(references(b).some(r => r.name === 'loading' && r.classification === 'template-local'));
    createReviewerRequest(b, identity);
  }
});

test('writes, two-way events, globals and pipes remain syntax without directive/type/runtime inference', async t => {
  const f = await fixture(t, '<input [(ngModel)]="loading" (click)="loading = $any($event)">{{loading | async}} {{undefined}}');
  const b = await createReviewBundle(f.options); const refs = references(b);
  assert(refs.some(r => r.name === 'loading' && r.access === 'write'));
  assert(refs.some(r => r.name === '$any' && r.classification === 'global'));
  assert(!refs.some(r => r.name === 'undefined')); // Angular represents undefined as a literal.
  assert.deepEqual(decision(b).bindings.flatMap(binding => binding.pipes).map(p => [p.name, p.resolution]), [['async', 'not-resolved']]); createReviewerRequest(b, identity);
});

test('missing, inherited, static and ambiguous members are unresolved; getters and parameter properties link', async t => {
  const f = await fixture(t, '{{missing}} {{staticOnly}} {{overloaded()}} {{value}} {{service}}', { members: ' static staticOnly = 1;\n overloaded(x: string): void;\n overloaded(x?: string) {}\n get value() { return 1; }\n constructor(public service: unknown) {}' });
  const b = await createReviewBundle(f.options);
  assert.deepEqual(references(b).map(r => [r.name, r.classification, r.reason]), [['missing', 'unresolved', 'instance-member-unavailable'], ['staticOnly', 'unresolved', 'instance-member-unavailable'], ['overloaded', 'unresolved', 'ambiguous-instance-member'], ['value', 'component-member', 'declared-instance-member'], ['service', 'component-member', 'declared-instance-member']]); createReviewerRequest(b, identity);
});

test('inline decoded offsets and external BOM/CRLF/Unicode/entity ranges preserve the actual coordinate space', async t => {
  for (const inline of [false, true]) {
    const content = '\ufeff<div>😀\r\n{{loading}} and {{user.name}}</div>';
    const f = await fixture(t, content, { inline }); const b = await createReviewBundle(f.options); const d = decision(b);
    assert.equal(d.coordinateSpace, inline ? 'decoded-inline-template-utf16' : 'external-template-utf16');
    assert.equal(references(b)[0].range.start.line, 2); assert.equal(references(b)[0].range.start.column, 3);
    for (const r of references(b)) assert.equal(content.slice(r.range.startOffset, r.range.endOffset), r.name);
    createReviewerRequest(b, identity);
  }
});

test('HTML entity transformations omit expression relationships instead of inventing raw offsets', async t => {
  for (const content of ['<div>&amp; {{loading}} {{user.name}}</div>', '<button (click)="load(&quot;x&quot;)"></button>']) {
    const f = await fixture(t, content); const b = await createReviewBundle(f.options); const binding = decision(b).bindings[0];
    assert.equal(binding.status, 'omitted'); assert.equal(binding.reason, 'expression-source-transformation'); assert.equal(references(b).length, 0);
    assert(content.slice(binding.range.startOffset, binding.range.endOffset).includes('&')); createReviewerRequest(b, identity);
  }
});

test('invalid templates omit all relationships with diagnostics; text-only templates are parsed with no references', async t => {
  for (const content of ['<div>{{loading +}}</div>', '<button [disabled]="loading +"></button>', '<div>plain text</div>', '']) {
    const f = await fixture(t, content); const b = await createReviewBundle(f.options); const d = decision(b);
    assert.equal(d.status, content.includes('+') ? 'omitted' : 'included');
    assert.equal(references(b).length, 0); assert.equal(d.diagnostics.length > 0, content.includes('+')); createReviewerRequest(b, identity);
  }
});

test('custom interpolation metadata omits bindings explicitly rather than parsing with incorrect delimiters', async t => {
  const f = await fixture(t, '<div>[[loading]]</div>', { metadata: ", interpolation: ['[[', ']]']" });
  const b = await createReviewBundle(f.options); assert.equal(decision(b).reason, 'custom-interpolation-unsupported'); assert.equal(references(b).length, 0); createReviewerRequest(b, identity);
});

test('shared templates retain separate member resolution for each owner rather than leaking first-owner declarations', async t => {
  const suffix = component("templateUrl: './panel.view'").replace("import { Component } from '@angular/core';", '').replace('class Panel', 'class Other').replace(' loading = false;', '');
  const f = await fixture(t, '{{loading}}', { suffix }); const b = await createReviewBundle(f.options);
  const owners = b.angularTemplateBindings.decisions.filter(d => d.anchor);
  assert.equal(owners.length, 2); assert.equal(owners.find(d => d.component.name === 'Panel').bindings[0].references[0].classification, 'component-member');
  assert.equal(owners.find(d => d.component.name === 'Other').bindings[0].references[0].classification, 'unresolved');
  assert.equal(b.evidence.filter(e => e.type === 'angular-template-source').length, 1); createReviewerRequest(b, identity);
});

test('deferred and ICU templates remain explicit unsupported analyses with no partial relationships', async t => {
  for (const content of ['@defer (when loading) { {{loading}} }', '{loading, select, true {yes} other {no}}']) {
    const f = await fixture(t, content); const b = await createReviewBundle(f.options);
    assert.equal(decision(b).reason, 'deferred-or-icu-template-unsupported'); assert.equal(references(b).length, 0); createReviewerRequest(b, identity);
  }
});

test('packet recomputation rejects rehashed forged members, local classification, ranges, diagnostics and policy', async t => {
  const f = await fixture(t, '<button [disabled]="loading">{{missing}}</button>'); const b = await createReviewBundle(f.options);
  for (const mutate of [v => references(v)[0].member.name = 'other', v => references(v)[0].classification = 'template-local', v => references(v)[0].range.startOffset++, v => decision(v).diagnostics.push({ message: 'fake' }), v => v.angularTemplateBindings.policy.compilerVersion = '99', v => v.coverage.stages.angularBindings = 'complete', v => delete v.angularTemplateBindings]) {
    const forged = structuredClone(b); mutate(forged); assert.throws(() => createReviewerRequest(rehash(forged), identity), { code: 'INVALID_REVIEW_BUNDLE' });
  }
});

test('binding options and budgets reject invalid requests with no partial output, including inline size and deep ASTs', async t => {
  const f = await fixture(t, '{{loading}}');
  await assert.rejects(createReviewBundle({ ...f.options, angularBindings: 'yes' }), { code: 'INVALID_INPUT' });
  await assert.rejects(createReviewBundle({ ...f.options, angularTemplates: false }), { code: 'INVALID_INPUT' });
  const huge = await fixture(t, 'x'.repeat(32769), { inline: true }); await assert.rejects(createReviewBundle(huge.options), { code: 'ANGULAR_BINDING_LIMIT' });
  const deep = await fixture(t, '<div>'.repeat(140) + '{{loading}}' + '</div>'.repeat(140)); await assert.rejects(createReviewBundle(deep.options), { code: 'ANGULAR_BINDING_LIMIT' });
  await writeFile(join(f.repo, 'rules.json'), rulesYaml);
  const args = [resolve('src/cli.js'), 'bundle', '--repo', f.repo, '--base', f.base, '--head', f.head, '--rules', join(f.repo, 'rules.json'), '--rule-source', 'pinned', '--angular-templates', '--angular-bindings'];
  const good = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 30000 }); assert.equal(good.status, 0, good.stderr); assert.equal(JSON.parse(good.stdout).schemaVersion, 'review-bundle/v6');
  const bad = spawnSync(process.execPath, [...args, '--angular-bindings'], { encoding: 'utf8', timeout: 30000 }); assert.equal(bad.status, 1); assert.equal(bad.stdout, '');
});

test('caller planning, GitLab wrapping and independently authored fact/rule acceptance support v6', async t => {
  const f = await fixture(t, '<button [disabled]="loading"></button>');
  const context = await createRuleContextBundle({ ...f.options, contextPolicy: [{ ruleId: 'loading', kind: 'direct-callers', sides: ['old'] }] });
  assert.equal(context.bundle.schemaVersion, 'review-bundle/v6'); createReviewerRequest(context.bundle, identity);
  const mergeRequest = normalizeGitLabMergeRequest({ id: 9, project_id: 1, target_project_id: 1, source_project_id: 1, iid: 2, state: 'opened', sha: f.head, diff_refs: { base_sha: f.base, start_sha: f.base, head_sha: f.head } }, { instanceUrl: 'https://gitlab.example.test', projectId: 1, mergeRequestIid: 2 });
  const wrapped = await createGitLabReviewBundle({ repo: f.repo, mergeRequest, rulesYaml, ruleSource: 'pinned', angularTemplates: true, angularBindings: true });
  createReviewerRequest(wrapped.bundle, identity);
  const expectations = { schemaVersion: 'review-acceptance-expectations/v1', caseId: 'bindings', cohort: 'development', provenance: { kind: 'synthetic', author: 'contract-test', revision: '1' }, revisions: wrapped.bundle.provenance.revisions, ruleConfigId: wrapped.bundle.ruleSelection.configId, ruleSource: 'pinned', changes: [{ status: 'M', oldPath: 'panel.ts', newPath: 'panel.ts', oldKind: 'file', newKind: 'file', coverage: 'text-diff', addedLines: 1, removedLines: 1, selectedRuleIds: ['loading'], requiredPatchLines: ['- load(value?: unknown) { this.loading = true; }'], sourceCoverage: { available: true, reason: 'parsed-pinned-sources' } }] };
  assert.equal(auditReviewBundle(wrapped.bundle, expectations).passed, true);
});

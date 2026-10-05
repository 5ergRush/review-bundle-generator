import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReviewBundle, createRuleContextBundle, createReviewerRequest, normalizeReviewerResponse, normalizeGitLabMergeRequest, createGitLabReviewBundle, auditReviewBundle } from '../src/index.js';

const rules = (predicates = [{ side: 'removed', kind: 'assignment', target: 'this.loading', within: 'load' }]) => JSON.stringify({ schemaVersion: 'review-rules/v3', rules: predicates.map((predicate, index) => ({
  id: index === 0 ? 'loading' : 'next-loading', title: 'Loading transition', instruction: 'Check template consumers and equivalent enforcement before reporting.', scope: { paths: ['*.ts'] }, when: { changedSyntax: [predicate] } })) });
const component = (metadata = "templateUrl: './unrelated-name.view'", imports = "import { Component as View } from '@angular/core';", decorator = 'View', statement = 'this.loading = true;') =>
  `${imports}\n@${decorator}({ ${metadata} })\nexport class Panel {\n  loading = false;\n  load() {\n${'    void this;\n'.repeat(12)}    ${statement}\n${'    void this;\n'.repeat(12)}  }\n}\n`;
async function fixture(t, before = component(), after = before.replace('    this.loading = true;\n', ''), extra = { 'unrelated-name.view': '<button [disabled]="loading">Load</button>\n' }, headExtra = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'review-angular-')); t.after(() => rm(repo, { recursive: true, force: true }));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = (...args) => execFileSync('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'commit.gpgSign=false', ...args], { cwd: repo, env, encoding: 'utf8', timeout: 10000 }).trim();
  git('init', '-q', '--template=', '--initial-branch=main');
  for (const [path, content] of Object.entries(extra)) await writeFile(join(repo, path), content);
  const put = (path, content) => writeFile(join(repo, path), content);
  await put('panel.ts', before); git('add', '-A'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  await put('panel.ts', after); for (const [path, content] of Object.entries(headExtra)) await put(path, content);
  git('add', '-A'); git('commit', '-qm', 'head'); const head = git('rev-parse', 'HEAD');
  return { repo, git, put, options: { repo, base, head, comparison: 'direct', rulesYaml: rules(), ruleSource: 'pinned', angularTemplates: true } };
}
const identity = { id: 'angular-contract', version: '1' };
const copy = value => JSON.parse(JSON.stringify(value));
const rehash = value => { const { id, ...payload } = value; value.id = 'bundle:' + createHash('sha256').update(JSON.stringify(payload)).digest('hex'); return value; };
const decision = bundle => bundle.angularTemplateContext.decisions.find(item => item.anchor);
const templates = bundle => bundle.evidence.filter(item => item.type === 'angular-template-source');

test('aliased Angular import and explicit unrelated template filename yield pinned context with unchanged facts/rules', async t => {
  const f = await fixture(t); await f.put('unrelated-name.view', 'dirty bytes');
  const bundle = await createReviewBundle(f.options); const baseline = await createReviewBundle({ ...f.options, angularTemplates: false });
  assert.equal(bundle.schemaVersion, 'review-bundle/v5'); assert.deepEqual(bundle.facts, baseline.facts); assert.deepEqual(bundle.ruleSelection, baseline.ruleSelection);
  assert.equal(bundle.coverage.stages.angularTemplates, 'partial'); assert.equal(bundle.semanticAnalysis, undefined);
  const d = decision(bundle); assert.equal(d.status, 'included'); assert.equal(d.component.name, 'Panel'); assert.equal(d.component.decorator.binding.localName, 'View');
  assert.equal(d.template.path, 'unrelated-name.view'); assert.equal(d.template.commit, f.options.base);
  assert.equal(templates(bundle)[0].content, '<button [disabled]="loading">Load</button>\n');
  createReviewerRequest(bundle, identity);
});

test('namespace import bindings are supported; same-named custom imports are explicit omissions', async t => {
  const good = component(undefined, "import * as ng from '@angular/core';", 'ng.Component'); const f = await fixture(t, good);
  assert.equal(decision(await createReviewBundle(f.options)).component.decorator.binding.kind, 'namespace-import');
  const custom = component(undefined, "import { Component as View } from './custom';"); const c = await fixture(t, custom);
  const bundle = await createReviewBundle(c.options); assert.equal(decision(bundle).reason, 'component-import-binding-unavailable'); assert.equal(templates(bundle).length, 0); createReviewerRequest(bundle, identity);
});

test('type-only imports, unimported decorator spellings and local decorator aliases do not establish Angular ownership', async t => {
  for (const imports of ["import type { Component as View } from '@angular/core';", "import { type Component as View } from '@angular/core';", 'declare function View(value: unknown): any;', "import { Component } from '@angular/core'; const View = Component;"]) {
    const f = await fixture(t, component(undefined, imports)); const b = await createReviewBundle(f.options);
    assert.equal(decision(b).reason, 'component-import-binding-unavailable'); assert.equal(templates(b).length, 0);
  }
});

test('a shadowed decorator import cannot attach the outer component template to a nested class', async t => {
  const before = "import { Component as View } from '@angular/core';\nfunction owner(View: any) {\n" + component(undefined, '') + '}\n';
  const f = await fixture(t, before); const b = await createReviewBundle(f.options);
  assert.equal(decision(b).reason, 'component-import-binding-unavailable'); assert.equal(templates(b).length, 0);
});

test('inline literal templates retain decoded value and exact pinned metadata coordinates', async t => {
  const f = await fixture(t, component('template: `<button>\\nLoad</button>`'));
  const b = await createReviewBundle(f.options); const d = decision(b);
  assert.equal(d.template.kind, 'inline'); assert.equal(d.template.value, '<button>\nLoad</button>'); assert.equal(d.template.metadataOrigin.commit, f.options.base);
  assert.equal(d.template.metadataOrigin.start.line, 2); assert.equal(templates(b).length, 0); createReviewerRequest(b, identity);
});

test('dynamic metadata, spreads, computed keys, duplicates and conflicting templates remain explicit omissions', async t => {
  const cases = [ ['template: makeTemplate()', 'dynamic-template-metadata'], ['templateUrl: path', 'dynamic-template-metadata'],
    ["...extra, templateUrl: './unrelated-name.view'", 'unsupported-component-metadata'], ["['templateUrl']: './unrelated-name.view'", 'unsupported-component-metadata'],
    ["templateUrl: './unrelated-name.view', templateUrl: './other.html'", 'ambiguous-component-metadata'], ["template: 'x', templateUrl: './unrelated-name.view'", 'conflicting-template-metadata'], ['selector: \'panel\'', 'template-metadata-unavailable'] ];
  for (const [metadata, reason] of cases) { const f = await fixture(t, component(metadata)); const b = await createReviewBundle(f.options); assert.equal(decision(b).reason, reason); assert.equal(templates(b).length, 0); createReviewerRequest(b, identity); }
});

test('absolute, remote, escaping and encoded template URLs are not fetched', async t => {
  for (const path of ['/template.html', 'https://example.test/template.html', '../outside.html', 'file%20name.html', './x.html?raw', './x.html#view']) {
    const f = await fixture(t, component(`templateUrl: '${path}'`)); const b = await createReviewBundle(f.options);
    assert.equal(decision(b).reason, 'unsupported-template-url'); assert.equal(templates(b).length, 0);
  }
});

test('nearest undecorated nested class and outside-class function do not inherit a component template', async t => {
  for (const before of [component('template: \'outer\'', undefined, 'View', '').replace('    \n', "    class Inner { load() { this.loading = true; } }\n"),
    "import { Component } from '@angular/core';\n@Component({template: 'outer'}) class Panel {}\nfunction load() { this.loading = true; }\n"]) {
    const after = before.replace('this.loading = true;', ''); const f = await fixture(t, before, after); const b = await createReviewBundle(f.options);
    assert.equal(templates(b).length, 0); assert.equal(decision(b).status, 'omitted');
  }
});

test('skipped and path-only selected rules never request templates', async t => {
  const before = component(); const after = before.replace('void this;', 'void 1;'); const f = await fixture(t, before, after);
  let b = await createReviewBundle(f.options); assert.equal(b.angularTemplateContext.decisions[0].reason, 'rule-not-selected'); assert.equal(templates(b).length, 0);
  const pathRules = JSON.stringify({ schemaVersion: 'review-rules/v3', rules: [{ id: 'path', title: 'Path', instruction: 'Authored path-only control.', scope: { paths: ['*.ts'] } }] });
  b = await createReviewBundle({ ...f.options, rulesYaml: pathRules }); assert.equal(b.angularTemplateContext.decisions[0].reason, 'syntax-anchor-required'); assert.equal(templates(b).length, 0);
});

test('both selected syntax sides use their own revisions and changed template URLs', async t => {
  const before = component(); const after = before.replace('this.loading = true;', 'this.loading = false;').replace('./unrelated-name.view', './new-template.html');
  const f = await fixture(t, before, after, { 'unrelated-name.view': 'old view\n', 'new-template.html': 'new view\n' });
  const b = await createReviewBundle({ ...f.options, rulesYaml: rules([{ side: 'removed', kind: 'assignment', target: 'this.loading', within: 'load' }, { side: 'added', kind: 'assignment', target: 'this.loading', within: 'load' }]) });
  assert.equal(templates(b).length, 2); assert.equal(templates(b).find(e => e.origin.commit === f.options.base).content, 'old view\n');
  assert.equal(templates(b).find(e => e.origin.commit === f.options.head).content, 'new view\n'); createReviewerRequest(b, identity);
});

test('shared template bytes are represented once and linked to each owning changed class', async t => {
  const before = component() + component(undefined, '', 'View').replace('class Panel', 'class Other');
  const after = before.replaceAll('    this.loading = true;\n', ''); const f = await fixture(t, before, after);
  const b = await createReviewBundle(f.options); assert.equal(b.angularTemplateContext.decisions.length, 2); assert.equal(templates(b).length, 1);
  assert.equal(new Set(b.angularTemplateContext.decisions.map(d => d.template.evidenceId)).size, 1); createReviewerRequest(b, identity);
});

test('missing templates, symlinks, invalid UTF-8 and file byte overflow fail without a bundle', async t => {
  const missing = await fixture(t, component(), undefined, {}); await assert.rejects(createReviewBundle(missing.options), { code: 'TEMPLATE_SOURCE_UNAVAILABLE' });
  const link = await fixture(t); await rm(join(link.repo, 'unrelated-name.view')); await symlink('panel.ts', join(link.repo, 'unrelated-name.view')); link.git('add', '-A'); link.git('commit', '-qm', 'link');
  await link.put('panel.ts', component().replace('this.loading = true;', 'this.loading = false;')); link.git('add', '-A'); link.git('commit', '-qm', 'new assignment');
  const both = link.git('rev-parse', 'HEAD'); await assert.rejects(createReviewBundle({ ...link.options, rulesYaml: rules([{ side: 'added', kind: 'assignment', target: 'this.loading' }]), head: both }), { code: 'TEMPLATE_SOURCE_UNAVAILABLE' });
  const bad = await fixture(t, component(), undefined, { 'unrelated-name.view': Buffer.from([0xff]) }); await assert.rejects(createReviewBundle(bad.options), { code: 'UNSUPPORTED_ENCODING' });
  const huge = await fixture(t, component(), undefined, { 'unrelated-name.view': 'x'.repeat(32769) }); await assert.rejects(createReviewBundle(huge.options), { code: 'OUTPUT_LIMIT' });
});

test('BOM/CRLF and empty templates retain exact full-file byte provenance', async t => {
  for (const content of ['\ufeff<div>\r\n</div>\r\n', '']) {
    const f = await fixture(t, component(), undefined, { 'unrelated-name.view': content }); const b = await createReviewBundle(f.options);
    assert.equal(templates(b)[0].content, content); assert.equal(templates(b)[0].origin.start.line, 1); createReviewerRequest(b, identity);
  }
});

test('packet validation rejects rehashed forged ownership, content, provenance, dangling and extra templates', async t => {
  const f = await fixture(t); const original = await createReviewBundle(f.options);
  const changes = [b => decision(b).component.name = 'Fake', b => decision(b).component.decorator.binding.localName = 'Wrong', b => decision(b).template.path = 'wrong.html',
    b => templates(b)[0].content += 'forged', b => templates(b)[0].origin.commit = f.options.head, b => b.evidence = b.evidence.filter(e => e.type !== 'angular-template-source'),
    b => b.angularTemplateContext.decisions[0].status = 'omitted', b => b.schemaVersion = 'review-bundle/v4'];
  for (const mutate of changes) { const b = copy(original); mutate(b); assert.throws(() => createReviewerRequest(rehash(b), identity), { code: 'INVALID_REVIEW_BUNDLE' }); }
});

test('template reviewer claims stay scoped to their owning selected change and unverified', async t => {
  const f = await fixture(t); const b = await createReviewBundle(f.options); const request = createReviewerRequest(b, identity); const source = templates(b)[0];
  const response = { schemaVersion: 'reviewer-response/v1', requestId: request.id, reviewer: identity, status: 'complete', reviewedRuleIds: ['loading'], contextRequests: [], findings: [
    { ruleId: 'loading', severity: 'warning', title: 'Synthetic contract claim', description: 'No actual defect assertion.', evidenceIds: [source.id], location: { evidenceId: source.id, side: 'source', startLine: 1, endLine: 1 } }] };
  const result = normalizeReviewerResponse(request, response); assert.equal(result.findings[0].location.path, 'unrelated-name.view'); assert.equal(result.findings[0].verification, 'unverified');
});

test('rule-directed callers, GitLab pinned refs and offline acceptance remain compatible with bundle v5', async t => {
  const f = await fixture(t); const b = await createRuleContextBundle({ ...f.options, contextPolicy: [{ ruleId: 'loading', kind: 'direct-callers', sides: ['old'] }] });
  assert.equal(b.bundle.schemaVersion, 'review-bundle/v5'); assert(b.bundle.semanticAnalysis); createReviewerRequest(b.bundle, identity);
  const metadata = normalizeGitLabMergeRequest({ id: 9, project_id: 1, target_project_id: 1, source_project_id: 1, iid: 2, state: 'opened', sha: f.options.head,
    diff_refs: { base_sha: f.options.base, start_sha: f.options.base, head_sha: f.options.head }, source_branch: 'feature', target_branch: 'main' }, { instanceUrl: 'https://gitlab.example.test', projectId: 1, mergeRequestIid: 2 });
  const wrapped = await createGitLabReviewBundle({ repo: f.repo, mergeRequest: metadata, rulesYaml: f.options.rulesYaml, ruleSource: 'pinned', angularTemplates: true });
  assert.equal(wrapped.bundle.schemaVersion, 'review-bundle/v5'); createReviewerRequest(wrapped.bundle, identity);
  const expected = { schemaVersion: 'review-acceptance-expectations/v1', caseId: 'angular-authored', cohort: 'development', provenance: { kind: 'synthetic', author: 'contract-test', revision: '1' },
    revisions: wrapped.bundle.provenance.revisions, ruleConfigId: wrapped.bundle.ruleSelection.configId, ruleSource: 'pinned', changes: [{ status: 'M', oldPath: 'panel.ts', newPath: 'panel.ts', oldKind: 'file', newKind: 'file', coverage: 'text-diff', addedLines: 0, removedLines: 1,
      selectedRuleIds: ['loading'], requiredPatchLines: ['-    this.loading = true;'], sourceCoverage: { available: true, reason: 'parsed-pinned-sources' } }] };
  assert.equal(auditReviewBundle(wrapped.bundle, expected).passed, true);
});

test('Angular opt-in validation and CLI bundle v5 are explicit', async t => {
  const f = await fixture(t); await assert.rejects(createReviewBundle({ ...f.options, ruleSource: 'patch' }), { code: 'INVALID_INPUT' });
  await assert.rejects(createReviewBundle({ ...f.options, angularTemplates: 'yes' }), { code: 'INVALID_INPUT' });
  await assert.rejects(createReviewBundle({ ...f.options, maxBundleBytes: 1 }), { code: 'BUNDLE_LIMIT' });
  await f.put('rules.json', f.options.rulesYaml);
  const args = [resolve('src/cli.js'), 'bundle', '--repo', f.repo, '--base', f.options.base, '--head', f.options.head, '--rules', join(f.repo, 'rules.json'), '--rule-source', 'pinned', '--angular-templates'];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 30000 }); assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(r.stdout).schemaVersion, 'review-bundle/v5');
  const bad = spawnSync(process.execPath, [...args, '--angular-templates'], { encoding: 'utf8', timeout: 30000 }); assert.equal(bad.status, 1); assert.equal(bad.stdout, '');
});

test('external template count and total byte budgets fail without truncated context', async t => {
  for (const [count, size, code] of [[11, 1, 'ANGULAR_CONTEXT_LIMIT'], [5, 32768, 'SOURCE_LIMIT']]) {
    const extra = {}; let before = '';
    for (let i = 0; i < count; i++) { before += component(`templateUrl: './view-${i}'`, i ? '' : undefined).replace('class Panel', `class Panel${i}`); extra[`view-${i}`] = 'x'.repeat(size); }
    const f = await fixture(t, before, before.replaceAll('    this.loading = true;\n', ''), extra);
    await assert.rejects(createReviewBundle(f.options), { code });
  }
});

test('HTML-only edits and ambiguous Component decorators do not fabricate ownership requests', async t => {
  const f = await fixture(t, component(), component(), { 'unrelated-name.view': 'old\n' }, { 'unrelated-name.view': 'new\n' });
  const b = await createReviewBundle(f.options); assert.equal(templates(b).length, 0); assert.equal(b.angularTemplateContext.decisions[0].reason, 'rule-not-selected'); createReviewerRequest(b, identity);
  const before = component().replace('export class', "@View({template: 'other'})\nexport class"); const a = await fixture(t, before);
  assert.equal(decision(await createReviewBundle(a.options)).reason, 'ambiguous-component-decorator');
});

test('primary template evidence must belong to the cited rule even when two owners share a changed file', async t => {
  const before = component("templateUrl: './left.html'") + component("templateUrl: './right.html'", '').replace('class Panel', 'class Other').replace('this.loading = true;', 'this.busy = true;');
  const after = before.replaceAll('    this.loading = true;\n', '').replace('    this.busy = true;\n', '');
  const f = await fixture(t, before, after, { 'left.html': 'left\n', 'right.html': 'right\n' });
  const b = await createReviewBundle({ ...f.options, rulesYaml: rules([{ side: 'removed', kind: 'assignment', target: 'this.loading', within: 'load' }, { side: 'removed', kind: 'assignment', target: 'this.busy', within: 'load' }]) });
  const request = createReviewerRequest(b, identity); const source = templates(b).find(item => item.origin.path === 'right.html');
  const response = { schemaVersion: 'reviewer-response/v1', requestId: request.id, reviewer: identity, status: 'complete', reviewedRuleIds: ['loading', 'next-loading'], contextRequests: [], findings: [
    { ruleId: 'loading', severity: 'warning', title: 'Synthetic scope test', description: 'Must be rejected.', evidenceIds: [source.id], location: { evidenceId: source.id, side: 'source', startLine: 1, endLine: 1 } }] };
  assert.throws(() => normalizeReviewerResponse(request, response));
  response.findings[0].ruleId = 'next-loading'; assert.equal(normalizeReviewerResponse(request, response).findings[0].verification, 'unverified');
});

test('templates changed in the same MR retain the observed-side blob and reject inconsistent changed-file identity', async t => {
  const f = await fixture(t, component(), undefined, { 'unrelated-name.view': 'old view\n' }, { 'unrelated-name.view': 'new view\n' });
  const b = await createReviewBundle(f.options); const source = templates(b)[0]; const change = b.changes.find(c => c.oldPath === 'unrelated-name.view');
  assert.equal(source.content, 'old view\n'); assert.equal(source.origin.object, change.oldObject); createReviewerRequest(b, identity);
  const forged = copy(b); const record = templates(forged)[0]; record.content = 'new view\n'; record.origin.object = change.newObject;
  const { id, ...payload } = record; record.id = 'evidence:' + createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  for (const decision of forged.angularTemplateContext.decisions) if (decision.template?.evidenceId === id) decision.template.evidenceId = record.id;
  for (const external of forged.angularTemplateContext.externalSources) if (external.evidenceId === id) external.evidenceId = record.id;
  assert.throws(() => createReviewerRequest(rehash(forged), identity), { code: 'INVALID_REVIEW_BUNDLE' });
});

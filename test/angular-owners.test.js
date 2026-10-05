import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReviewBundle, createReviewerRequest, normalizeReviewerResponse, createRuleContextBundle, normalizeGitLabMergeRequest, createGitLabReviewBundle, auditReviewBundle } from '../src/index.js';

const identity = { id: 'owner-test', version: '1' };
const rules = (paths = ['*.view']) => JSON.stringify({ schemaVersion: 'review-rules/v3', rules: [{ id: 'template-consumer', title: 'Authored template policy', instruction: 'Check bindings against actual component state; file scope is explicit policy, not defect proof.', scope: { paths } }] });
const component = (url = './screen.view', name = 'Panel', imports = "import { Component as View } from '@angular/core';", decorator = 'View') => `${imports}\n@${decorator}({templateUrl: '${url}'})\nclass ${name} {\n loading = false;\n load() {}\n}\n`;
async function fixture(t, { before = { 'screen.view': '<button [disabled]="loading">old</button>\n', 'owner.ts': component() }, after = { 'screen.view': '<button [disabled]="loading" (click)="load()">new</button>\n' }, ownerPaths = ['owner.ts'], selectedPaths = ['*.view'] } = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'owner-test-')); t.after(() => rm(repo, { recursive: true, force: true }));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = (...args) => execFileSync('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'commit.gpgSign=false', ...args], { cwd: repo, env, encoding: 'utf8', timeout: 10000 }).trim();
  const put = async (path, content) => { await mkdir(dirname(join(repo, path)), { recursive: true }); if (content === null) await rm(join(repo, path)); else await writeFile(join(repo, path), content); };
  git('init', '-q', '--template=', '--initial-branch=main');
  for (const [path, content] of Object.entries(before)) await put(path, content);
  git('add', '-A'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  for (const [path, content] of Object.entries(after)) await put(path, content);
  git('add', '-A'); git('commit', '-qm', 'head'); const head = git('rev-parse', 'HEAD');
  return { repo, git, put, base, head, options: { repo, base, head, comparison: 'direct', rulesYaml: rules(selectedPaths), ruleSource: 'pinned', angularTemplates: true, angularBindings: true, angularOwnerPaths: ownerPaths } };
}
const ownerDecisions = b => b.angularTemplateOwnerContext.decisions;
const rehash = b => { const { id, ...payload } = b; b.id = 'bundle:' + createHash('sha256').update(JSON.stringify(payload)).digest('hex'); return b; };
const evidence = (b, type) => b.evidence.filter(e => e.type === type);

test('HTML-only changes discover unchanged owners from explicit metadata on each scoped revision with unchanged facts/rules', async t => {
  const f = await fixture(t); await f.put('owner.ts', 'dirty invalid owner'); await f.put('screen.view', 'dirty bytes');
  const b = await createReviewBundle(f.options), baseline = await createReviewBundle({ ...f.options, angularOwnerPaths: undefined });
  assert.equal(b.schemaVersion, 'review-bundle/v7'); assert.deepEqual(b.facts, baseline.facts); assert.deepEqual(b.ruleSelection, baseline.ruleSelection); assert.equal(b.changes.length, 1);
  assert.equal(evidence(b, 'typescript-rule-source').length, 0); assert.equal(evidence(b, 'angular-owner-source').length, 2);
  assert.deepEqual(ownerDecisions(b).map(d => [d.side, d.status, d.owners[0].component.name]), [['old', 'included', 'Panel'], ['new', 'included', 'Panel']]);
  const bindings = b.angularTemplateBindings.decisions.filter(d => d.template);
  assert.deepEqual(bindings.map(d => d.bindings.flatMap(binding => binding.references.map(r => r.name))), [['loading'], ['loading', 'load']]);
  assert(bindings.every(d => d.bindings.flatMap(v => v.references).every(r => r.classification === 'component-member')));
  createReviewerRequest(b, identity); assert.deepEqual(await createReviewBundle(f.options), b);
});

test('literal template names with unrelated extensions and relative parent directories resolve without naming conventions', async t => {
  const f = await fixture(t, { before: { 'screen.widget': '{{loading}}\n', 'views/owner.ts': component('../screen.widget') }, after: { 'screen.widget': '{{loading}} changed\n' }, ownerPaths: ['views/owner.ts'], selectedPaths: ['*.widget'] });
  const b = await createReviewBundle(f.options); assert(ownerDecisions(b).every(d => d.status === 'included')); createReviewerRequest(b, identity);
});

test('namespace Component imports and added template syntax retain source-side binding evidence', async t => {
  const source = component(undefined, undefined, "import * as ng from '@angular/core';", 'ng.Component');
  const f = await fixture(t, { before: { 'screen.view': 'old\n', 'owner.ts': source }, after: { 'screen.view': '{{loading}}\n' } });
  const b = await createReviewBundle(f.options); assert(ownerDecisions(b).every(d => d.owners[0].component.decorator.binding.kind === 'namespace-import'));
  const next = b.angularTemplateBindings.decisions.find(d => d.anchor?.side === 'new' && d.template); assert.equal(next.bindings[0].references[0].member.origin.commit, f.head); createReviewerRequest(b, identity);
});

test('candidate coverage is explicit: excluded, missing and non-component sources cannot fabricate ownership', async t => {
  const f = await fixture(t, { before: { 'screen.view': 'old\n', 'owner.ts': component(), 'other.ts': 'class Other {}\n' }, after: { 'screen.view': 'new\n' }, ownerPaths: ['other.ts', 'missing.ts'] });
  const b = await createReviewBundle(f.options); assert(ownerDecisions(b).every(d => d.reason === 'owner-not-resolved-in-candidate-set'));
  assert.equal(evidence(b, 'angular-owner-template-source').length, 0);
  assert(b.angularTemplateOwnerContext.scans.some(s => s.path === 'missing.ts' && s.status === 'candidate-not-regular-or-missing'));
  assert(!evidence(b, 'angular-owner-source').some(e => e.origin.path === 'owner.ts')); createReviewerRequest(b, identity);
});

test('custom, type-only and shadowed decorator imports plus dynamic metadata remain unresolved with audited candidate reasons', async t => {
  for (const source of [component(undefined, undefined, "import { Component as View } from './custom';"), component(undefined, undefined, "import type { Component as View } from '@angular/core';"), 'function factory(View: any) {\n' + component(undefined, undefined, '') + '}\n', component().replace("'./screen.view'", 'resolveUrl()')]) {
    const f = await fixture(t, { before: { 'screen.view': 'old\n', 'owner.ts': source }, after: { 'screen.view': 'new\n' } });
    const b = await createReviewBundle(f.options); assert(ownerDecisions(b).every(d => d.owners.length === 0));
    assert(b.angularTemplateOwnerContext.scans.every(s => s.classes[0].reason)); createReviewerRequest(b, identity);
  }
});

test('parse-failed candidates and symlink candidate paths retain explicit limitations without reading working-tree targets', async t => {
  const bad = await fixture(t, { before: { 'screen.view': 'old\n', 'owner.ts': 'class {' }, after: { 'screen.view': 'new\n' } });
  const b = await createReviewBundle(bad.options); assert(b.angularTemplateOwnerContext.scans.every(s => s.status === 'parse-unavailable')); createReviewerRequest(b, identity);
  const link = await fixture(t); await rm(join(link.repo, 'owner.ts')); await symlink('outside.ts', join(link.repo, 'owner.ts')); await link.put('outside.ts', component());
  link.git('add', '-A'); link.git('commit', '-qm', 'link'); const base = link.git('rev-parse', 'HEAD'); await link.put('screen.view', 'third\n'); link.git('add', '-A'); link.git('commit', '-qm', 'third');
  const linked = await createReviewBundle({ ...link.options, base, head: link.git('rev-parse', 'HEAD') });
  assert(linked.angularTemplateOwnerContext.scans.every(s => s.status === 'candidate-not-regular-or-missing')); assert.equal(evidence(linked, 'angular-owner-source').length, 0);
});

test('shared external templates retain all declared owners and resolve members independently', async t => {
  const source = component() + component(undefined, 'Other', '').replace(' loading = false;', '');
  const f = await fixture(t, { before: { 'screen.view': '{{loading}} old\n', 'owner.ts': source }, after: { 'screen.view': '{{loading}} new\n' } });
  const b = await createReviewBundle(f.options); assert(ownerDecisions(b).every(d => d.owners.length === 2)); assert.equal(evidence(b, 'angular-owner-template-source').length, 2);
  const refs = b.angularTemplateBindings.decisions.filter(d => d.template).map(d => [d.component.name, d.bindings[0].references[0].classification]);
  assert.deepEqual(refs, [['Panel', 'component-member'], ['Other', 'unresolved'], ['Panel', 'component-member'], ['Other', 'unresolved']]); createReviewerRequest(b, identity);
});

test('rename scoping and metadata changes discover old/new owners only on selected path sides', async t => {
  const f = await fixture(t, { before: { 'screen.view': '{{loading}}\n', 'owner.ts': component() }, after: { 'screen.view': null, 'renamed.view': '{{loading}}\n', 'owner.ts': component('./renamed.view') }, selectedPaths: ['renamed.view'] });
  const b = await createReviewBundle(f.options); assert.equal(ownerDecisions(b).length, 1); assert.equal(ownerDecisions(b)[0].side, 'new'); assert.equal(ownerDecisions(b)[0].owners[0].template.path, 'renamed.view'); createReviewerRequest(b, identity);
});

test('added and deleted templates request only existing scoped sides and optional binding parsing remains independent', async t => {
  for (const added of [true, false]) {
    const f = await fixture(t, { before: added ? { 'owner.ts': component() } : { 'owner.ts': component(), 'screen.view': '{{loading}}\n' }, after: added ? { 'screen.view': '{{loading}}\n' } : { 'screen.view': null } });
    const b = await createReviewBundle({ ...f.options, angularBindings: false }); assert.equal(b.schemaVersion, 'review-bundle/v7'); assert.equal(b.angularTemplateBindings, undefined);
    assert.equal(ownerDecisions(b).length, 1); assert.equal(ownerDecisions(b)[0].side, added ? 'new' : 'old'); assert.equal(b.angularTemplateOwnerContext.scans.length, 1); createReviewerRequest(b, identity);
  }
});

test('unselected rules and binary-only changes skip candidate reads and never imply a complete owner search', async t => {
  const f = await fixture(t, { selectedPaths: ['unmatched.view'] }); const b = await createReviewBundle(f.options);
  assert.equal(ownerDecisions(b)[0].reason, 'rule-not-selected'); assert.equal(b.angularTemplateOwnerContext.scans.length, 0); assert.equal(evidence(b, 'angular-owner-source').length, 0);
  const binary = await fixture(t, { before: { 'screen.view': Buffer.from([0, 1]), 'owner.ts': component() }, after: { 'screen.view': Buffer.from([0, 2]) } });
  const bb = await createReviewBundle(binary.options); assert(ownerDecisions(bb).every(d => d.reason === 'changed-template-text-unavailable')); assert.equal(bb.angularTemplateOwnerContext.scans.length, 0); createReviewerRequest(bb, identity);
});

test('rehashed packets reject omitted owners, forged sources, candidate declarations, classifications and changed blob mismatches', async t => {
  const f = await fixture(t); const b = await createReviewBundle(f.options);
  for (const mutate of [v => ownerDecisions(v)[0].owners = [], v => ownerDecisions(v)[0].owners[0].component.name = 'Fake', v => v.angularTemplateOwnerContext.scans[0].classes = [], v => evidence(v, 'angular-owner-source')[0].content += 'fake', v => evidence(v, 'angular-owner-template-source')[0].origin.object = 'a'.repeat(40), v => v.angularTemplateOwnerContext.policy.candidatePaths.push('unknown.ts'), v => v.angularTemplateBindings.decisions.find(d => d.template).bindings[0].references[0].member.name = 'Fake']) {
    const forged = structuredClone(b); mutate(forged); assert.throws(() => createReviewerRequest(rehash(forged), identity), { code: 'INVALID_REVIEW_BUNDLE' });
  }
});

test('owner-source findings stay inside the selected component scope and template claims retain same-rule provenance', async t => {
  const source = component() + '\nclass Unrelated { invalid = true; }\n'; const f = await fixture(t, { before: { 'screen.view': 'old\n', 'owner.ts': source }, after: { 'screen.view': 'new\n' } });
  const b = await createReviewBundle(f.options); const request = createReviewerRequest(b, identity); const owner = evidence(b, 'angular-owner-source')[0];
  const response = { schemaVersion: 'reviewer-response/v1', requestId: request.id, reviewer: identity, status: 'complete', reviewedRuleIds: ['template-consumer'], contextRequests: [], findings: [{ ruleId: 'template-consumer', severity: 'warning', title: 'Synthetic provenance contract', description: 'No real defect claim.', evidenceIds: [owner.id], location: { evidenceId: owner.id, side: 'source', startLine: 4, endLine: 4 } }] };
  assert.equal(normalizeReviewerResponse(request, response).findings[0].verification, 'unverified');
  response.findings[0].location.startLine = 9; response.findings[0].location.endLine = 9; assert.throws(() => normalizeReviewerResponse(request, response), { code: 'INVALID_REVIEW_RESPONSE' });
  const template = evidence(b, 'angular-owner-template-source')[0]; response.findings[0].evidenceIds = [template.id]; response.findings[0].location = { evidenceId: template.id, side: 'source', startLine: 1, endLine: 1 };
  assert.equal(normalizeReviewerResponse(request, response).findings[0].location.path, 'screen.view');
});

test('candidate configuration and source/template limits fail without partial bundles; CLI exposes explicit paths', async t => {
  const f = await fixture(t);
  for (const paths of [[], ['owner.ts', 'owner.ts'], ['../owner.ts'], ['owner.d.ts'], ['owner.js'], Array.from({ length: 33 }, (_, i) => `owner${i}.ts`)]) await assert.rejects(createReviewBundle({ ...f.options, angularOwnerPaths: paths }), { code: 'INVALID_INPUT' });
  await assert.rejects(createReviewBundle({ ...f.options, angularTemplates: false, angularBindings: false }), { code: 'INVALID_INPUT' });
  const large = await fixture(t, { before: { 'screen.view': 'x'.repeat(32769), 'owner.ts': component() }, after: { 'screen.view': 'y'.repeat(32769) } }); await assert.rejects(createReviewBundle(large.options), { code: 'OUTPUT_LIMIT' });
  await f.put('rules.json', f.options.rulesYaml);
  const args = [resolve('src/cli.js'), 'bundle', '--repo', f.repo, '--base', f.base, '--head', f.head, '--rules', join(f.repo, 'rules.json'), '--rule-source', 'pinned', '--angular-templates', '--angular-bindings', '--angular-owner', 'owner.ts'];
  const good = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 30000 }); assert.equal(good.status, 0, good.stderr); assert.equal(JSON.parse(good.stdout).schemaVersion, 'review-bundle/v7');
  const bad = spawnSync(process.execPath, [...args, '--angular-owner', 'owner.ts'], { encoding: 'utf8', timeout: 30000 }); assert.equal(bad.status, 1); assert.equal(bad.stdout, '');
});

test('candidate byte and owned-template side counts fail before publishing a partial ownership result', async t => {
  const before = { 'screen.view': 'old\n' }, ownerPaths = [];
  for (let i = 0; i < 5; i++) { const path = `owner${i}.ts`; ownerPaths.push(path); before[path] = component(undefined, `Panel${i}`) + '// ' + 'x'.repeat(500000); }
  const many = await fixture(t, { before, after: { 'screen.view': 'new\n' }, ownerPaths }); await assert.rejects(createReviewBundle(many.options), { code: 'ANGULAR_OWNER_LIMIT' });
  const huge = await fixture(t, { before: { 'screen.view': 'old\n', 'owner.ts': component() + '// ' + 'x'.repeat(524289) }, after: { 'screen.view': 'new\n' } }); await assert.rejects(createReviewBundle(huge.options), { code: 'OUTPUT_LIMIT' });
  const views = {}; const after = {}; let source = '';
  for (let i = 0; i < 6; i++) { views[`screen${i}.view`] = 'old\n'; after[`screen${i}.view`] = 'new\n'; source += component(`./screen${i}.view`, `Panel${i}`, i === 0 ? undefined : ''); }
  views['owner.ts'] = source; const templates = await fixture(t, { before: views, after }); await assert.rejects(createReviewBundle(templates.options), { code: 'ANGULAR_OWNER_LIMIT' });
});

test('owner-source claims cannot cite a different component selected by another rule in the same candidate file', async t => {
  const source = component('./left.view', 'Left') + component('./right.view', 'Right', '');
  const f = await fixture(t, { before: { 'left.view': 'old\n', 'right.view': 'old\n', 'owner.ts': source }, after: { 'left.view': 'new\n', 'right.view': 'new\n' } });
  const rulesYaml = JSON.stringify({ schemaVersion: 'review-rules/v3', rules: ['left', 'right'].map(id => ({ id, title: id, instruction: 'Authored scope control.', scope: { paths: [`${id}.view`] } })) });
  const b = await createReviewBundle({ ...f.options, rulesYaml }); const request = createReviewerRequest(b, identity), candidate = evidence(b, 'angular-owner-source')[0];
  const right = ownerDecisions(b).find(d => d.ruleId === 'right' && d.commit === candidate.origin.commit).owners[0];
  const response = { schemaVersion: 'reviewer-response/v1', requestId: request.id, reviewer: identity, status: 'complete', reviewedRuleIds: ['left', 'right'], contextRequests: [], findings: [{ ruleId: 'left', severity: 'warning', title: 'Scope control', description: 'Not an actual defect.', evidenceIds: [candidate.id], location: { evidenceId: candidate.id, side: 'source', startLine: right.component.origin.start.line, endLine: right.component.origin.end.line - 1 } }] };
  assert.throws(() => normalizeReviewerResponse(request, response), { code: 'INVALID_REVIEW_RESPONSE' }); response.findings[0].ruleId = 'right'; assert.equal(normalizeReviewerResponse(request, response).findings[0].verification, 'unverified');
});

test('GitLab, caller envelope and authored fact/rule expectations accept v7 without inventing HTML syntax rules', async t => {
  const f = await fixture(t); const context = await createRuleContextBundle({ ...f.options, contextPolicy: [{ ruleId: 'template-consumer', kind: 'direct-callers', sides: ['new'] }] });
  assert.equal(context.contextPlan.requests.length, 0); assert.equal(context.bundle.schemaVersion, 'review-bundle/v7'); createReviewerRequest(context.bundle, identity);
  const mergeRequest = normalizeGitLabMergeRequest({ id: 9, project_id: 1, target_project_id: 1, source_project_id: 1, iid: 2, state: 'opened', sha: f.head, diff_refs: { base_sha: f.base, start_sha: f.base, head_sha: f.head } }, { instanceUrl: 'https://gitlab.example.test', projectId: 1, mergeRequestIid: 2 });
  const wrapped = await createGitLabReviewBundle({ repo: f.repo, mergeRequest, rulesYaml: f.options.rulesYaml, ruleSource: 'pinned', angularTemplates: true, angularOwnerPaths: ['owner.ts'], angularBindings: true }); createReviewerRequest(wrapped.bundle, identity);
  const expectations = { schemaVersion: 'review-acceptance-expectations/v1', caseId: 'html-owner', cohort: 'development', provenance: { kind: 'synthetic', author: 'contract-test', revision: '1' }, revisions: wrapped.bundle.provenance.revisions, ruleConfigId: wrapped.bundle.ruleSelection.configId, ruleSource: 'pinned', changes: [{ status: 'M', oldPath: 'screen.view', newPath: 'screen.view', oldKind: 'file', newKind: 'file', coverage: 'text-diff', addedLines: 1, removedLines: 1, selectedRuleIds: ['template-consumer'], requiredPatchLines: ['-<button [disabled]="loading">old</button>'], sourceCoverage: null }] };
  assert.equal(auditReviewBundle(wrapped.bundle, expectations).passed, true);
});

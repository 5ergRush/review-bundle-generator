import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import { createReviewBundle, createRuleContextBundle, createReviewerRequest, compileReviewBundle, ingestGitDiff, normalizeReviewerResponse, normalizeGitLabMergeRequest, createGitLabReviewBundle } from '../src/index.js';

const predicate = { side: 'removed', kind: 'throw-guard', identifiers: ['amount'], within: 'validate' };
const rules = (when = predicate) => stringify({ schemaVersion: 'review-rules/v3', rules: [{ id: 'amount', title: 'Amount validation', instruction: 'Check equivalent enforcement and actual callers.', scope: { paths: ['*.ts'] }, when: { changedSyntax: [when] } }] });
const long = (name = 'validate', statement = "if (amount <= 0) throw new Error('invalid');") => `export function ${name}(amount: number) {\n${'  void amount;\n'.repeat(20)}  ${statement}\n${'  void amount;\n'.repeat(20)}  return true;\n}\n`;
async function fixture(t, before = long(), after = long('validate', ''), extra = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'review-source-rules-')); t.after(() => rm(repo, { recursive: true, force: true }));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = (...args) => execFileSync('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'commit.gpgSign=false', ...args], { cwd: repo, env, encoding: 'utf8' }).trim();
  git('init', '-q', '--template=', '--initial-branch=main');
  const put = (path, text) => writeFile(join(repo, path), text);
  for (const [path, text] of Object.entries(extra)) await put(path, text);
  await put('caller.ts', "import { validate } from './target';\nconst invoke = validate;\ninvoke(-1);\n");
  const commit = async text => { if (text === null) await rm(join(repo, 'target.ts'), { force: true }); else await put('target.ts', text); git('add', '-A'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  const base = await commit(before); const head = await commit(after);
  return { put, options: { repo, base, head, comparison: 'direct', rulesYaml: rules(), ruleSource: 'pinned' } };
}
const selected = bundle => bundle.ruleSelection.decisions[0];
const identity = { id: 'source-contract', version: '1' };
const rehash = (value, prefix) => { const { id, ...payload } = value; value.id = `${prefix}:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`; return value; };

test('pinned full source recovers long function scope while patch-only mode remains explicit unavailable', async t => {
  const f = await fixture(t); const patch = await createReviewBundle({ ...f.options, ruleSource: 'patch' });
  assert.equal(selected(patch).status, 'skipped'); assert.equal(selected(patch).reason, 'syntax-evidence-unavailable');
  const bundle = await createReviewBundle(f.options); assert.equal(bundle.schemaVersion, 'review-bundle/v4'); assert.equal(bundle.ruleSelection.schemaVersion, 'rule-selection/v4');
  assert.deepEqual(bundle.facts, patch.facts); assert.deepEqual(bundle.changes, patch.changes);
  assert.equal(selected(bundle).status, 'matched'); assert.equal(bundle.coverage.stages.semanticAnalysis, 'not-run');
  const observation = selected(bundle).matches[0].syntaxMatches[0][0]; assert.equal(observation.withinLine, 1); assert.equal(observation.startLine, 22);
  const source = bundle.evidence.find(item => item.id === observation.sourceEvidenceId); assert.equal(source.origin.commit, f.options.base); assert.equal(source.content, long());
  assert.equal(source.origin.object, bundle.changes[0].oldObject); assert.equal(source.type, 'typescript-rule-source');
  const packet = createReviewerRequest(bundle, identity); assert.equal(packet.selectedRules.length, 1);
  await f.put('target.ts', 'dirty'); await f.put('caller.ts', 'dirty'); assert.deepEqual(await createReviewBundle(f.options), bundle);
});

test('full-source selection feeds automatic old/new callers with normal alias evidence', async t => {
  const f = await fixture(t); const envelope = await createRuleContextBundle({ ...f.options, contextPolicy: [{ ruleId: 'amount', kind: 'direct-callers', sides: ['old', 'new'] }] });
  assert.equal(envelope.bundle.schemaVersion, 'review-bundle/v4'); assert.equal(envelope.contextPlan.requests.length, 2);
  for (const decision of envelope.bundle.contextExpansion.decisions) { assert.equal(decision.matches.length, 1); assert.equal(decision.matches[0].resolution.kind, 'local-const-alias'); }
  createReviewerRequest(envelope.bundle, identity);
});

for (const [name, before, after] of [
  ['another function', long('refresh'), long('refresh', '')],
  ['comment edit on a guard line', long(), long('validate', "if (amount <= 0) throw new Error('invalid'); // comment")],
  ['fake guard in a string', long('validate', 'const fake = "if (amount <= 0) throw new Error()";'), long('validate', '')],
  ['unrelated statement edit', long(), long().replace('return true;', 'return false;')],
]) test(`${name} does not select the full-source invariant`, async t => {
  const f = await fixture(t, before, after); const bundle = await createReviewBundle(f.options); assert.equal(selected(bundle).status, 'skipped'); createReviewerRequest(bundle, identity);
});

test('full-file parse diagnostics remain unavailable even if the edited fragment parses', async t => {
  const f = await fixture(t, long() + 'function broken( {\n', long('validate', '') + 'function broken( {\n');
  const bundle = await createReviewBundle(f.options); assert.equal(selected(bundle).reason, 'syntax-evidence-unavailable'); assert.equal(bundle.ruleSelection.sourceCoverage[0].reason, 'parse-unavailable');
  createReviewerRequest(bundle, identity);
});

test('anonymous callbacks do not acquire the outer named function qualifier', async t => {
  const before = long('validate', "[1].map(() => { if (amount <= 0) throw new Error('invalid'); });");
  const f = await fixture(t, before, long('validate', '[1].map(() => {});')); const bundle = await createReviewBundle(f.options);
  assert.equal(selected(bundle).reason, 'syntax-evidence-unavailable');
});

test('renaming an enclosing function anchors unchanged distant guards to the header hunk', async t => {
  const f = await fixture(t, long(), long('refresh')); const bundle = await createReviewBundle(f.options);
  assert.equal(selected(bundle).status, 'matched'); const observation = selected(bundle).matches[0].syntaxMatches[0][0]; assert.equal(observation.startLine, 22); assert.equal(observation.withinLine, 1);
  assert.equal(bundle.evidence.find(item => item.id === observation.evidenceId).hunks[observation.hunkIndex].old.start, 1);
  createReviewerRequest(bundle, identity);
});

test('qualified parent scopes distinguish identical calls moved between same-named class methods', async t => {
  const f = await fixture(t, 'export class First { ngOnDestroy() { this.subscription.unsubscribe(); } }\nexport class Second { ngOnDestroy() {} }\n', 'export class First { ngOnDestroy() {} }\nexport class Second { ngOnDestroy() { this.subscription.unsubscribe(); } }\n');
  const bundle = await createReviewBundle({ ...f.options, rulesYaml: rules({ side: 'removed', kind: 'member-call', callee: 'this.subscription.unsubscribe', within: 'ngOnDestroy' }) });
  assert.equal(selected(bundle).status, 'matched'); assert.equal(selected(bundle).matches[0].syntaxMatches[0][0].startLine, 1); createReviewerRequest(bundle, identity);
});

test('long method state assignments use full-source enclosing names and literal this targets', async t => {
  const source = (method, statement) => `export class Screen {\n  loading = false;\n  ${method}() {\n${'    void this.loading;\n'.repeat(20)}    ${statement}\n${'    void this.loading;\n'.repeat(20)}  }\n}\n`;
  const f = await fixture(t, source('load', 'this.loading = true;'), source('load', ''));
  const when = { side: 'removed', kind: 'assignment', target: 'this.loading', within: 'load' };
  const bundle = await createReviewBundle({ ...f.options, rulesYaml: rules(when) }); assert.equal(selected(bundle).status, 'matched'); createReviewerRequest(bundle, identity);
  const g = await fixture(t, source('reset', 'this.loading = true;'), source('reset', ''));
  assert.equal(selected(await createReviewBundle({ ...g.options, rulesYaml: rules(when) })).status, 'skipped');
});

test('empty old source sides have byte-verified empty ranges without fabricated observations', async t => {
  const f = await fixture(t, '', long()); const bundle = await createReviewBundle({ ...f.options, rulesYaml: rules({ ...predicate, side: 'added' }) });
  const empty = bundle.evidence.find(item => item.type === 'typescript-rule-source' && item.side === 'old'); assert.equal(empty.content, '');
  assert.deepEqual(empty.origin.end, { line: 1, column: 1 }); assert.equal(selected(bundle).status, 'matched'); createReviewerRequest(bundle, identity);
});

test('added and deleted files retain only their existing source side', async t => {
  const f = await fixture(t, null, long()); const added = await createReviewBundle({ ...f.options, rulesYaml: rules({ ...predicate, side: 'added' }) });
  assert.equal(selected(added).status, 'matched'); assert.equal(added.evidence.filter(item => item.type === 'typescript-rule-source').length, 1); createReviewerRequest(added, identity);
  const g = await fixture(t, long(), null); const deleted = await createReviewBundle(g.options); assert.equal(selected(deleted).status, 'matched'); assert.equal(deleted.evidence.filter(item => item.type === 'typescript-rule-source').length, 1); createReviewerRequest(deleted, identity);
});

test('BOM and CRLF source bytes match their pinned blob hashes and coordinates', async t => {
  const f = await fixture(t, '\uFEFF' + long().replaceAll('\n', '\r\n'), '\uFEFF' + long('validate', '').replaceAll('\n', '\r\n'));
  const bundle = await createReviewBundle(f.options); assert.equal(selected(bundle).status, 'matched'); assert(bundle.evidence.find(item => item.type === 'typescript-rule-source').content.startsWith('\uFEFF')); createReviewerRequest(bundle, identity);
});

test('unsupported line separators have explicit unavailable source coverage', async t => {
  const f = await fixture(t, long().replace('export', '// marker\u2028\nexport'), long('validate', '').replace('export', '// marker\u2028\nexport'));
  const bundle = await createReviewBundle(f.options); assert.equal(selected(bundle).status, 'skipped'); assert.equal(bundle.ruleSelection.sourceCoverage[0].reason, 'unsupported-line-separators'); createReviewerRequest(bundle, identity);
});

test('offline compiler requires complete byte-verified source evidence and clones it', async t => {
  const f = await fixture(t); const bundle = await createReviewBundle(f.options); const snapshot = await ingestGitDiff(f.options);
  const sources = bundle.evidence.filter(item => item.type === 'typescript-rule-source');
  const compiled = compileReviewBundle(snapshot, { rulesYaml: f.options.rulesYaml, ruleSource: 'pinned', ruleSourceEvidence: sources }); assert.deepEqual(compiled, bundle);
  assert.throws(() => compileReviewBundle(snapshot, { rulesYaml: f.options.rulesYaml, ruleSource: 'pinned' }), { code: 'INVALID_RULE_SOURCE' });
  assert.throws(() => compileReviewBundle(snapshot, { rulesYaml: f.options.rulesYaml, ruleSource: 'pinned', ruleSourceEvidence: sources.slice(1) }), { code: 'INVALID_RULE_SOURCE' });
  sources[0].content = 'changed'; assert.notEqual(compiled.evidence.find(item => item.type === 'typescript-rule-source').content, 'changed');
});

test('source records reject oversized collections and invalid configuration without output', async t => {
  const f = await fixture(t); const snapshot = await ingestGitDiff(f.options);
  assert.throws(() => compileReviewBundle(snapshot, { rulesYaml: f.options.rulesYaml, ruleSource: 'pinned', ruleSourceEvidence: Array(65).fill({}) }), { code: 'RULE_SOURCE_LIMIT' });
  await assert.rejects(createReviewBundle({ ...f.options, rulesYaml: undefined }), { code: 'INVALID_INPUT' });
  await assert.rejects(createReviewBundle({ ...f.options, ruleSource: 'automatic' }), { code: 'INVALID_INPUT' });
  await assert.rejects(createReviewBundle({ ...f.options, maxBundleBytes: 1 }), { code: 'BUNDLE_LIMIT' });
});

test('packets reject source-byte, blob, revision, side, coverage and observation forgery', async t => {
  const f = await fixture(t); const original = await createReviewBundle(f.options);
  for (const mutate of [
    bundle => { bundle.evidence.find(item => item.type === 'typescript-rule-source').content += '// fake'; },
    bundle => { bundle.evidence.find(item => item.type === 'typescript-rule-source').origin.object = 'a'.repeat(40); },
    bundle => { bundle.evidence.find(item => item.type === 'typescript-rule-source').origin.commit = f.options.head; },
    bundle => { bundle.evidence.find(item => item.type === 'typescript-rule-source').side = 'new'; },
    bundle => { bundle.ruleSelection.sourceCoverage[0].available = false; },
    bundle => { selected(bundle).matches[0].syntaxMatches[0][0].withinLine = 22; },
    bundle => { bundle.schemaVersion = 'review-bundle/v2'; },
    bundle => { bundle.evidence = bundle.evidence.filter(item => item.type !== 'typescript-rule-source'); },
  ]) {
    const bundle = JSON.parse(JSON.stringify(original)); mutate(bundle);
    for (const record of bundle.evidence) if (record.type === 'typescript-rule-source') rehash(record, 'evidence');
    assert.throws(() => createReviewerRequest(rehash(bundle, 'bundle'), identity), { code: 'INVALID_REVIEW_BUNDLE' });
  }
});

test('normalized reviewer claims can cite pinned rule-source lines in the matched change', async t => {
  const f = await fixture(t); const bundle = await createReviewBundle(f.options); const request = createReviewerRequest(bundle, identity);
  const source = bundle.evidence.find(item => item.type === 'typescript-rule-source' && item.side === 'old');
  const response = { schemaVersion: 'reviewer-response/v1', requestId: request.id, reviewer: identity, status: 'complete', reviewedRuleIds: ['amount'], contextRequests: [], findings: [
    { ruleId: 'amount', severity: 'warning', title: 'Synthetic contract claim', description: 'Not an actual reviewed defect.', evidenceIds: [source.id], location: { evidenceId: source.id, side: 'source', startLine: 22, endLine: 22 } },
  ] };
  const result = normalizeReviewerResponse(request, response); assert.equal(result.findings[0].location.commit, f.options.base); assert.equal(result.findings[0].verification, 'unverified');
});

test('CLI pinned source mode emits bundle v4 and structured input errors', async t => {
  const f = await fixture(t); await f.put('rules.yaml', f.options.rulesYaml);
  const args = [resolve('src/cli.js'), 'bundle', '--repo', f.options.repo, '--base', f.options.base, '--rules', join(f.options.repo, 'rules.yaml'), '--rule-source', 'pinned'];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); createReviewerRequest(JSON.parse(result.stdout), identity);
  args[args.length - 1] = 'unknown'; const bad = spawnSync(process.execPath, args, { encoding: 'utf8' }); assert.equal(bad.status, 1); assert.equal(bad.stdout, ''); assert.equal(JSON.parse(bad.stderr).error.code, 'INVALID_INPUT');
});

test('GitLab wrapper passes pinned rule mode using its existing immutable diff refs', async t => {
  const f = await fixture(t);
  const mergeRequest = normalizeGitLabMergeRequest({ id: 900, project_id: 100, target_project_id: 100, source_project_id: 201, iid: 7, state: 'opened', sha: f.options.head,
    diff_refs: { base_sha: f.options.base, head_sha: f.options.head, start_sha: f.options.base }, title: 'Fixture' },
  { instanceUrl: 'https://gitlab.example.invalid', projectId: 100, mergeRequestIid: 7 });
  const envelope = await createGitLabReviewBundle({ repo: f.options.repo, rulesYaml: f.options.rulesYaml, ruleSource: 'pinned', mergeRequest });
  assert.equal(envelope.bundle.schemaVersion, 'review-bundle/v4'); assert.equal(selected(envelope.bundle).status, 'matched'); createReviewerRequest(envelope.bundle, identity);
});

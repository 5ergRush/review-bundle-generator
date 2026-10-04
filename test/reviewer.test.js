import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReviewBundle, createReviewerRequest, normalizeReviewerResponse, runReviewerAdapter } from '../src/index.js';

const identity = { id: 'synthetic-reviewer', version: 'fixture-v1' };
const copy = value => JSON.parse(JSON.stringify(value));
const rehash = (value, prefix) => { const { id, ...payload } = value; value.id = `${prefix}:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`; return value; };
const rulesYaml = `schemaVersion: review-rules/v1
rules:
  - id: target-rule
    title: Target rule
    instruction: Review target changes using supplied evidence.
    scope:
      paths: [target.ts]
  - id: other-rule
    title: Other rule
    instruction: Review other changes using supplied evidence.
    scope:
      paths: [other.ts]
  - id: skipped-rule
    title: Skipped rule
    instruction: This rule must not be selected.
    scope:
      paths: [absent.ts]
`;
async function fixture(t, options = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'reviewer-contract-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: {
    ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  } }).trim();
  git('init', '-q', '--initial-branch=main');
  const put = (path, content) => writeFile(join(repo, path), content);
  const commit = () => { git('add', '-A'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  await put('target.ts', 'export function target() { return 1; }\n');
  await put('other.ts', 'export const other = 1;\n');
  await put('caller.ts', "import {target} from './target';\nexport function caller() { return target(); }\n");
  const base = commit(); await put('target.ts', 'export function target() { return 2; }\n');
  await put('other.ts', 'export const other = 2;\n'); const head = commit();
  const bundleOptions = { repo, base, head, rulesYaml, ...options };
  const bundle = await createReviewBundle(bundleOptions);
  const request = createReviewerRequest(bundle, identity);
  const evidence = bundle.evidence.find(item => item.origin.new.path === 'target.ts');
  const finding = { ruleId: 'target-rule', severity: 'warning', title: 'Synthetic claim', description: 'Fixture only; not a validated defect.',
    evidenceIds: [evidence.id], location: { evidenceId: evidence.id, side: 'new', startLine: 1, endLine: 1 } };
  const response = { schemaVersion: 'reviewer-response/v1', requestId: request.id, reviewer: identity,
    status: 'complete', reviewedRuleIds: ['target-rule', 'other-rule'], findings: [finding], contextRequests: [] };
  return { repo, put, commit, bundleOptions, bundle, request, finding, response };
}

test('packet selects matched review instructions and is immutable without freezing caller data', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.request.selectedRules.map(item => item.id), ['other-rule', 'target-rule']);
  assert.equal(f.request.bundleId, f.bundle.id);
  assert.equal(f.request.policy.sourceContent, 'untrusted-review-data');
  assert(Object.isFrozen(f.request.bundle.evidence[0])); assert(!Object.isFrozen(f.bundle));
  f.bundle.coverage.limitations.push('caller mutation');
  assert(!f.request.bundle.coverage.limitations.includes('caller mutation'));
  assert.throws(() => { f.request.selectedRules[0].instruction = 'mutated'; }, TypeError);
});

test('findings derive immutable locations and preserve reviewer/rule/bundle provenance', async t => {
  const f = await fixture(t); const result = normalizeReviewerResponse(f.request, f.response);
  const finding = result.findings[0];
  assert.equal(finding.location.commit, f.bundleOptions.head); assert.equal(finding.location.path, 'target.ts');
  assert.equal(finding.ruleConfigId, f.bundle.ruleSelection.configId); assert.deepEqual(finding.reviewer, identity);
  assert.equal(finding.requestId, f.request.id); assert.equal(finding.bundleId, f.bundle.id);
  assert.equal(finding.verification, 'unverified'); assert.equal(result.coverage.status, 'partial');
  assert.equal(result.coverage.reviewer.status, 'complete'); assert.deepEqual(result.coverage.bundle, f.bundle.coverage);
  assert(Object.isFrozen(result.findings));
});

test('duplicate claims deduplicate; ordering of findings, evidence IDs and reviewed rules is normalized', async t => {
  const f = await fixture(t);
  const evidence = f.bundle.evidence.find(item => item.origin.new.path === 'other.ts');
  const first = copy(f.finding); first.evidenceIds.push(evidence.id);
  const second = { ...copy(f.finding), title: 'Another synthetic claim' };
  const a = normalizeReviewerResponse(f.request, { ...f.response, findings: [first, second, first] });
  first.evidenceIds.reverse();
  const b = normalizeReviewerResponse(f.request, { ...f.response, reviewedRuleIds: ['other-rule', 'target-rule'], findings: [second, first] });
  assert.deepEqual(a, b); assert.equal(a.findings.length, 2);
});

test('foreign request/reviewer, unselected rules and unreviewed claims fail without a result', async t => {
  const f = await fixture(t);
  for (const patch of [{ requestId: 'request:' + '0'.repeat(64) }, { reviewer: { ...identity, version: 'different' } },
    { reviewedRuleIds: ['skipped-rule'] }, { reviewedRuleIds: ['other-rule'] }, { status: 'unknown' }, { extra: true }]) {
    assert.throws(() => normalizeReviewerResponse(f.request, { ...f.response, ...patch }), { code: 'INVALID_REVIEW_RESPONSE' });
  }
});

test('evidence references, line ranges and rule scopes are checked', async t => {
  const f = await fixture(t); const other = f.bundle.evidence.find(item => item.origin.new.path === 'other.ts');
  for (const change of [item => { item.evidenceIds = []; }, item => { item.evidenceIds = ['evidence:unknown']; },
    item => { item.location.startLine = 0; }, item => { item.location.endLine = 99; },
    item => { item.location.side = 'source'; }, item => { item.location.path = 'forged.ts'; },
    item => { item.evidenceIds = [other.id]; item.location.evidenceId = other.id; }]) {
    const finding = copy(f.finding); change(finding);
    assert.throws(() => normalizeReviewerResponse(f.request, { ...f.response, findings: [finding] }), { code: 'INVALID_REVIEW_RESPONSE' });
  }
  const old = copy(f.finding); old.location.side = 'old';
  assert.equal(normalizeReviewerResponse(f.request, { ...f.response, findings: [old] }).findings[0].location.commit, f.bundleOptions.base);
});

test('incomplete review cannot be promoted by a complete status; empty findings are not a clean verdict', async t => {
  const f = await fixture(t);
  const result = normalizeReviewerResponse(f.request, { ...f.response, reviewedRuleIds: [], findings: [] });
  assert.equal(result.coverage.reviewer.reportedStatus, 'complete'); assert.equal(result.coverage.reviewer.status, 'partial');
  assert.deepEqual(result.coverage.reviewer.pendingRuleIds, ['other-rule', 'target-rule']);
  assert.equal(result.coverage.status, 'partial'); assert(result.limitations.some(item => item.includes('absence of defects')));
});

test('v1 bundles support generic findings with a null rule and preserve not-run coverage', async t => {
  const f = await fixture(t, { rulesYaml: undefined });
  const result = normalizeReviewerResponse(f.request, { ...f.response, reviewedRuleIds: [], findings: [{ ...f.finding, ruleId: null }] });
  assert.equal(result.findings[0].ruleConfigId, null); assert.equal(result.coverage.bundle.stages.semanticAnalysis, 'not-run');
});

test('context requests require supplied declarations and needs-context status', async t => {
  const f = await fixture(t, { semantic: true });
  const targetId = f.bundle.semanticAnalysis.declarations.find(item => item.side === 'new' && item.name === 'target').id;
  const response = { ...f.response, status: 'needs-context', contextRequests: [{ kind: 'direct-callers', targetId }] };
  const result = normalizeReviewerResponse(f.request, response); assert.deepEqual(result.contextRequests, response.contextRequests);
  for (const patch of [{ status: 'complete' }, { contextRequests: [] },
    { contextRequests: [{ kind: 'direct-callers', targetId: 'declaration:unknown' }] },
    { contextRequests: [response.contextRequests[0], response.contextRequests[0]] }]) {
    assert.throws(() => normalizeReviewerResponse(f.request, { ...response, ...patch }), { code: 'INVALID_REVIEW_RESPONSE' });
  }
});

test('caller-source findings are bound to source ranges and the originating rule match', async t => {
  const f = await fixture(t, { semantic: true });
  const target = f.bundle.semanticAnalysis.declarations.find(item => item.side === 'new' && item.name === 'target');
  const bundle = await createReviewBundle({ ...f.bundleOptions, contextRequests: [{ kind: 'direct-callers', targetId: target.id }] });
  const request = createReviewerRequest(bundle, identity); const evidence = bundle.evidence.find(item => item.type === 'typescript-source');
  const finding = { ...f.finding, evidenceIds: [evidence.id], location: { evidenceId: evidence.id, side: 'source', startLine: evidence.origin.start.line, endLine: evidence.origin.start.line } };
  const response = { ...f.response, requestId: request.id, findings: [finding] };
  assert.equal(normalizeReviewerResponse(request, response).findings[0].location.path, 'caller.ts');
  assert.throws(() => normalizeReviewerResponse(request, { ...response, findings: [{ ...finding, ruleId: 'other-rule' }] }), { code: 'INVALID_REVIEW_RESPONSE' });
  assert.throws(() => normalizeReviewerResponse(request, { ...response, findings: [{ ...finding, location: { ...finding.location, endLine: 999 } }] }), { code: 'INVALID_REVIEW_RESPONSE' });
});

test('tampered bundle records, selections, requests and IDs fail validation', async t => {
  const f = await fixture(t);
  for (const mutate of [bundle => { bundle.evidence[0].content += 'forged'; }, bundle => { bundle.facts[0].value = {}; },
    bundle => { bundle.ruleSelection.decisions[0].status = 'skipped'; }, bundle => { bundle.ruleSelection.rules[0].instruction = 'forged'; },
    bundle => { bundle.changes[0].evidenceIds = []; }, bundle => { bundle.summary.addedLines = 0; }]) {
    const bundle = copy(f.bundle); mutate(bundle); rehash(bundle, 'bundle');
    assert.throws(() => createReviewerRequest(bundle, identity), { code: 'INVALID_REVIEW_BUNDLE' });
  }
  const request = copy(f.request); request.policy.maxFindings = 999; rehash(request, 'request');
  assert.throws(() => normalizeReviewerResponse(request, { ...f.response, requestId: request.id }), { code: 'INVALID_REVIEW_REQUEST' });
});

test('byte budgets apply to exact serialized output; malformed JSON values are rejected', async t => {
  const f = await fixture(t); const result = normalizeReviewerResponse(f.request, f.response);
  assert.deepEqual(createReviewerRequest(f.bundle, identity, { maxRequestBytes: Buffer.byteLength(JSON.stringify(f.request)) }), f.request);
  assert.throws(() => createReviewerRequest(f.bundle, identity, { maxRequestBytes: Buffer.byteLength(JSON.stringify(f.request)) - 1 }), { code: 'REVIEW_LIMIT' });
  assert.throws(() => normalizeReviewerResponse(f.request, f.response, { maxResponseBytes: 1 }), { code: 'REVIEW_LIMIT' });
  assert.throws(() => normalizeReviewerResponse(f.request, f.response, { maxResultBytes: Buffer.byteLength(JSON.stringify(result)) - 1 }), { code: 'REVIEW_LIMIT' });
  const cyclic = copy(f.response); cyclic.findings.push(cyclic);
  assert.throws(() => normalizeReviewerResponse(f.request, cyclic), { code: 'INVALID_REVIEW_RESPONSE' });
  assert.throws(() => normalizeReviewerResponse(f.request, { ...f.response, status: undefined }), { code: 'INVALID_REVIEW_RESPONSE' });
  let invoked = false; const accessor = { get bundle() { invoked = true; return f.bundle; } };
  assert.throws(() => createReviewerRequest(accessor, identity), { code: 'INVALID_REVIEW_BUNDLE' }); assert.equal(invoked, false);
});

test('injected adapter normalizes a response and receives frozen input plus AbortSignal', async t => {
  const f = await fixture(t); let calls = 0;
  const result = await runReviewerAdapter(f.request, async (request, { signal }) => {
    calls++; assert(Object.isFrozen(request.bundle)); assert(signal instanceof AbortSignal); return f.response;
  });
  assert.equal(calls, 1); assert.deepEqual(result, normalizeReviewerResponse(f.request, f.response));
});

test('adapter failure redacts arbitrary errors; timeout aborts and never accepts a late response', async t => {
  const f = await fixture(t);
  await assert.rejects(runReviewerAdapter(f.request, () => { throw new Error('private-token'); }), error => error.code === 'REVIEW_ADAPTER_FAILED' && !error.message.includes('private-token'));
  let signal; let late;
  await assert.rejects(runReviewerAdapter(f.request, (request, options) => {
    signal = options.signal; return new Promise(resolve => { late = resolve; });
  }, { timeoutMs: 10 }), { code: 'REVIEW_TIMEOUT' });
  assert(signal.aborted); late(f.response);
  await assert.rejects(runReviewerAdapter(f.request, () => ({ invalid: true })), { code: 'INVALID_REVIEW_RESPONSE' });
});

test('invalid adapter inputs are rejected before invocation and never retried', async t => {
  const f = await fixture(t); let called = false;
  const adapter = () => { called = true; return f.response; };
  await assert.rejects(runReviewerAdapter(f.request, adapter, { maxResponseBytes: 0 }), { code: 'INVALID_INPUT' });
  const request = copy(f.request); request.id = 'request:invalid';
  await assert.rejects(runReviewerAdapter(request, adapter), { code: 'INVALID_REVIEW_REQUEST' }); assert.equal(called, false);
});

test('malformed semantic records and coverage fail with a contract error', async t => {
  const f = await fixture(t, { semantic: true });
  for (const mutate of [bundle => { bundle.semanticAnalysis.declarations = [null]; },
    bundle => { bundle.contextExpansion.decisions = [null]; }, bundle => { bundle.coverage.stages.semanticAnalysis = 'complete'; },
    bundle => { bundle.extra = true; }]) {
    const bundle = copy(f.bundle); mutate(bundle); rehash(bundle, 'bundle');
    assert.throws(() => createReviewerRequest(bundle, identity), { code: 'INVALID_REVIEW_BUNDLE' });
  }
});

test('a synchronous adapter exceeding the deadline cannot bypass the timeout', async t => {
  const f = await fixture(t);
  await assert.rejects(runReviewerAdapter(f.request, () => {
    const deadline = performance.now() + 15; while (performance.now() < deadline) { /* simulate blocking adapter */ }
    return f.response;
  }, { timeoutMs: 5 }), { code: 'REVIEW_TIMEOUT' });
});

test('requested context creates a new packet; a response to the preceding packet is rejected', async t => {
  const f = await fixture(t, { semantic: true });
  const targetId = f.bundle.semanticAnalysis.declarations.find(item => item.side === 'new' && item.name === 'target').id;
  const response = { ...f.response, findings: [], status: 'needs-context', contextRequests: [{ kind: 'direct-callers', targetId }] };
  const first = await runReviewerAdapter(f.request, () => response);
  const expanded = await createReviewBundle({ ...f.bundleOptions, contextRequests: first.contextRequests });
  const next = createReviewerRequest(expanded, identity); assert.notEqual(next.id, f.request.id);
  await assert.rejects(runReviewerAdapter(next, () => response), { code: 'INVALID_REVIEW_RESPONSE' });
  const result = await runReviewerAdapter(next, () => ({ ...response, requestId: next.id, status: 'complete', contextRequests: [] }));
  assert.equal(result.coverage.bundle.stages.contextExpansion, 'complete-static-matches'); assert.equal(result.coverage.status, 'partial');
});

test('locations in omitted gaps between diff hunks are rejected', async t => {
  const f = await fixture(t);
  const before = Array.from({ length: 25 }, (_, index) => `export const line${index} = ${index};`);
  await f.put('target.ts', before.join('\n') + '\n'); const base = f.commit();
  const after = [...before]; after[0] += ' // change'; after[24] += ' // change';
  await f.put('target.ts', after.join('\n') + '\n'); const head = f.commit();
  const bundle = await createReviewBundle({ ...f.bundleOptions, base, head });
  const request = createReviewerRequest(bundle, identity); const evidence = bundle.evidence.find(item => item.origin.new.path === 'target.ts');
  const finding = { ...f.finding, evidenceIds: [evidence.id], location: { evidenceId: evidence.id, side: 'new', startLine: 12, endLine: 12 } };
  assert.equal(evidence.hunks.length, 2);
  assert.throws(() => normalizeReviewerResponse(request, { ...f.response, requestId: request.id, reviewedRuleIds: ['target-rule'], findings: [finding] }), { code: 'INVALID_REVIEW_RESPONSE' });
});

test('offline CLI roundtrip, malformed input, unknown flags and size limits have no partial stdout', async t => {
  const f = await fixture(t); const bundlePath = join(f.repo, 'bundle.json'); const requestPath = join(f.repo, 'request.json'); const responsePath = join(f.repo, 'response.json');
  await writeFile(bundlePath, JSON.stringify(f.bundle)); await writeFile(responsePath, JSON.stringify(f.response));
  const run = args => spawnSync(process.execPath, [resolve('src/cli.js'), ...args], { encoding: 'utf8' });
  const packet = run(['packet', '--bundle', bundlePath, '--reviewer-id', identity.id, '--reviewer-version', identity.version]);
  assert.equal(packet.status, 0, packet.stderr); assert.deepEqual(JSON.parse(packet.stdout), f.request); await writeFile(requestPath, packet.stdout);
  const normalized = run(['normalize', '--request', requestPath, '--response', responsePath]);
  assert.equal(normalized.status, 0, normalized.stderr); assert.equal(JSON.parse(normalized.stdout).findings.length, 1);
  for (const args of [['packet', '--bundle', bundlePath, '--reviewer-id', identity.id, '--reviewer-version', identity.version, '--max-request-bytes', '1'],
    ['packet', '--repo', f.repo], ['normalize', '--request', requestPath, '--response', responsePath, '--max-result-bytes', '1'],
    ['normalize', '--request', f.repo, '--response', responsePath]]) {
    const failure = run(args); assert.equal(failure.status, 1); assert.equal(failure.stdout, ''); assert(JSON.parse(failure.stderr).error.code);
  }
  await writeFile(responsePath, 'invalid JSON'); const malformed = run(['normalize', '--request', requestPath, '--response', responsePath]);
  assert.equal(malformed.status, 1); assert.equal(malformed.stdout, ''); assert.equal(JSON.parse(malformed.stderr).error.code, 'INVALID_INPUT');
});

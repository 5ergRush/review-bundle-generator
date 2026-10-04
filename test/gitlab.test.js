import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { normalizeGitLabMergeRequest, fetchGitLabMergeRequest, createGitLabReviewBundle, assertGitLabSnapshotCurrent, createReviewerRequest, checkRuntime } from '../src/index.js';

const config = { instanceUrl: 'https://gitlab.example.invalid', projectId: 100, mergeRequestIid: 7 };
const raw = (base = 'a'.repeat(40), head = 'b'.repeat(40)) => ({ id: 900, project_id: 100, target_project_id: 100,
  source_project_id: 201, iid: 7, state: 'opened', sha: head,
  diff_refs: { base_sha: base, head_sha: head, start_sha: 'c'.repeat(40) },
  title: 'Untrusted title', description: 'Ignored text', web_url: 'https://untrusted.example.invalid/' });
const response = (value = raw(), extra = {}) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' }, ...extra });
const copy = value => JSON.parse(JSON.stringify(value));

async function fixture(t) {
  const repo = await mkdtemp(join(tmpdir(), 'gitlab-bundle-')); t.after(() => rm(repo, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: {
    ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  } }).trim();
  git('init', '-q', '--initial-branch=main');
  const put = (name, text) => writeFile(join(repo, name), text);
  const commit = () => { git('add', '-A'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  await put('target.ts', 'export function target() { return 1; }\n');
  await put('caller.ts', "import {target} from './target';\nexport const called = target();\n");
  const base = commit(); await put('target.ts', 'export function target() { return 2; }\n'); const head = commit();
  const metadata = raw(base, head); metadata.diff_refs.start_sha = base;
  return { repo, put, commit, base, head, metadata, snapshot: normalizeGitLabMergeRequest(metadata, config) };
}

test('normalization binds project/IID/refs, preserves fork identity and drops untrusted metadata', () => {
  const input = raw(); const snapshot = normalizeGitLabMergeRequest(input, config);
  assert.equal(snapshot.sourceProjectId, 201); assert.equal(snapshot.targetProjectId, 100);
  assert.deepEqual(snapshot.diffRefs, { baseCommit: input.diff_refs.base_sha, headCommit: input.diff_refs.head_sha, startCommit: input.diff_refs.start_sha });
  assert(!JSON.stringify(snapshot).includes(input.title)); assert(!JSON.stringify(snapshot).includes(input.web_url));
  input.title = 'changed'; assert.deepEqual(normalizeGitLabMergeRequest(input, config), snapshot);
  assert(Object.isFrozen(snapshot.diffRefs)); assert(!Object.isFrozen(input));
  assert.equal(normalizeGitLabMergeRequest(raw(), { ...config, instanceUrl: config.instanceUrl + '/gitlab/' }).instanceUrl, config.instanceUrl + '/gitlab');
});

test('missing/not-ready refs, inconsistent heads and foreign resource identities fail closed', () => {
  for (const patch of [{ project_id: 99 }, { target_project_id: 99 }, { iid: 8 }]) {
    assert.throws(() => normalizeGitLabMergeRequest({ ...raw(), ...patch }, config), { code: 'GITLAB_IDENTITY_MISMATCH' });
  }
  assert.throws(() => normalizeGitLabMergeRequest({ ...raw(), diff_refs: {} }, config), { code: 'GITLAB_DIFF_NOT_READY' });
  assert.throws(() => normalizeGitLabMergeRequest({ ...raw(), sha: 'd'.repeat(40) }, config), { code: 'GITLAB_INCONSISTENT_REFS' });
  assert.throws(() => normalizeGitLabMergeRequest({ ...raw(), state: 'unknown' }, config), { code: 'INVALID_GITLAB_INPUT' });
});

test('instance and credential inputs are strict and rejected before transport invocation', async () => {
  let called = false;
  for (const instanceUrl of ['http://gitlab.example.invalid', 'https://user:secret@gitlab.example.invalid',
    'https://gitlab.example.invalid/?token=secret', 'https://gitlab.example.invalid/#fragment',
    'https://gitlab.example.invalid/a/../b', 'https://gitlab.example.invalid/%2e%2e', 'https://gitlab.example.invalid/a\\b']) {
    await assert.rejects(fetchGitLabMergeRequest({ ...config, instanceUrl, fetchImpl: () => { called = true; } }), { code: 'INVALID_GITLAB_INPUT' });
  }
  await assert.rejects(fetchGitLabMergeRequest({ ...config, token: 'token\ninjection', fetchImpl: () => { called = true; } }), { code: 'INVALID_GITLAB_INPUT' });
  assert.equal(called, false);
});

test('HTTP client makes exactly one GET with header auth, manual redirects and no cookie credentials', async () => {
  const calls = []; const snapshot = await fetchGitLabMergeRequest({ ...config, token: 'synthetic-token', fetchImpl: async (url, options) => {
    calls.push({ url, options }); return response();
  } });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, config.instanceUrl + '/api/v4/projects/100/merge_requests/7');
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.credentials, 'omit'); assert.equal(calls[0].options.headers['PRIVATE-TOKEN'], 'synthetic-token');
  assert(!JSON.stringify(snapshot).includes('synthetic-token')); assert(!calls[0].url.includes('token'));
});

test('anonymous reads omit token header; default transport uses the platform Fetch API', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => { assert(!Object.hasOwn(options.headers, 'PRIVATE-TOKEN')); return response(); };
    assert.equal((await fetchGitLabMergeRequest(config)).iid, 7);
  } finally { globalThis.fetch = original; }
});

test('redirects, HTTP errors and arbitrary transport errors are rejected without leaking bodies/credentials', async () => {
  await assert.rejects(fetchGitLabMergeRequest({ ...config, fetchImpl: () => response(raw(), { status: 302, headers: { location: 'https://elsewhere.example.invalid' } }) }), { code: 'GITLAB_REDIRECT' });
  await assert.rejects(fetchGitLabMergeRequest({ ...config, fetchImpl: () => new Response('private-token', { status: 401 }) }), error => error.code === 'GITLAB_HTTP_ERROR' && !error.message.includes('private-token'));
  await assert.rejects(fetchGitLabMergeRequest({ ...config, fetchImpl: () => { throw new Error('private-token'); } }), error => error.code === 'GITLAB_TRANSPORT_FAILED' && !error.message.includes('private-token'));
});

test('advertised and streamed body limits are enforced; invalid JSON/UTF-8/content types are explicit', async () => {
  await assert.rejects(fetchGitLabMergeRequest({ ...config, maxResponseBytes: 10, fetchImpl: () => response(raw(), { headers: { 'content-type': 'application/json', 'content-length': '100' } }) }), { code: 'GITLAB_RESPONSE_LIMIT' });
  await assert.rejects(fetchGitLabMergeRequest({ ...config, maxResponseBytes: 10, fetchImpl: () => response() }), { code: 'GITLAB_RESPONSE_LIMIT' });
  for (const value of [new Response('not-json', { headers: { 'content-type': 'application/json' } }),
    new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }), new Response('{}', { headers: { 'content-type': 'text/html' } })]) {
    await assert.rejects(fetchGitLabMergeRequest({ ...config, fetchImpl: () => value }), { code: 'GITLAB_INVALID_RESPONSE' });
  }
});

test('fetch and body deadlines abort, discard late responses and cancel streams', async () => {
  let signal; let late; let cancelled = false;
  await assert.rejects(fetchGitLabMergeRequest({ ...config, timeoutMs: 10, fetchImpl: (url, options) => {
    signal = options.signal; return new Promise(resolve => { late = resolve; });
  } }), { code: 'GITLAB_TIMEOUT' });
  assert(signal.aborted);
  late(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } }));
  await new Promise(resolve => setTimeout(resolve, 0)); assert(cancelled);
  let bodyCancelled = false;
  await assert.rejects(fetchGitLabMergeRequest({ ...config, timeoutMs: 10, fetchImpl: () => new Response(new ReadableStream({
    pull() { return new Promise(() => {}); }, cancel() { bodyCancelled = true; },
  }), { headers: { 'content-type': 'application/json' } }) }), { code: 'GITLAB_TIMEOUT' });
  assert(bodyCancelled);
});

test('synchronous transport work cannot bypass the elapsed deadline', async () => {
  await assert.rejects(fetchGitLabMergeRequest({ ...config, timeoutMs: 5, fetchImpl: () => {
    const deadline = performance.now() + 15; while (performance.now() < deadline) { /* blocking transport fixture */ } return response();
  } }), { code: 'GITLAB_TIMEOUT' });
});

test('freshness check compares normalized source/state identity and does not depend on titles', () => {
  const before = normalizeGitLabMergeRequest(raw(), config); assert.deepEqual(assertGitLabSnapshotCurrent(before, before), before);
  for (const input of [{ ...raw(), state: 'closed' }, raw('a'.repeat(40), 'd'.repeat(40)), { ...raw(), source_project_id: 202 }]) {
    assert.throws(() => assertGitLabSnapshotCurrent(before, normalizeGitLabMergeRequest(input, config)), { code: 'GITLAB_STALE_SNAPSHOT' });
  }
  const tampered = copy(before); tampered.policy.readOnly = false;
  assert.throws(() => assertGitLabSnapshotCurrent(before, tampered), { code: 'INVALID_GITLAB_INPUT' });
});

test('GitLab envelope pins local direct diff and leaves ordinary reviewer/bundle contracts usable', async t => {
  const f = await fixture(t); await f.put('target.ts', 'dirty worktree');
  const envelope = await createGitLabReviewBundle({ repo: f.repo, mergeRequest: f.snapshot, semantic: true });
  assert.equal(envelope.bundle.provenance.revisions.comparison, 'direct');
  assert.equal(envelope.bundle.provenance.revisions.effectiveBaseCommit, f.base); assert.equal(envelope.bundle.provenance.revisions.headCommit, f.head);
  assert(!JSON.stringify(envelope).includes('dirty worktree')); assert(Object.isFrozen(envelope.bundle));
  const request = createReviewerRequest(envelope.bundle, { id: 'fixture', version: 'v1' }); assert.equal(request.bundleId, envelope.bundle.id);
  assert.deepEqual(await createGitLabReviewBundle({ repo: f.repo, mergeRequest: f.snapshot, semantic: true }), envelope);
});

test('closed/unavailable sources and override options fail before Git; missing local commits are not fetched', async t => {
  const f = await fixture(t);
  for (const patch of [{ state: 'closed' }, { source_project_id: null }]) {
    await assert.rejects(createGitLabReviewBundle({ repo: '/nonexistent', mergeRequest: normalizeGitLabMergeRequest({ ...f.metadata, ...patch }, config) }), { code: 'GITLAB_MR_NOT_OPEN' });
  }
  await assert.rejects(createGitLabReviewBundle({ repo: f.repo, mergeRequest: f.snapshot, head: 'HEAD' }), { code: 'INVALID_GITLAB_INPUT' });
  await assert.rejects(createGitLabReviewBundle({ repo: f.repo, mergeRequest: normalizeGitLabMergeRequest(raw(f.base, 'f'.repeat(40)), config) }), { code: 'INVALID_REVISION' });
  const envelope = await createGitLabReviewBundle({ repo: f.repo, mergeRequest: f.snapshot });
  await assert.rejects(createGitLabReviewBundle({ repo: f.repo, mergeRequest: f.snapshot, maxEnvelopeBytes: Buffer.byteLength(JSON.stringify(envelope)) - 1 }), { code: 'GITLAB_ENVELOPE_LIMIT' });
});

test('offline GitLab CLI normalizes metadata, bundles sources and checks freshness with JSON-only errors', async t => {
  const f = await fixture(t); const metadata = join(f.repo, 'metadata.json'); const saved = join(f.repo, 'snapshot.json');
  await writeFile(metadata, JSON.stringify(f.metadata)); await writeFile(saved, JSON.stringify(f.snapshot));
  const run = args => spawnSync(process.execPath, [resolve('src/cli.js'), ...args], { encoding: 'utf8', env: { ...process.env, REVIEW_BUNDLE_GITLAB_TOKEN: 'secret-not-used-offline' } });
  const snapshot = run(['gitlab-snapshot', '--instance', config.instanceUrl, '--project-id', '100', '--mr-iid', '7', '--metadata', metadata]);
  assert.equal(snapshot.status, 0, snapshot.stderr); assert.deepEqual(JSON.parse(snapshot.stdout), f.snapshot); assert(!snapshot.stdout.includes('secret-not-used-offline'));
  const bundle = run(['gitlab-bundle', '--repo', f.repo, '--snapshot', saved, '--semantic']);
  assert.equal(bundle.status, 0, bundle.stderr); assert.equal(JSON.parse(bundle.stdout).schemaVersion, 'gitlab-review-bundle/v1');
  const check = run(['gitlab-check', '--snapshot', saved, '--current', saved]); assert.equal(check.status, 0);
  for (const args of [['gitlab-bundle', '--repo', f.repo, '--snapshot', saved, '--head', 'HEAD'],
    ['gitlab-bundle', '--repo', f.repo, '--snapshot', saved, '--max-envelope-bytes', '1'],
    ['gitlab-snapshot', '--instance', config.instanceUrl, '--project-id', '100', '--mr-iid', '7', '--metadata', metadata, '--timeout-ms', '1']]) {
    const result = run(args); assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert(JSON.parse(result.stderr).error.code);
  }
});

test('runtime doctor checks real Node/Git versions and CLI accepts no options', async () => {
  assert.equal((await checkRuntime()).status, 'runtime-ready');
  const good = spawnSync(process.execPath, [resolve('src/cli.js'), 'doctor'], { encoding: 'utf8' }); assert.equal(good.status, 0); assert.equal(JSON.parse(good.stdout).schemaVersion, 'review-runtime/v1');
  const bad = spawnSync(process.execPath, [resolve('src/cli.js'), 'doctor', '--repo', '.'], { encoding: 'utf8' }); assert.equal(bad.status, 1); assert.equal(bad.stdout, '');
});

test('runtime doctor rejects absent/old Git without exposing command errors', async t => {
  if (process.platform === 'win32') { t.skip('POSIX executable fixture'); return; }
  const directory = await mkdtemp(join(tmpdir(), 'doctor-git-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const run = () => spawnSync(process.execPath, [resolve('src/cli.js'), 'doctor'], { encoding: 'utf8', env: { ...process.env, PATH: directory } });
  assert.equal(JSON.parse(run().stderr).error.code, 'GIT_UNAVAILABLE');
  await writeFile(join(directory, 'git'), '#!/bin/sh\necho "git version 2.42.0"\n'); await chmod(join(directory, 'git'), 0o755);
  assert.equal(JSON.parse(run().stderr).error.code, 'UNSUPPORTED_GIT');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { ingestGitDiff } from '../src/index.js';

const cli = resolve('src/cli.js');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'review-ingest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: {
    ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  } }).trim();
  git('init', '-q', '--initial-branch=main');
  const put = async (path, content) => { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), content); };
  const commit = (message) => { git('add', '-A'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
  await put('source.txt', 'first\nsecond\n');
  const base = commit('base');
  return { root, git, put, commit, base };
}

test('library pins commits, preserves content and ignores uncommitted changes', async (t) => {
  const f = await fixture(t);
  await f.put('source.txt', 'first\nchanged\n');
  const head = f.commit('head');
  await f.put('source.txt', 'uncommitted\n');
  const options = { repo: f.root, base: f.base };
  const result = await ingestGitDiff(options);
  assert.equal(result.revisions.headCommit, head);
  assert.equal(result.revisions.effectiveBaseCommit, f.base);
  assert.equal(result.changes[0].status, 'M');
  assert.match(result.patch, /\+changed/);
  assert.doesNotMatch(result.patch, /uncommitted/);
  assert.deepEqual(await ingestGitDiff(options), result);
});

test('handles additions, deletions, renames and paths with tabs/newlines/unicode', async (t) => {
  const f = await fixture(t);
  await f.put('deleted.txt', 'delete\n');
  const base = f.commit('before');
  await rename(join(f.root, 'source.txt'), join(f.root, 'renamed.txt'));
  await rm(join(f.root, 'deleted.txt'));
  await f.put('weird\tline\nՀայ.txt', 'new\n');
  f.commit('after');
  const result = await ingestGitDiff({ repo: f.root, base });
  assert.equal(result.changes.length, 3);
  assert.deepEqual(result.changes.map(c => c.status), ['D', 'R', 'A']);
  assert.equal(result.changes[1].oldPath, 'source.txt');
  assert.equal(result.changes[1].newPath, 'renamed.txt');
  assert.equal(result.changes[1].similarity, 100);
  assert.equal(result.changes[2].newPath, 'weird\tline\nՀայ.txt');
  assert.equal(result.changes[0].newObject, null);
});

test('merge-base and direct comparison differ on divergent branches', async (t) => {
  const f = await fixture(t);
  f.git('checkout', '-qb', 'feature');
  await f.put('feature.txt', 'feature\n');
  const head = f.commit('feature');
  f.git('checkout', '-q', 'main');
  await f.put('main.txt', 'main\n');
  const base = f.commit('main');
  const merged = await ingestGitDiff({ repo: f.root, base, head });
  const direct = await ingestGitDiff({ repo: f.root, base, head, comparison: 'direct' });
  assert.equal(merged.revisions.effectiveBaseCommit, f.base);
  assert.deepEqual(merged.changes.map(c => c.newPath), ['feature.txt']);
  assert.equal(direct.revisions.effectiveBaseCommit, base);
  assert.deepEqual(direct.changes.map(c => c.status), ['A', 'D']);
});

test('empty range is a valid empty snapshot', async (t) => {
  const f = await fixture(t);
  const result = await ingestGitDiff({ repo: f.root, base: f.base });
  assert.deepEqual(result.changes, []);
  assert.equal(result.patch, '');
});

test('rejects invalid revisions, options and non-repositories', async (t) => {
  const f = await fixture(t);
  for (const options of [null, {}, { repo: f.root, base: '--output=x' },
    { repo: f.root, base: f.base, comparison: 'unknown' },
    { repo: f.root, base: f.base, maxBytes: 0 },
    { repo: f.root, base: f.base, timeoutMs: Infinity }]) {
    await assert.rejects(ingestGitDiff(options), { code: 'INVALID_INPUT' });
  }
  await assert.rejects(ingestGitDiff({ repo: f.root, base: 'missing-branch' }), { code: 'INVALID_REVISION' });
  const empty = await mkdtemp(join(tmpdir(), 'not-git-'));
  t.after(() => rm(empty, { recursive: true, force: true }));
  await assert.rejects(ingestGitDiff({ repo: empty, base: 'HEAD' }), { code: 'INVALID_REPOSITORY' });
});

test('rejects unrelated histories instead of selecting an arbitrary base', async (t) => {
  const f = await fixture(t);
  f.git('checkout', '-q', '--orphan', 'other');
  f.git('rm', '-qrf', '.');
  await f.put('other.txt', 'other\n');
  f.commit('other');
  await assert.rejects(ingestGitDiff({ repo: f.root, base: f.base }), { code: 'NO_MERGE_BASE' });
});

test('fails closed on output budget overflow; CLI returns no partial JSON', async (t) => {
  const f = await fixture(t);
  await f.put('source.txt', 'x'.repeat(10000));
  f.commit('large');
  await assert.rejects(ingestGitDiff({ repo: f.root, base: f.base, maxBytes: 1000 }), { code: 'OUTPUT_LIMIT' });
  const result = spawnSync(process.execPath, [cli, 'ingest', '--repo', f.root, '--base', f.base, '--max-bytes', '1000'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).error.code, 'OUTPUT_LIMIT');
});

test('records binary and symlink changes without traversing targets', async (t) => {
  const f = await fixture(t);
  await f.put('image.bin', Buffer.from([0, 255, 0, 128]));
  f.git('update-index', '--add', '--cacheinfo', `120000,${f.git('hash-object', '-w', 'source.txt')},link`);
  // Commit the staged symlink without git add overwriting it.
  f.git('add', 'image.bin'); f.git('commit', '-qm', 'special entries');
  const result = await ingestGitDiff({ repo: f.root, base: f.base });
  assert.match(result.patch, /Binary files/);
  assert.equal(result.changes.find(c => c.newPath === 'link').newKind, 'symlink');
});

test('does not run repository-configured external diff or textconv programs', async (t) => {
  const f = await fixture(t);
  await f.put('.gitattributes', '*.txt diff=malicious\n');
  f.git('config', 'diff.malicious.command', 'program-that-must-not-run');
  f.git('config', 'diff.malicious.textconv', 'program-that-must-not-run');
  await f.put('source.txt', 'changed\n');
  f.commit('driver');
  const result = await ingestGitDiff({ repo: f.root, base: f.base });
  assert.match(result.patch, /\+changed/);
});

test('CLI stdout is parseable; unknown/duplicate/missing flags fail', async (t) => {
  const f = await fixture(t);
  const valid = spawnSync(process.execPath, [cli, 'ingest', '--repo', f.root, '--base', f.base], { encoding: 'utf8' });
  assert.equal(valid.status, 0);
  assert.equal(JSON.parse(valid.stdout).schemaVersion, 'git-ingestion/v1');
  for (const args of [['ingest', '--unknown', 'x'], ['ingest', '--base'],
    ['ingest', '--base', f.base, '--base', f.base], ['ingest', '--max-bytes', 'NaN']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).error.code, 'INVALID_INPUT');
  }
  assert.equal(spawnSync(process.execPath, [cli, '--help']).status, 0);
});

test('inherited Git location variables cannot redirect ingestion', async (t) => {
  const f = await fixture(t);
  const previous = process.env.GIT_DIR;
  process.env.GIT_DIR = '/missing/inherited/git';
  try {
    assert.equal((await ingestGitDiff({ repo: f.root, base: f.base })).revisions.headCommit, f.base);
  } finally {
    if (previous === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previous;
  }
});

test('dirty attributes, local configuration and replace refs do not alter pinned output', async (t) => {
  const f = await fixture(t);
  await f.put('source.txt', 'normal text\n');
  const head = f.commit('head');
  const options = { repo: f.root, base: f.base, head };
  const expected = await ingestGitDiff(options);
  await f.put('.gitattributes', '*.txt -diff\n');
  await f.put('.git/info/attributes', '*.txt -diff\n');
  f.git('config', 'diff.context', '100');
  f.git('config', 'diff.noprefix', 'true');
  f.git('config', 'diff.algorithm', 'histogram');
  f.git('replace', head, f.base);
  assert.deepEqual(await ingestGitDiff(options), expected);
});

test('pinned committed binary attributes are honored', async (t) => {
  const f = await fixture(t);
  await f.put('.gitattributes', '*.txt -diff\n');
  await f.put('source.txt', 'changed\n');
  f.commit('binary policy');
  await f.put('.gitattributes', '*.txt diff\n');
  const result = await ingestGitDiff({ repo: f.root, base: f.base });
  assert.match(result.patch, /Binary files a\/source.txt and b\/source.txt differ/);
  assert.doesNotMatch(result.patch, /\+changed/);
});

test('invalid UTF-8 text evidence fails explicitly', async (t) => {
  const f = await fixture(t);
  await f.put('invalid.txt', Buffer.from([0x61, 0xff, 0x0a]));
  f.commit('invalid encoding');
  await assert.rejects(ingestGitDiff({ repo: f.root, base: f.base }), { code: 'UNSUPPORTED_ENCODING' });
});

test('gitlinks and mode changes preserve entry metadata', async (t) => {
  const f = await fixture(t);
  f.git('update-index', '--add', '--cacheinfo', `160000,${f.base},submodule`);
  f.git('update-index', '--chmod=+x', 'source.txt');
  f.git('commit', '-qm', 'modes');
  const result = await ingestGitDiff({ repo: f.root, base: f.base });
  assert.equal(result.changes.find(c => c.newPath === 'submodule').newKind, 'gitlink');
  assert.equal(result.changes.find(c => c.newPath === 'source.txt').newMode, '100755');
});

test('aggregate output budget rejects streams that individually fit', async (t) => {
  const f = await fixture(t);
  await f.put('source.txt', 'x'.repeat(2000));
  f.commit('aggregate');
  const reference = await ingestGitDiff({ repo: f.root, base: f.base });
  const maxBytes = Buffer.byteLength(reference.patch) + 10;
  await assert.rejects(ingestGitDiff({ repo: f.root, base: f.base, maxBytes }), { code: 'OUTPUT_LIMIT' });
});

test('ambiguous criss-cross merge bases require an explicit direct comparison', async (t) => {
  const f = await fixture(t);
  const tree = f.git('rev-parse', `${f.base}^{tree}`);
  const a = f.git('commit-tree', tree, '-p', f.base, '-m', 'a');
  const b = f.git('commit-tree', tree, '-p', f.base, '-m', 'b');
  const left = f.git('commit-tree', tree, '-p', a, '-p', b, '-m', 'left');
  const right = f.git('commit-tree', tree, '-p', b, '-p', a, '-m', 'right');
  await assert.rejects(ingestGitDiff({ repo: f.root, base: left, head: right }), { code: 'AMBIGUOUS_MERGE_BASE' });
  assert.deepEqual((await ingestGitDiff({ repo: f.root, base: left, head: right, comparison: 'direct' })).changes, []);
});

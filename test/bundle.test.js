import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ingestGitDiff, compileReviewBundle, createReviewBundle } from '../src/index.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'review-bundle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: {
    ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  } }).trim();
  git('init', '-q', '--initial-branch=main');
  const put = async (path, value) => { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), value); };
  const commit = message => { git('add', '-A'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
  await put('src/file.ts', 'const value = 1;\n');
  const base = commit('base');
  return { root, git, put, commit, base };
}

test('bundle contains deterministic facts with resolvable evidence and frozen locations', async (t) => {
  const f = await fixture(t);
  await f.put('src/file.ts', 'const value = 2;\nconst another = 3;\n');
  const head = f.commit('change');
  const bundle = await createReviewBundle({ repo: f.root, base: f.base });
  assert.equal(bundle.schemaVersion, 'review-bundle/v1');
  assert.deepEqual(bundle.summary, { changedFiles: 1, addedLines: 2, removedLines: 1,
    binaryFiles: 0, specialEntries: 0, textCountsExcludeBinaryAndSpecialEntries: true });
  assert.equal(bundle.evidence[0].origin.old.commit, f.base);
  assert.equal(bundle.evidence[0].origin.new.commit, head);
  assert.deepEqual(bundle.evidence[0].hunks, [{ old: { start: 1, lines: 1 }, new: { start: 1, lines: 2 } }]);
  assert.equal(bundle.changes[0].coverage, 'text-diff');
  assert.equal(bundle.facts.find(x => x.type === 'path-hint').value.language, 'typescript');
  for (const fact of bundle.facts) {
    assert(bundle.changes.some(c => c.id === fact.changeId));
    assert(fact.evidenceIds.every(id => bundle.evidence.some(e => e.id === id)));
  }
  assert.equal(bundle.coverage.status, 'partial');
  assert.equal(bundle.coverage.stages.semanticAnalysis, 'not-run');
});

test('stable IDs survive reordered input keys/changes and change when evidence changes', async (t) => {
  const f = await fixture(t);
  await f.put('z.js', 'z\n'); await f.put('a.html', 'a\n');
  f.commit('add');
  const snapshot = await ingestGitDiff({ repo: f.root, base: f.base });
  const expected = compileReviewBundle(snapshot);
  const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === 'object' ?
    Object.fromEntries(Object.entries(value).reverse().map(([key, v]) => [key, reverseKeys(v)])) : value;
  const reordered = reverseKeys(snapshot); reordered.changes.reverse();
  assert.deepEqual(compileReviewBundle(reordered), expected);
  assert.deepEqual(compileReviewBundle(snapshot), expected);
  const { id, ...payload } = expected;
  assert.equal(id, `bundle:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`);
  const changed = structuredClone(snapshot); changed.patch = changed.patch.replace('+z\n', '+q\n');
  assert.notEqual(compileReviewBundle(changed).id, id);
});

test('quoted Unicode/control/quote/backslash/space paths map to the correct patch', async (t) => {
  const f = await fixture(t);
  const paths = ['Հայ\tline\n.ts', 'with space.ts', 'quote"and\\slash.ts'];
  for (const path of paths) await f.put(path, `${path.length}\n`);
  f.commit('paths');
  const bundle = await createReviewBundle({ repo: f.root, base: f.base });
  assert.equal(bundle.evidence.length, 3);
  for (const path of paths) {
    const change = bundle.changes.find(c => c.newPath === path);
    const evidence = bundle.evidence.find(e => e.changeId === change.id);
    assert.equal(evidence.origin.new.path, path);
    assert.match(evidence.content, new RegExp(`\\+${path.length}\\n`));
  }
});

test('renames, deletions and metadata-only mode changes keep old/new provenance', async (t) => {
  const f = await fixture(t);
  await f.put('delete.txt', 'remove\n'); await f.put('mode.sh', 'echo hi\n');
  const base = f.commit('before');
  await rename(join(f.root, 'src/file.ts'), join(f.root, 'renamed.ts'));
  await rm(join(f.root, 'delete.txt'));
  f.git('add', '-A'); f.git('update-index', '--chmod=+x', 'mode.sh'); f.git('commit', '-qm', 'after');
  const bundle = await createReviewBundle({ repo: f.root, base });
  const renameChange = bundle.changes.find(c => c.status === 'R');
  assert.equal(renameChange.coverage, 'metadata-only');
  assert.equal(bundle.evidence.find(e => e.changeId === renameChange.id).origin.old.path, 'src/file.ts');
  const deletion = bundle.changes.find(c => c.status === 'D');
  assert.equal(bundle.evidence.find(e => e.changeId === deletion.id).origin.new, null);
  assert.equal(bundle.changes.find(c => c.newPath === 'mode.sh').coverage, 'metadata-only');
  assert.equal(bundle.summary.removedLines, 1);
});

test('binary and special entries are explicitly excluded from text metrics', async (t) => {
  const f = await fixture(t);
  await f.put('binary.bin', Buffer.from([0, 255, 0]));
  f.git('add', 'binary.bin');
  const blob = f.git('hash-object', '-w', 'src/file.ts');
  f.git('update-index', '--add', '--cacheinfo', `120000,${blob},link`);
  f.git('update-index', '--add', '--cacheinfo', `160000,${f.base},submodule`);
  f.git('commit', '-qm', 'special');
  const bundle = await createReviewBundle({ repo: f.root, base: f.base });
  assert.equal(bundle.summary.binaryFiles, 1);
  assert.equal(bundle.summary.specialEntries, 2);
  assert.equal(bundle.summary.addedLines, 0);
  assert.equal(bundle.facts.filter(fact => fact.type === 'text-change').length, 0);
  assert.equal(bundle.changes.find(c => c.newPath === 'binary.bin').coverage, 'binary-omitted');
});

test('type change can group multiple patch sections without inventing text metrics', async (t) => {
  const f = await fixture(t);
  const blob = f.git('hash-object', '-w', 'src/file.ts');
  f.git('update-index', '--cacheinfo', `120000,${blob},src/file.ts`);
  f.git('commit', '-qm', 'type change');
  const bundle = await createReviewBundle({ repo: f.root, base: f.base });
  assert.equal(bundle.changes.length, 1);
  assert.equal(bundle.changes[0].status, 'T');
  assert.equal(bundle.evidence.length, 1);
  assert.equal(bundle.changes[0].coverage, 'special-entry');
});

test('hunks count content resembling headers and missing-final-newline markers correctly', async (t) => {
  const f = await fixture(t);
  await f.put('src/file.ts', 'diff --git fake\n@@ -1 +1 @@\n+++ pretend');
  f.commit('header content');
  const bundle = await createReviewBundle({ repo: f.root, base: f.base });
  assert.equal(bundle.summary.addedLines, 3);
  assert.equal(bundle.summary.removedLines, 1);
  assert.match(bundle.evidence[0].content, /No newline at end of file/);
});

test('empty change range remains partial for stages that have not run', async (t) => {
  const f = await fixture(t);
  const bundle = await createReviewBundle({ repo: f.root, base: f.base });
  assert.deepEqual(bundle.changes, []); assert.deepEqual(bundle.facts, []); assert.deepEqual(bundle.evidence, []);
  assert.equal(bundle.summary.changedFiles, 0);
  assert.equal(bundle.coverage.stages.ruleSelection, 'not-run');
});

test('separated hunks and CRLF content retain exact ranges and changed-line counts', async (t) => {
  const f = await fixture(t);
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}\r`);
  await f.put('src/file.ts', lines.join('\n') + '\n');
  const base = f.commit('long base');
  lines[1] = 'changed 2\r'; lines[27] = 'changed 28\r';
  await f.put('src/file.ts', lines.join('\n') + '\n'); f.commit('long head');
  const bundle = await createReviewBundle({ repo: f.root, base });
  assert.equal(bundle.evidence[0].hunks.length, 2);
  assert.equal(bundle.summary.addedLines, 2); assert.equal(bundle.summary.removedLines, 2);
  assert.match(bundle.evidence[0].content, /\+changed 2\r\n/);
});

test('malformed snapshot/version/provenance and inconsistent patch evidence fail closed', async (t) => {
  const f = await fixture(t);
  await f.put('src/file.ts', 'new\n'); f.commit('head');
  const source = await ingestGitDiff({ repo: f.root, base: f.base });
  const mutate = fn => { const input = structuredClone(source); fn(input); return input; };
  const bad = [null, {}, mutate(s => s.schemaVersion = 'unknown'),
    mutate(s => s.revisions.headCommit = 'invalid'), mutate(s => s.policy.attributesCommit = f.base),
    mutate(s => s.changes.push(s.changes[0])), mutate(s => s.changes[0].newPath = '../escape.ts'),
    mutate(s => s.changes[0].newKind = 'gitlink'), mutate(s => s.patch = ''),
    mutate(s => s.patch = s.patch.replace('diff --git a/src/file.ts b/src/file.ts', 'diff --git a/wrong.ts b/wrong.ts')),
    mutate(s => s.patch = s.patch.replace('@@ -1 +1 @@', '@@ -1,5 +1 @@')),
    mutate(s => s.patch += s.patch)];
  for (const input of bad) assert.throws(() => compileReviewBundle(input), { code: 'INVALID_SNAPSHOT' });
});

test('exact compact serialization budget and CLI errors never emit partial bundles', async (t) => {
  const f = await fixture(t);
  await f.put('src/file.ts', 'updated\n'); f.commit('head');
  const snapshot = await ingestGitDiff({ repo: f.root, base: f.base });
  const bundle = compileReviewBundle(snapshot);
  const bytes = Buffer.byteLength(JSON.stringify(bundle));
  assert.deepEqual(compileReviewBundle(snapshot, { maxBundleBytes: bytes }), bundle);
  assert.throws(() => compileReviewBundle(snapshot, { maxBundleBytes: bytes - 1 }), { code: 'BUNDLE_LIMIT' });
  assert.throws(() => compileReviewBundle(snapshot, { maxBundleBytes: 0 }), { code: 'INVALID_INPUT' });
  const cli = resolve('src/cli.js');
  const good = spawnSync(process.execPath, [cli, 'bundle', '--repo', f.root, '--base', f.base], { encoding: 'utf8' });
  assert.equal(good.status, 0); assert.deepEqual(JSON.parse(good.stdout), bundle);
  const bad = spawnSync(process.execPath, [cli, 'bundle', '--repo', f.root, '--base', f.base, '--max-bundle-bytes', '1'], { encoding: 'utf8' });
  assert.equal(bad.status, 1); assert.equal(bad.stdout, '');
  assert.equal(JSON.parse(bad.stderr).error.code, 'BUNDLE_LIMIT');
});

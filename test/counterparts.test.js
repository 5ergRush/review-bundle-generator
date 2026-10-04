import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, rename } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReviewBundle, createReviewerRequest } from '../src/index.js';

const before = 'export function target(value: number) {\n  if (value < 0) throw new Error();\n  return value;\n}\n';
const after = before.replace('  if (value < 0) throw new Error();\n', '');
async function fixture(t, oldSource = before, newSource = after, renamed = false) {
  const repo = await mkdtemp(join(tmpdir(), 'review-counterpart-')); t.after(() => rm(repo, { recursive: true, force: true }));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull,
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = (...args) => execFileSync('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'commit.gpgSign=false', ...args], { cwd: repo, env, encoding: 'utf8', timeout: 10000 }).trim();
  git('init', '-q', '--template=', '--initial-branch=main');
  await writeFile(join(repo, 'target.ts'), oldSource); await writeFile(join(repo, 'caller.ts'), "import {target as alias} from './target';\nexport function caller() { return alias(-1); }\n");
  const commit = () => { git('add', '-A'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  const base = commit();
  const renamedPath = typeof renamed === 'string' ? renamed : 'renamed.ts';
  if (renamed) await rename(join(repo, 'target.ts'), join(repo, renamedPath));
  if (newSource === null) await rm(join(repo, 'target.ts')); else await writeFile(join(repo, renamed ? renamedPath : 'target.ts'), newSource);
  if (renamed) await writeFile(join(repo, 'caller.ts'), "import {target as alias} from './renamed';\nexport function caller() { return alias(-1); }\n");
  const head = commit(); const options = { repo, base, head, semantic: true, comparison: 'direct' };
  const bundle = await createReviewBundle(options); createReviewerRequest(bundle, { id: 'test', version: 'v2' });
  return { repo, options, bundle, git };
}
const target = (bundle, side) => bundle.semanticAnalysis.declarations.find(d => d.side === side && d.name === 'target');
const decision = (bundle, old) => bundle.semanticAnalysis.counterparts.find(d => d.oldTargetId === old.id);
const rehash = bundle => { const { id, ...payload } = bundle; bundle.id = 'bundle:' + createHash('sha256').update(JSON.stringify(payload)).digest('hex'); return bundle; };

test('pure deletion links a distinct new structural target and permits new-revision callers', async t => {
  const f = await fixture(t); const old = target(f.bundle, 'old'); const next = target(f.bundle, 'new');
  assert.equal(f.bundle.semanticAnalysis.schemaVersion, 'typescript-analysis/v2'); assert.equal(old.basis, undefined);
  assert.equal(next.basis, 'structural-counterpart'); assert.equal(next.counterpartOf, old.id); assert.notEqual(next.id, old.id);
  assert.equal(decision(f.bundle, old).status, 'matched'); assert.equal(next.origin.commit, f.options.head);
  const expanded = await createReviewBundle({ ...f.options, contextRequests: [{ kind: 'direct-callers', targetId: next.id }] });
  assert.equal(expanded.contextExpansion.decisions[0].matches.length, 1); assert.equal(expanded.contextExpansion.decisions[0].matches[0].origin.commit, f.options.head);
  createReviewerRequest(expanded, { id: 'test', version: 'v2' });
  await writeFile(join(f.repo, 'target.ts'), 'dirty'); assert.deepEqual(await createReviewBundle(f.options), f.bundle);
});

test('directly edited new declaration is retained with its original content ID and no counterpart label', async t => {
  const f = await fixture(t, before, after.replace('return value;', 'return value + 1;'));
  const next = target(f.bundle, 'new'); assert.equal(next.basis, undefined); assert.equal(decision(f.bundle, target(f.bundle, 'old')).status, 'already-indexed');
  const { id, ...payload } = next; assert.equal(id, 'declaration:' + createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
});

test('deleted function does not mark its untouched adjacent function as changed', async t => {
  const untouched = 'export function untouched() { return 10; }\n';
  const f = await fixture(t, before + untouched, untouched); assert.equal(target(f.bundle, 'new'), undefined);
  assert.equal(decision(f.bundle, target(f.bundle, 'old')).status, 'missing'); assert(!f.bundle.semanticAnalysis.declarations.some(d => d.name === 'untouched'));
});

test('deleted file has no fabricated new counterpart', async t => {
  const f = await fixture(t, before, null); assert.equal(target(f.bundle, 'new'), undefined); assert.equal(decision(f.bundle, target(f.bundle, 'old')).status, 'missing');
});

test('renamed declaration is not treated as a same-name counterpart', async t => {
  const f = await fixture(t, before, after.replace('function target', 'function replacement'));
  assert.equal(decision(f.bundle, target(f.bundle, 'old')).status, 'missing'); assert.equal(target(f.bundle, 'new'), undefined);
});

test('ambiguous overload candidates do not create new structural targets', async t => {
  const overload = 'export function target(value: number): number;\n'; const f = await fixture(t, overload + before, overload + after);
  assert.equal(decision(f.bundle, target(f.bundle, 'old')).status, 'ambiguous'); assert.equal(target(f.bundle, 'new'), undefined);
});

test('named methods/classes link separately and preserve their qualified scope', async t => {
  const methodBefore = before.replace('export function target', 'target'); const methodAfter = after.replace('export function target', 'target');
  const f = await fixture(t, 'export class Service {\n' + methodBefore + '}\n', 'export class Service {\n' + methodAfter + '}\n');
  const next = target(f.bundle, 'new'); assert.equal(next.qualifiedName, 'Service.target'); assert.equal(next.basis, 'structural-counterpart');
  assert(f.bundle.semanticAnalysis.declarations.some(d => d.side === 'new' && d.name === 'Service' && d.basis === 'structural-counterpart'));
});

test('anonymous callback scopes remain unsupported rather than guessed', async t => {
  const f = await fixture(t, 'export const callback = () => {\n' + before + '};\n', 'export const callback = () => {\n' + after + '};\n');
  assert.equal(decision(f.bundle, target(f.bundle, 'old')).status, 'unsupported-scope'); assert.equal(target(f.bundle, 'new'), undefined);
});

test('parse errors in new source block counterpart inference', async t => {
  const f = await fixture(t, before, 'export function target( {');
  assert.equal(decision(f.bundle, target(f.bundle, 'old')).status, 'parse-unavailable'); assert(!f.bundle.semanticAnalysis.declarations.some(d => d.basis === 'structural-counterpart'));
});

test('Git rename can link within the same recorded change with pinned new path', async t => {
  const filler = Array.from({ length: 15 }, (_, i) => `export const value${i} = ${i};\n`).join('');
  const f = await fixture(t, before + filler, after + filler, true);
  const next = target(f.bundle, 'new'); assert.equal(next.origin.path, 'renamed.ts'); assert.equal(next.basis, 'structural-counterpart');
  assert.equal(f.bundle.changes.find(c => c.id === next.changeId).status, 'R');
});

for (const [name, mutate] of [
  ['unknown old target', b => { target(b, 'new').counterpartOf = 'declaration:' + '0'.repeat(64); }],
  ['missing decision', b => { b.semanticAnalysis.counterparts = []; }],
  ['wrong decision state', b => { b.semanticAnalysis.counterparts[0].status = 'already-indexed'; }],
  ['duplicate decision', b => { b.semanticAnalysis.counterparts.push(b.semanticAnalysis.counterparts[0]); }],
]) test(`packet rejects ${name} after content ID regeneration`, async t => {
  const f = await fixture(t); const b = structuredClone(f.bundle); mutate(b);
  for (const d of b.semanticAnalysis.declarations) { const { id, ...payload } = d; d.id = 'declaration:' + createHash('sha256').update(JSON.stringify(payload)).digest('hex'); }
  assert.throws(() => createReviewerRequest(rehash(b), { id: 'test', version: 'v2' }), { code: 'INVALID_REVIEW_BUNDLE' });
});


test('new path outside TypeScript indexing is explicitly unavailable', async t => {
  const filler = Array.from({ length: 15 }, (_, i) => `export const value${i} = ${i};\n`).join('');
  const f = await fixture(t, before + filler, after + filler, 'renamed.js');
  assert.equal(decision(f.bundle, target(f.bundle, 'old')).status, 'source-unavailable'); assert.equal(target(f.bundle, 'new'), undefined);
});

test('candidate count budget fails without a partial semantic bundle', async t => {
  const source = Array.from({ length: 10001 }, (_, i) => `export const item${i} = ${i};\n`).join('');
  await assert.rejects(() => fixture(t, source, source.replace('item0 = 0', 'item0 = -1')), { code: 'SEMANTIC_LIMIT' });
});

test('string-named module ancestry is not conflated across revisions', async t => {
  const f = await fixture(t, 'declare module "first" {\n' + before + '}\n', 'declare module "second" {\n' + after + '}\n');
  assert.equal(decision(f.bundle, target(f.bundle, 'old')).status, 'unsupported-scope'); assert.equal(target(f.bundle, 'new'), undefined);
});

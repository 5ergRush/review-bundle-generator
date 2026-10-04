import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createReviewBundle } from '../src/index.js';

async function fixture(t) {
  const repo = await mkdtemp(join(tmpdir(), 'review-semantic-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: {
    ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  } }).trim();
  git('init', '-q', '--initial-branch=main');
  const put = (path, content) => writeFile(join(repo, path), content);
  const commit = () => { git('add', '-A'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  await put('target.ts', 'export function target() { return 1; }\nexport function untouched() { return 9; }\n');
  await put('caller.ts', "import {target as alias} from './target';\nexport function caller() { return alias(); }\nfunction target() { return 0; }\ntarget();\n");
  const base = commit();
  await put('target.ts', 'export function target() { return 2; }\nexport function untouched() { return 9; }\n');
  const head = commit();
  const options = { repo, base, head, semantic: true };
  return { repo, put, commit, options, bundle: () => createReviewBundle(options) };
}

test('changed declarations use actual edit lines; aliased caller resolution excludes same-name symbols', async t => {
  const f = await fixture(t); const first = await f.bundle();
  assert.equal(first.schemaVersion, 'review-bundle/v3');
  assert.deepEqual(first.semanticAnalysis.declarations.map(item => item.name), ['target', 'target']);
  const target = first.semanticAnalysis.declarations.find(item => item.side === 'new');
  const result = await createReviewBundle({ ...f.options, contextRequests: [{ kind: 'direct-callers', targetId: target.id }] });
  const decision = result.contextExpansion.decisions[0];
  assert.equal(decision.matches.length, 1);
  const evidence = result.evidence.find(item => item.id === decision.matches[0].evidenceId);
  assert.equal(evidence.origin.path, 'caller.ts'); assert.equal(evidence.origin.commit, f.options.head);
  assert.match(evidence.content, /alias\(\)/u);
  assert.equal(first.coverage.stages.contextExpansion, 'not-requested');
  assert.deepEqual(await f.bundle(), first);
  await f.put('target.ts', 'broken dirty file'); await f.put('caller.ts', 'dirty caller');
  assert.deepEqual(await f.bundle(), first);
});

test('old declarations retain old-revision caller evidence', async t => {
  const f = await fixture(t); const first = await f.bundle();
  const target = first.semanticAnalysis.declarations.find(item => item.side === 'old');
  const result = await createReviewBundle({ ...f.options, contextRequests: [{ kind: 'direct-callers', targetId: target.id }] });
  assert.equal(result.contextExpansion.decisions[0].matches[0].origin.commit, f.options.base);
});

test('parse errors and missing imports are explicit; special entries are not traversed', async t => {
  const f = await fixture(t);
  await f.put('broken.ts', "import x from 'missing-package';\nexport function broken( {\n");
  await symlink('/definitely/not/a/source', join(f.repo, 'link.ts'));
  f.options.head = f.commit();
  const bundle = await f.bundle(); const revision = bundle.semanticAnalysis.revisions[1];
  assert.equal(revision.sourceFiles, 3);
  assert(revision.parseDiagnostics.length > 0);
  assert(revision.unresolvedImports.some(item => item.specifier === 'missing-package'));
  assert.equal(bundle.coverage.stages.semanticAnalysis, 'partial');
});

test('request validation, stale IDs and final byte budgets fail closed', async t => {
  const f = await fixture(t); const bundle = await f.bundle();
  const id = bundle.semanticAnalysis.declarations[1].id;
  for (const contextRequests of [null, [{ kind: 'direct-callers', targetId: 'declaration:' + '0'.repeat(64) }],
    [{ kind: 'direct-callers', targetId: id, extra: true }],
    [{ kind: 'direct-callers', targetId: id }, { kind: 'direct-callers', targetId: id }]]) {
    await assert.rejects(createReviewBundle({ ...f.options, contextRequests }), { code: 'INVALID_CONTEXT_REQUEST' });
  }
  await assert.rejects(createReviewBundle({ ...f.options, semantic: false, contextRequests: [{ kind: 'direct-callers', targetId: id }] }), { code: 'INVALID_INPUT' });
  await assert.rejects(createReviewBundle({ ...f.options, maxBundleBytes: Buffer.byteLength(JSON.stringify(bundle)) - 1 }), { code: 'BUNDLE_LIMIT' });
});

test('caller snippet count limits produce explicit omissions; shared evidence is deduplicated', async t => {
  const f = await fixture(t);
  await f.put('caller.ts', "import {target} from './target';\n" + Array.from({ length: 12 }, (_, index) => `export function caller${index}() { return target(); }`).join('\n'));
  f.options.head = f.commit(); const first = await f.bundle();
  const target = first.semanticAnalysis.declarations.find(item => item.side === 'new' && item.name === 'target');
  const bundle = await createReviewBundle({ ...f.options, contextRequests: [{ kind: 'direct-callers', targetId: target.id }] });
  assert.equal(bundle.contextExpansion.decisions[0].matches.length, 12);
  assert.equal(bundle.evidence.filter(item => item.type === 'typescript-source').length, 10);
  assert.equal(bundle.contextExpansion.decisions[0].matches.filter(item => item.omission === 'snippet-count-limit').length, 2);
  assert.equal(bundle.coverage.stages.contextExpansion, 'partial');
});

test('CLI semantic output and caller requests have JSON errors without partial stdout', async t => {
  const f = await fixture(t);
  const cli = resolve('src/cli.js');
  const run = extra => spawnSync(process.execPath, [cli, 'bundle', '--repo', f.repo, '--base', f.options.base, ...extra], { encoding: 'utf8' });
  const result = run(['--semantic']); assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).schemaVersion, 'review-bundle/v3');
  const bad = run(['--semantic', '--callers', 'invalid']); assert.equal(bad.status, 1); assert.equal(bad.stdout, '');
  assert.equal(JSON.parse(bad.stderr).error.code, 'INVALID_CONTEXT_REQUEST');
});

test('source size limit rejects large committed sources independently of diff budget', async t => {
  const f = await fixture(t); await f.put('large.ts', ' '.repeat(512 * 1024 + 1)); f.options.head = f.commit();
  await assert.rejects(f.bundle(), { code: 'OUTPUT_LIMIT' });
});

test('methods and arrow functions resolve; deleted targets only exist on the old side', async t => {
  const f = await fixture(t);
  await f.put('methods.ts', 'export class Service { method() { return 1; } }\nexport const arrow = () => 1;\n');
  await f.put('uses.ts', "import {Service, arrow} from './methods';\nnew Service().method();\narrow();\n");
  f.options.base = f.commit();
  await f.put('methods.ts', 'export class Service { method() { return 2; } }\n'); f.options.head = f.commit();
  const first = await f.bundle();
  for (const [name, side] of [['method', 'new'], ['arrow', 'old']]) {
    const target = first.semanticAnalysis.declarations.find(item => item.name === name && item.side === side);
    assert(target);
    const bundle = await createReviewBundle({ ...f.options, contextRequests: [{ kind: 'direct-callers', targetId: target.id }] });
    assert.equal(bundle.contextExpansion.decisions[0].matches.length, 1);
  }
  assert(!first.semanticAnalysis.declarations.some(item => item.name === 'arrow' && item.side === 'new'));
});

test('line and serialized byte budgets omit entire snippets without truncation', async t => {
  const f = await fixture(t);
  // Nearest statement contains the call, so its full source extent is bounded.
  await f.put('caller.ts', "import {target} from './target';\nconst tall = target(\n" + '\n'.repeat(81) + ');\nconst wide = target("' + 'x'.repeat(66 * 1024) + '");\n');
  f.options.head = f.commit(); const first = await f.bundle();
  const target = first.semanticAnalysis.declarations.find(item => item.side === 'new' && item.name === 'target');
  const bundle = await createReviewBundle({ ...f.options, contextRequests: [{ kind: 'direct-callers', targetId: target.id }] });
  assert.deepEqual(bundle.contextExpansion.decisions[0].matches.map(item => item.omission), ['snippet-line-limit', 'context-byte-limit']);
  assert.equal(bundle.contextExpansion.serializedEvidenceBytes, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReviewBundle, createReviewerRequest } from '../src/index.js';

const imported = "import { target as original } from './target';\n";
const identity = { id: 'alias-contract', version: '1' };
const rehash = value => { const { id, ...payload } = value; value.id = `bundle:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`; return value; };
async function fixture(t, caller, nextCaller = caller, extra = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'review-const-alias-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = (...args) => execFileSync('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'commit.gpgSign=false', ...args], { cwd: repo, env, encoding: 'utf8' }).trim();
  git('init', '-q', '--template=', '--initial-branch=main');
  const put = (path, text) => writeFile(join(repo, path), text);
  for (const [path, text] of Object.entries(extra)) await put(path, text);
  const commit = async (value, text) => { await put('target.ts', `export function target() { return ${value}; }\n`); await put('caller.ts', text); git('add', '-A'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  const base = await commit(1, caller); const head = await commit(2, nextCaller);
  const options = { repo, base, head, comparison: 'direct', semantic: true };
  const first = await createReviewBundle(options);
  const contextRequests = first.semanticAnalysis.declarations.filter(item => item.name === 'target' && item.origin.path === 'target.ts').map(item => ({ kind: 'direct-callers', targetId: item.id }));
  const bundle = await createReviewBundle({ ...options, contextRequests });
  createReviewerRequest(bundle, identity);
  const matches = side => bundle.contextExpansion.decisions.find(item => first.semanticAnalysis.declarations.find(d => d.id === item.targetId).side === side).matches;
  return { options, bundle, matches, put };
}

test('immutable local import aliases produce pinned caller and binding evidence on both revisions', async t => {
  const f = await fixture(t, imported + 'const invoke = original;\ninvoke();\n');
  assert.equal(f.bundle.contextExpansion.schemaVersion, 'caller-context/v2');
  for (const side of ['old', 'new']) {
    const match = f.matches(side)[0]; assert.equal(f.matches(side).length, 1); assert.equal(match.origin.start.line, 3);
    assert.equal(match.resolution.kind, 'local-const-alias'); assert.equal(match.resolution.aliases.length, 1);
    const alias = match.resolution.aliases[0]; assert.equal(alias.name, 'invoke'); assert.equal(alias.initializerName, 'original');
    assert.equal(alias.origin.commit, side === 'old' ? f.options.base : f.options.head); assert.equal(alias.origin.start.line, 2);
    assert.equal(f.bundle.evidence.find(item => item.id === alias.evidenceId).content, 'const invoke = original');
    assert.equal(alias.omission, null);
  }
  await f.put('caller.ts', 'dirty');
  const requests = f.bundle.contextExpansion.decisions.map(({ kind, targetId }) => ({ kind, targetId }));
  assert.deepEqual(await createReviewBundle({ ...f.options, contextRequests: requests }), f.bundle);
});

test('same statement alias chains deduplicate binding evidence and keep chain order', async t => {
  const f = await fixture(t, imported + 'const first = original, invoke = first;\ninvoke();\n');
  const aliases = f.matches('new')[0].resolution.aliases;
  assert.deepEqual(aliases.map(item => item.name), ['invoke', 'first']); assert.equal(aliases[0].evidenceId, aliases[1].evidenceId);
  assert.equal(f.bundle.evidence.filter(item => item.type === 'typescript-source').length, 4);
});

test('direct requests for a changed copied variable preserve existing binding callers', async t => {
  const f = await fixture(t, imported + 'const invoke = original;\ninvoke();\n', imported + 'const invoke: () => number = original;\ninvoke();\n');
  const declaration = f.bundle.semanticAnalysis.declarations.find(item => item.name === 'invoke' && item.side === 'new'); assert(declaration);
  const bundle = await createReviewBundle({ ...f.options, contextRequests: [{ kind: 'direct-callers', targetId: declaration.id }] });
  assert.equal(bundle.contextExpansion.decisions[0].matches.length, 1);
  assert.deepEqual(bundle.contextExpansion.decisions[0].matches[0].resolution, { kind: 'direct-symbol', aliases: [] });
  createReviewerRequest(bundle, identity);
});

test('bounded alias chains accept eight copies and explicitly skip nine', async t => {
  const chain = size => imported + Array.from({ length: size }, (_, index) => `const a${index} = ${index ? `a${index - 1}` : 'original'};`).join('\n') + `\na${size - 1}();\n`;
  const f = await fixture(t, chain(8), chain(9));
  assert.equal(f.matches('old').length, 1); assert.equal(f.matches('old')[0].resolution.aliases.length, 8); assert.equal(f.matches('new').length, 0);
  assert(f.bundle.semanticAnalysis.revisions.find(item => item.side === 'new').aliasResolution.skippedReasons.some(item => item.reason === 'alias-depth-limit'));
});

test('mutable aliases stay unsupported even when no assignment is visible', async t => {
  for (const kind of ['let', 'var']) {
    const f = await fixture(t, imported + `${kind} invoke = original;\ninvoke();\n`);
    assert.equal(f.matches('new').length, 0);
    assert(f.bundle.semanticAnalysis.revisions[1].aliasResolution.skippedReasons.some(item => item.reason === 'non-const-binding'));
  }
});

test('observed binding writes reject alias and function binding even inside later callbacks', async t => {
  for (const assignment of ['invoke = original;', 'invoke++;', '[invoke] = [original];', '({ invoke } = { invoke: original });', 'for (invoke of []) {}', 'function later() { original = () => 9; }']) {
    const f = await fixture(t, imported + `const invoke = original;\ninvoke();\n${assignment}\n`);
    assert.equal(f.matches('new').length, 0);
    assert(f.bundle.semanticAnalysis.revisions[1].aliasResolution.skippedReasons.some(item => item.reason === 'binding-written'));
  }
});

test('forward initialization and cyclic copies never create caller targets', async t => {
  for (const text of ['invoke();\nconst invoke = original;\n', 'const first = invoke;\nconst invoke = first;\ninvoke();\n']) {
    const f = await fixture(t, imported + text); assert.equal(f.matches('new').length, 0);
    assert(f.bundle.semanticAnalysis.revisions[1].aliasResolution.skippedReasons.some(item => ['forward-initialization', 'alias-cycle'].includes(item.reason)));
  }
});

test('computed, wrapped and destructured function values remain unsupported', async t => {
  for (const text of ['const invoke = (original);\ninvoke();\n', 'const invoke = true ? original : original;\ninvoke();\n', 'const box = { original };\nconst invoke = box.original;\ninvoke();\n', 'const { original: invoke } = { original };\ninvoke();\n', 'const invoke = original.bind(null);\ninvoke();\n']) {
    const f = await fixture(t, imported + text);
    // bind() is a method call and does not itself call the changed function.
    assert.equal(f.matches('new').length, 0);
  }
});

test('imported const copies are nonlocal while re-exported named functions resolve', async t => {
  const f = await fixture(t, "import { copied } from './bridge';\ncopied();\n", undefined,
    { 'bridge.ts': "import { target } from './target';\nexport const copied = target;\n" });
  assert.equal(f.matches('new').length, 0);
  assert(f.bundle.semanticAnalysis.revisions[1].aliasResolution.skippedReasons.some(item => item.reason === 'nonlocal-alias'));
  const g = await fixture(t, "import { exported } from './bridge';\nconst invoke = exported;\ninvoke();\n", undefined,
    { 'bridge.ts': "export { target as exported } from './target';\n" });
  assert.equal(g.matches('new').length, 1);
});

test('same-name shadows and dirty lexical scopes cannot redirect an alias to the changed function', async t => {
  const f = await fixture(t, imported + 'function local() { function original() { return 0; } const invoke = original; invoke(); }\n');
  assert.equal(f.matches('new').length, 0);
  const g = await fixture(t, imported + 'const invoke = original;\ninvoke();\nfunction broken( {\n');
  assert.equal(g.matches('new').length, 0); assert(g.bundle.semanticAnalysis.revisions[1].aliasResolution.skippedReasons.some(item => item.reason === 'alias-source-unavailable'));
});

test('alias binding omissions mark context partial while preserving the included call snippet', async t => {
  const f = await fixture(t, imported + Array(9).fill('original();').join('\n') + '\nconst invoke = original;\ninvoke();\n');
  const match = [...f.matches('old'), ...f.matches('new')].find(item => item.resolution.kind === 'local-const-alias' && item.evidenceId !== null);
  assert(match); assert.equal(match.omission, null);
  assert.equal(match.resolution.aliases[0].omission, 'snippet-count-limit'); assert.equal(match.resolution.aliases[0].evidenceId, null);
  assert.equal(f.bundle.coverage.stages.contextExpansion, 'partial');
  assert.equal(f.bundle.contextExpansion.decisions.every(item => item.status === 'partial'), true);
});

test('packets reject forged alias names, evidence, chain shape, revisions and context coverage', async t => {
  const f = await fixture(t, imported + 'const first = original;\nconst invoke = first;\ninvoke();\n');
  const mutate = fn => { const bundle = JSON.parse(JSON.stringify(f.bundle)); const match = bundle.contextExpansion.decisions[0].matches[0]; fn(bundle, match); assert.throws(() => createReviewerRequest(rehash(bundle), identity), { code: 'INVALID_REVIEW_BUNDLE' }); };
  for (const fn of [
    (b, m) => { m.resolution.aliases[0].name = 'fake'; },
    (b, m) => { m.resolution.aliases[0].initializerName = 'fake'; },
    (b, m) => { m.resolution.aliases[0].origin.commit = m.origin.commit === f.options.head ? f.options.base : f.options.head; },
    (b, m) => { m.resolution.aliases[0].origin.end = null; },
    (b, m) => { m.resolution.aliases[0].evidenceId = m.evidenceId; },
    (b, m) => { m.resolution.kind = 'direct-symbol'; },
    (b, m) => { m.resolution.aliases = Array(9).fill(m.resolution.aliases[0]); },
    (b, m) => { delete m.resolution; },
    b => { b.contextExpansion.policy.maxAliasDepth = 9; },
    b => { b.contextExpansion.decisions[0].status = 'partial'; },
  ]) mutate(fn);
  mutate((bundle, match) => {
    const evidence = bundle.evidence.find(item => item.id === match.resolution.aliases[0].evidenceId); const previousId = evidence.id;
    evidence.content = evidence.content.replace('const', 'let  '); const { id, ...payload } = evidence;
    evidence.id = `evidence:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
    for (const decision of bundle.contextExpansion.decisions) for (const item of decision.matches) for (const alias of item.resolution.aliases) if (alias.evidenceId === previousId) alias.evidenceId = evidence.id;
  });
});

test('legacy caller-context/v1 direct packets remain accepted; resolution metadata requires v2', async t => {
  const f = await fixture(t, imported + 'original();\n'); const bundle = JSON.parse(JSON.stringify(f.bundle));
  bundle.contextExpansion.schemaVersion = 'caller-context/v1'; delete bundle.contextExpansion.policy.maxAliasDepth;
  for (const decision of bundle.contextExpansion.decisions) for (const match of decision.matches) delete match.resolution;
  createReviewerRequest(rehash(bundle), identity);
  bundle.contextExpansion.decisions[0].matches[0].resolution = { kind: 'direct-symbol', aliases: [] };
  assert.throws(() => createReviewerRequest(rehash(bundle), identity), { code: 'INVALID_REVIEW_BUNDLE' });
});

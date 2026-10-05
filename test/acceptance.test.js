import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReviewBundle, parseRulesYaml, compileAcceptanceExpectations, auditReviewBundle } from '../src/index.js';

const before = "export function validate(amount: number) {\n  if (amount <= 0) throw new Error('invalid');\n  return amount;\n}\n";
const after = before.replace("  if (amount <= 0) throw new Error('invalid');\n", '');
const rulesYaml = JSON.stringify({ schemaVersion: 'review-rules/v3', rules: [{ id: 'amount', title: 'Amount invariant', instruction: 'Check equivalent enforcement before reporting.', scope: { paths: ['*.ts'] }, when: { changedSyntax: [{ side: 'removed', kind: 'throw-guard', identifiers: ['amount'], within: 'validate' }] } }] });
const clone = value => JSON.parse(JSON.stringify(value));
const row = (path, overrides = {}) => ({ status: 'M', oldPath: path, newPath: path, oldKind: 'file', newKind: 'file', coverage: 'text-diff', addedLines: 0, removedLines: 1,
  selectedRuleIds: ['amount'], requiredPatchLines: ["-  if (amount <= 0) throw new Error('invalid');"], sourceCoverage: { available: true, reason: 'parsed-pinned-sources' }, ...overrides });
async function fixture(t, initial = { 'left.ts': before, 'right.ts': '// old comment\n', 'binary.bin': Buffer.from([0, 1]) }, final = { 'left.ts': after, 'right.ts': '// new comment\n', 'binary.bin': Buffer.from([0, 2]) }) {
  const repo = await mkdtemp(join(tmpdir(), 'review-external-acceptance-')); t.after(() => rm(repo, { recursive: true, force: true }));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = (...args) => execFileSync('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'commit.gpgSign=false', ...args], { cwd: repo, env, encoding: 'utf8', timeout: 10000 }).trim();
  git('init', '-q', '--template=', '--initial-branch=main');
  for (const [path, content] of Object.entries(initial)) await writeFile(join(repo, path), content);
  git('add', '-A'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  for (const path of Object.keys(initial)) if (!Object.hasOwn(final, path)) await rm(join(repo, path));
  for (const [path, content] of Object.entries(final)) await writeFile(join(repo, path), content);
  git('add', '-A'); git('commit', '-qm', 'head'); const head = git('rev-parse', 'HEAD');
  const options = { repo, base, head, comparison: 'direct', rulesYaml, ruleSource: 'pinned' };
  const definition = { schemaVersion: 'review-acceptance-expectations/v1', caseId: 'authored-multi-file', cohort: 'development', provenance: { kind: 'synthetic', author: 'contract-test', revision: '1' },
    revisions: { requestedBaseCommit: base, effectiveBaseCommit: base, headCommit: head, comparison: 'direct' }, ruleConfigId: parseRulesYaml(rulesYaml).id, ruleSource: 'pinned',
    changes: [row('left.ts'), row('right.ts', { addedLines: 1, selectedRuleIds: [], requiredPatchLines: ['-// old comment', '+// new comment'] }),
      row('binary.bin', { coverage: 'binary-omitted', addedLines: null, removedLines: null, selectedRuleIds: [], requiredPatchLines: [], sourceCoverage: null })] };
  return { repo, options, definition, bundle: await createReviewBundle(options) };
}

test('offline multi-file audit checks exact facts, pinned source coverage and per-change rule selection', async t => {
  const f = await fixture(t); const report = auditReviewBundle(f.bundle, f.definition);
  assert.equal(report.passed, true); assert.equal(report.results.length, 3); assert.equal(report.reviewerImprovement, 'not-measured');
  assert.equal(report.provenanceVerification, 'not-verified'); assert.equal(report.results.find(r => r.newPath === 'right.ts').selectedRuleIds.length, 0);
  assert(Object.isFrozen(report.results[0].differences));
});

test('matching global rule sets do not hide swapped per-file relevance', async t => {
  const f = await fixture(t); f.definition.changes[0].selectedRuleIds = []; f.definition.changes[1].selectedRuleIds = ['amount'];
  const report = auditReviewBundle(f.bundle, f.definition);
  assert.equal(report.factsPassed, true); assert.equal(report.ruleSelectionPassed, false);
  assert.deepEqual(report.results.find(r => r.newPath === 'left.ts').falseSelections, ['amount']);
  assert.deepEqual(report.results.find(r => r.newPath === 'right.ts').missedRules, ['amount']);
});

test('stale commits, comparison, rule config and mode are identity failures with diagnostics', async t => {
  const f = await fixture(t);
  for (const field of ['requestedBaseCommit', 'effectiveBaseCommit', 'headCommit', 'comparison', 'ruleConfigId', 'ruleSource']) {
    const d = clone(f.definition);
    if (field === 'comparison') d.revisions.comparison = 'merge-base';
    else if (field.endsWith('Commit')) { d.revisions[field] = 'a'.repeat(40); if (field !== 'headCommit') d.revisions.comparison = 'merge-base'; }
    else if (field === 'ruleConfigId') d.ruleConfigId = 'rules:' + 'a'.repeat(64);
    else { d.ruleSource = 'patch'; d.changes.forEach(c => c.sourceCoverage = null); }
    const report = auditReviewBundle(f.bundle, d); assert.equal(report.identityPassed, false); assert.equal(report.passed, false); assert(report.mismatches.some(m => m.field === field));
    if (['ruleConfigId', 'ruleSource'].includes(field)) assert.equal(report.factsPassed, true);
  }
});

test('missing and extra changes fail even when expected selections are empty', async t => {
  const f = await fixture(t); const omitted = clone(f.definition); omitted.changes.pop();
  assert.equal(auditReviewBundle(f.bundle, omitted).unexpectedChanges[0].newPath, 'binary.bin');
  const extra = clone(f.definition); extra.changes.push(row('missing.ts', { selectedRuleIds: [], requiredPatchLines: [], sourceCoverage: null }));
  const report = auditReviewBundle(f.bundle, extra); const result = report.results.find(r => r.newPath === 'missing.ts');
  assert.equal(result.changeId, null); assert.equal(result.factsPassed, false); assert.equal(result.ruleSelectionPassed, false);
});

test('wrong counts, kinds, status and exact patch lines are reported separately from rules', async t => {
  const f = await fixture(t); const d = clone(f.definition); d.changes[0].addedLines = 1; d.changes[0].status = 'T'; d.changes[0].newKind = 'symlink'; d.changes[0].requiredPatchLines.push('+missing');
  const report = auditReviewBundle(f.bundle, d); const result = report.results.find(r => r.newPath === 'left.ts');
  assert.equal(report.ruleSelectionPassed, true); assert.equal(report.factsPassed, false); assert.equal(result.differences.length, 3); assert.deepEqual(result.missingPatchLines, ['+missing']);
});

test('unavailable binary counts cannot be relabeled as zero', async t => {
  const f = await fixture(t); const d = clone(f.definition); d.changes[2].addedLines = 0;
  assert.throws(() => compileAcceptanceExpectations(d), { code: 'INVALID_ACCEPTANCE_INPUT' });
  d.changes[2].coverage = 'metadata-only'; d.changes[2].removedLines = 0;
  assert.equal(auditReviewBundle(f.bundle, d).factsPassed, false);
});

test('source coverage availability/reason mismatch fails rule acceptance', async t => {
  const f = await fixture(t); f.definition.changes[0].sourceCoverage = { available: false, reason: 'parse-unavailable' };
  const report = auditReviewBundle(f.bundle, f.definition); assert.equal(report.factsPassed, true); assert.equal(report.ruleSelectionPassed, false);
  assert.equal(report.results.find(r => r.newPath === 'left.ts').sourceCoveragePassed, false);
});

test('freeze normalizes input ordering without mutating data and rejects edited compiled identities', async t => {
  const f = await fixture(t); const saved = clone(f.definition); const compiled = compileAcceptanceExpectations(f.definition);
  f.definition.changes.reverse(); f.definition.changes.forEach(c => c.requiredPatchLines.reverse());
  assert.deepEqual(compileAcceptanceExpectations(f.definition), compiled); assert.deepEqual(auditReviewBundle(f.bundle, saved), auditReviewBundle(f.bundle, compiled));
  assert(Object.isFrozen(compiled.changes)); const forged = clone(compiled); forged.provenance.revision = '2';
  assert.throws(() => auditReviewBundle(f.bundle, forged), { code: 'INVALID_ACCEPTANCE_INPUT' });
  assert.notEqual(compileAcceptanceExpectations({ ...saved, cohort: 'held-out' }).id, compiled.id);
});

test('declarations of held-out and approved MR provenance are retained but never authenticated', async t => {
  const f = await fixture(t); f.definition.cohort = 'held-out'; f.definition.provenance.kind = 'approved-mr';
  const r = auditReviewBundle(f.bundle, f.definition); assert.equal(r.passed, true); assert.equal(r.declaredCohort, 'held-out'); assert.equal(r.declaredProvenance.kind, 'approved-mr'); assert.equal(r.provenanceVerification, 'not-verified');
});

test('legacy rule-free bundles pass with explicit null rule config and patch source', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/evaluation/runs.json', import.meta.url), 'utf8')).runs[0].request.bundle;
  const d = { schemaVersion: 'review-acceptance-expectations/v1', caseId: 'legacy-comment', cohort: 'development', provenance: { kind: 'synthetic', author: 'contract-test', revision: '1' },
    revisions: fixture.provenance.revisions, ruleConfigId: null, ruleSource: 'patch', changes: [row('rate.ts', { addedLines: 1, removedLines: 0, selectedRuleIds: [], requiredPatchLines: [], sourceCoverage: null })] };
  assert.equal(auditReviewBundle(fixture, d).passed, true);
});

test('added, deleted and renamed path pairs are compared without basename collisions', async t => {
  const f = await fixture(t, { 'delete.txt': 'gone\n', 'old.txt': 'stable\n' }, { 'added.txt': 'new\n', 'renamed.txt': 'stable\n' });
  f.definition.changes = [row('delete.txt', { status: 'D', newPath: null, newKind: null, selectedRuleIds: [], requiredPatchLines: ['-gone'], sourceCoverage: null }),
    row('added.txt', { status: 'A', oldPath: null, oldKind: null, addedLines: 1, removedLines: 0, selectedRuleIds: [], requiredPatchLines: ['+new'], sourceCoverage: null }),
    row('old.txt', { status: 'R', newPath: 'renamed.txt', coverage: 'metadata-only', removedLines: 0, selectedRuleIds: [], requiredPatchLines: [], sourceCoverage: null })];
  assert.equal(auditReviewBundle(f.bundle, f.definition).passed, true);
});

test('invalid and rehashed forged bundles fail integrity before any acceptance report', async t => {
  const f = await fixture(t); const b = clone(f.bundle); b.ruleSelection.decisions[0].matches = [];
  const { id, ...payload } = b; b.id = 'bundle:' + createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  assert.throws(() => auditReviewBundle(b, f.definition), { code: 'INVALID_ACCEPTANCE_BUNDLE' });
  assert.throws(() => auditReviewBundle({ bundle: f.bundle }, f.definition), { code: 'INVALID_ACCEPTANCE_BUNDLE' });
});

test('malformed, duplicate, oversized and executable expectation inputs fail safely', async t => {
  const f = await fixture(t);
  const mutations = [d => d.changes.push(d.changes[0]), d => d.changes[0].selectedRuleIds.push('amount'), d => d.changes[0].oldPath = '../bad', d => d.extra = true, d => d.changes[0].sourceCoverage.extra = true,
    d => d.ruleConfigId = null, d => d.changes[0].requiredPatchLines.push('two\nlines'), d => d.changes[0].addedLines = -1];
  for (const mutation of mutations) { const d = clone(f.definition); mutation(d); assert.throws(() => compileAcceptanceExpectations(d), { code: 'INVALID_ACCEPTANCE_INPUT' }); }
  let touched = false; const getter = Object.defineProperty({}, 'schemaVersion', { enumerable: true, get() { touched = true; return 'x'; } });
  assert.throws(() => compileAcceptanceExpectations(getter)); assert.equal(touched, false);
  const cycle = {}; cycle.self = cycle; assert.throws(() => compileAcceptanceExpectations(cycle));
  assert.throws(() => compileAcceptanceExpectations(f.definition, { maxExpectationsBytes: 1 }), { code: 'ACCEPTANCE_LIMIT' });
  assert.throws(() => auditReviewBundle(f.bundle, f.definition, { maxBundleBytes: 1 }), { code: 'ACCEPTANCE_LIMIT' });
  assert.throws(() => auditReviewBundle(f.bundle, f.definition, { maxReportBytes: 1 }), { code: 'ACCEPTANCE_LIMIT' });
  assert.throws(() => auditReviewBundle(f.bundle, f.definition, { unknown: true }), { code: 'INVALID_ACCEPTANCE_INPUT' });
});

test('CLI audit distinguishes pass, mismatches and invalid data without partial invalid output', async t => {
  const f = await fixture(t); const bundlePath = join(f.repo, 'bundle.json'); const expectationPath = join(f.repo, 'expectations.json');
  await writeFile(bundlePath, JSON.stringify(f.bundle)); await writeFile(expectationPath, JSON.stringify(f.definition));
  const run = (...extra) => spawnSync(process.execPath, [resolve('src/cli.js'), 'audit', '--bundle', bundlePath, '--expectations', expectationPath, ...extra], { encoding: 'utf8', timeout: 20000 });
  let r = run(); assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).passed, true);
  f.definition.changes[0].removedLines = 2; await writeFile(expectationPath, JSON.stringify(f.definition));
  r = run(); assert.equal(r.status, 2); assert.equal(JSON.parse(r.stdout).passed, false); assert.equal(r.stderr, '');
  await writeFile(expectationPath, '{'); r = run(); assert.equal(r.status, 1); assert.equal(r.stdout, ''); assert.equal(JSON.parse(r.stderr).error.code, 'INVALID_INPUT');
  r = run('--max-expectations-bytes', '0'); assert.equal(r.status, 1);
  r = run('--repo', f.repo); assert.equal(r.status, 1);
});

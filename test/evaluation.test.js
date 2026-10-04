import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { compileEvaluationDataset, evaluateReviewRuns, normalizeReviewerResponse, createReviewerRequest } from '../src/index.js';

const definition = JSON.parse(await readFile(new URL('../fixtures/evaluation/definition.json', import.meta.url), 'utf8'));
const dataset = JSON.parse(await readFile(new URL('../fixtures/evaluation/dataset.json', import.meta.url), 'utf8'));
const fixture = JSON.parse(await readFile(new URL('../fixtures/evaluation/runs.json', import.meta.url), 'utf8'));
const copy = value => JSON.parse(JSON.stringify(value));
const evaluate = input => evaluateReviewRuns(dataset, input ?? fixture);
const candidate = (report, id = 'diff-only') => report.candidates.find(item => item.id === id);
const positive = input => input.runs.find(run => run.candidateId === 'diff-only' && run.caseId === 'guard-removal' && run.repetition === 1);
function adjudicate(run, labelId) {
  run.judgments = normalizeReviewerResponse(run.request, run.response).findings.map(finding => ({ findingId: finding.id, labelId }));
}
function failed(run) {
  delete run.response; delete run.judgments; run.status = 'failed'; run.errorCode = 'REVIEW_TIMEOUT';
}

test('frozen dataset compilation normalizes ordering and distinguishes label changes', () => {
  assert.deepEqual(compileEvaluationDataset(definition), dataset);
  const reordered = copy(definition); reordered.cases.reverse();
  assert.deepEqual(compileEvaluationDataset(reordered), dataset);
  reordered.cases.find(item => item.labels.length).labels[0].description += ' changed';
  assert.notEqual(compileEvaluationDataset(reordered).id, dataset.id);
  assert(Object.isFrozen(compileEvaluationDataset(definition).cases));
});

test('synthetic baseline has known TP/FP/FN and descriptive quality deltas', () => {
  const report = evaluate();
  assert.deepEqual(candidate(report).quality, { tp: 1, fp: 1, fn: 1, precision: 0.5, recall: 0.5, f1: 0.5 });
  assert.deepEqual(candidate(report, 'caller-context').quality, { tp: 2, fp: 0, fn: 0, precision: 1, recall: 1, f1: 1 });
  assert.deepEqual(report.comparisons[0].qualityDelta, { precision: 0.5, recall: 0.5, f1: 0.5 });
  assert.equal(report.evidenceKind, 'synthetic-or-mixed');
  assert.equal(candidate(report).measurements.costUsd.total, null); assert.equal(candidate(report).measurements.inputTokens.missing, 4);
  assert(report.limitations.some(item => item.includes('not actual reviewer quality')));
});

test('repeat stability distinguishes exact claims and matched labels with explicit pair coverage', () => {
  const report = evaluate();
  assert.equal(candidate(report).stability.claimJaccard, 0);
  assert.equal(candidate(report).stability.matchedLabelJaccard, 0.5);
  assert.equal(candidate(report).stability.observedPairs, 2);
  assert.equal(candidate(report, 'caller-context').stability.claimJaccard, 1);
  assert.equal(candidate(report, 'caller-context').stability.cases.find(item => item.caseId === 'comment-only').claimJaccard, 1);
});

test('input record ordering does not change report identity or mutate caller data', () => {
  const input = copy(fixture); const before = copy(input);
  const expected = evaluate(input); input.candidates.reverse(); input.runs.reverse();
  assert.deepEqual(evaluate(input), expected); assert(Object.isFrozen(expected.runs[0].score));
  before.runs[0].request.bundle.coverage.limitations.push('caller edit');
  assert(!expected.limitations.includes('caller edit'));
});

test('distinct duplicate claims count once as TP and the remainder as FP; exact duplicates normalize away', () => {
  const input = copy(fixture); const run = positive(input);
  run.response.findings.push({ ...copy(run.response.findings[0]), title: 'A second claim for the same defect' });
  adjudicate(run, 'zero-division');
  const report = evaluate(input); assert.equal(candidate(report).quality.tp, 1); assert.equal(candidate(report).quality.fp, 2);
  assert.equal(candidate(report).duplicateClaims, 1);
  run.response.findings.pop(); run.response.findings.push(copy(run.response.findings[0])); adjudicate(run, 'zero-division');
  assert.equal(candidate(evaluate(input)).duplicateClaims, 0); assert.equal(candidate(evaluate(input)).quality.fp, 1);
});

test('all normalized claims require exactly one explicit judgment and an existing truth label', () => {
  for (const mutate of [run => { run.judgments = []; }, run => { run.judgments.push(copy(run.judgments[0])); },
    run => { run.judgments[0].labelId = 'unknown-label'; }, run => { run.judgments[0].findingId = 'finding:unknown'; },
    run => { run.judgments[0].extra = true; }]) {
    const input = copy(fixture); mutate(positive(input));
    assert.throws(() => evaluate(input), { code: 'INVALID_EVALUATION_INPUT' });
  }
});

test('failed runs remain in attempt coverage and are excluded from quality/stability denominators', () => {
  const input = copy(fixture); failed(positive(input));
  const report = evaluate(input); const baseline = candidate(report);
  assert.equal(baseline.runCoverage.failed, 1); assert.equal(baseline.runCoverage.successRate, 0.75);
  assert.deepEqual(baseline.quality, { tp: 0, fp: 1, fn: 1, precision: 0, recall: 0, f1: 0 });
  assert.equal(baseline.stability.expectedPairs, 2); assert.equal(baseline.stability.observedPairs, 1);
  assert.equal(report.comparisons[0].allAttemptsSuccessful, false);
  assert.equal(report.runs.find(run => run.errorCode).score, null);
});

test('all-failed candidates have null quality/stability rather than fabricated zero scores', () => {
  const input = copy(fixture); input.runs.filter(run => run.candidateId === 'diff-only').forEach(failed);
  const report = evaluate(input); const baseline = candidate(report);
  assert.equal(baseline.quality, null); assert.equal(baseline.stability.claimJaccard, null);
  assert.equal(baseline.runCoverage.failed, 4); assert.equal(report.comparisons[0].qualityDelta.precision, null);
});

test('partial reviewers are scored conservatively and retain incomplete-comparison flags', () => {
  const input = copy(fixture); positive(input).response.status = 'partial';
  const report = evaluate(input); assert.equal(candidate(report).runCoverage.partialReviews, 1);
  assert.equal(candidate(report).quality.recall, 0.5); assert.equal(report.comparisons[0].allReviewsComplete, false);
});

test('complete matrix, unique slots and frozen repeated packets are enforced', () => {
  for (const mutate of [input => { input.runs.pop(); }, input => { input.runs[0] = copy(input.runs[1]); },
    input => { input.runs[0].candidateId = 'unknown'; }, input => { input.runs[0].repetition = 99; },
    input => { input.baselineCandidateId = 'unknown'; }, input => { input.datasetId = 'dataset:unknown'; }]) {
    const input = copy(fixture); mutate(input); assert.throws(() => evaluate(input), { code: 'INVALID_EVALUATION_INPUT' });
  }
  const input = copy(fixture); const run = positive(input);
  run.request = copy(input.runs.find(item => item.candidateId === 'caller-context' && item.caseId === run.caseId).request);
  assert.throws(() => evaluate(input), { code: 'INVALID_EVALUATION_INPUT' });
  const changed = copy(fixture); const other = positive(changed); const bundle = copy(other.request.bundle);
  bundle.coverage.limitations.push('Different packet policy checkpoint');
  const { id, ...payload } = bundle; bundle.id = 'bundle:' + createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  other.request = createReviewerRequest(bundle, other.request.reviewer); other.response.requestId = other.request.id; adjudicate(other, 'zero-division');
  assert.throws(() => evaluate(changed), error => error.code === 'INVALID_EVALUATION_INPUT' && error.message.includes('same frozen packet'));
});

test('foreign commit provenance and malformed packets/responses fail before scoring', () => {
  const input = copy(fixture); input.runs[0].request.bundle.provenance.revisions.headCommit = '0'.repeat(40);
  assert.throws(() => evaluate(input), { code: 'INVALID_EVALUATION_INPUT' });
  const broken = copy(fixture); positive(broken).response.requestId = 'request:unknown';
  assert.throws(() => evaluate(broken), { code: 'INVALID_EVALUATION_RUN' });
  const failedInput = copy(fixture); const run = positive(failedInput); failed(run); run.request.id = 'request:unknown';
  assert.throws(() => evaluate(failedInput), { code: 'INVALID_EVALUATION_RUN' });
});

test('observed, synthetic and missing measurements retain provenance and include failed attempt costs', () => {
  const input = copy(fixture); const runs = input.runs.filter(run => run.candidateId === 'diff-only');
  runs[0].measurements = { source: 'observed', inputTokens: 10, outputTokens: 5, costUsd: 0.01, latencyMs: 100 };
  runs[1].measurements = { source: 'synthetic', inputTokens: 20, outputTokens: null, costUsd: 0.02, latencyMs: 200 }; failed(runs[1]);
  const measured = candidate(evaluate(input)).measurements;
  assert.deepEqual(measured.inputTokens, { samples: 2, missing: 2, total: 30, mean: 15, source: 'mixed' });
  assert.equal(measured.outputTokens.source, 'observed'); assert.equal(measured.costUsd.total, 0.03);
  assert.equal(measured.latencyMs.mean, 150);
  runs[0].measurements.inputTokens = -1; assert.throws(() => evaluate(input), { code: 'INVALID_EVALUATION_INPUT' });
});

test('empty prediction/label denominators are undefined and not promoted to perfect precision', () => {
  const input = copy(fixture); input.runs.forEach(run => { run.response.findings = []; run.judgments = []; });
  const report = evaluate(input); assert.equal(candidate(report).quality.precision, null); assert.equal(candidate(report).quality.recall, 0);
  const changedDefinition = copy(definition); changedDefinition.cases.forEach(item => { item.labels = []; });
  const emptyDataset = compileEvaluationDataset(changedDefinition); input.datasetId = emptyDataset.id;
  const empty = evaluateReviewRuns(emptyDataset, input); assert.equal(candidate(empty).quality.recall, null); assert.equal(candidate(empty).quality.f1, null);
});

test('paired usage deltas include only matching observed samples; synthetic values are excluded', () => {
  const input = copy(fixture); const baseline = positive(input);
  const other = input.runs.find(run => run.candidateId === 'caller-context' && run.caseId === baseline.caseId && run.repetition === baseline.repetition);
  baseline.measurements = { source: 'observed', inputTokens: 20, outputTokens: null, costUsd: 0.01, latencyMs: 100 };
  other.measurements = { source: 'observed', inputTokens: 40, outputTokens: 10, costUsd: 0.03, latencyMs: 150 };
  const delta = evaluate(input).comparisons[0].observedMeasurementDelta;
  assert.deepEqual(delta.inputTokens, { expectedPairs: 4, observedPairedSamples: 1, meanDelta: 20 });
  assert.equal(delta.outputTokens.meanDelta, null); assert.equal(delta.latencyMs.meanDelta, 50);
  other.measurements.source = 'synthetic'; assert.equal(evaluate(input).comparisons[0].observedMeasurementDelta.inputTokens.meanDelta, null);
});

test('single repetitions have no stability evidence; numerical measurement overflow fails explicitly', () => {
  const input = copy(fixture); input.repetitions = 1; input.runs = input.runs.filter(run => run.repetition === 1);
  assert.equal(candidate(evaluate(input)).stability.observedPairs, 0); assert.equal(candidate(evaluate(input)).stability.claimJaccard, null);
  input.runs.forEach(run => { run.measurements = { source: 'observed', inputTokens: null, outputTokens: null, costUsd: Number.MAX_VALUE, latencyMs: null }; });
  assert.throws(() => evaluate(input), { code: 'EVALUATION_LIMIT' });
});

test('dataset schema, duplicate labels, malformed options and byte/structure limits fail closed', () => {
  for (const mutate of [data => { data.cases[0].labels.push(copy(data.cases[0].labels[0])); }, data => { data.schemaVersion = 'other'; },
    data => { data.cases[0].headCommit = 'HEAD'; }, data => { data.cases[0].labels[0].location.path = '../outside'; }]) {
    const data = copy(definition); mutate(data); assert.throws(() => compileEvaluationDataset(data), { code: 'INVALID_EVALUATION_INPUT' });
  }
  assert.throws(() => compileEvaluationDataset(definition, null), { code: 'INVALID_EVALUATION_INPUT' });
  assert.throws(() => compileEvaluationDataset(definition, { maxDatasetBytes: 1 }), { code: 'EVALUATION_LIMIT' });
  assert.throws(() => evaluateReviewRuns(dataset, fixture, { maxInputBytes: 1 }), { code: 'EVALUATION_LIMIT' });
  const report = evaluate(); const size = Buffer.byteLength(JSON.stringify(report));
  assert.deepEqual(evaluateReviewRuns(dataset, fixture, { maxReportBytes: size }), report);
  assert.throws(() => evaluateReviewRuns(dataset, fixture, { maxReportBytes: size - 1 }), { code: 'EVALUATION_LIMIT' });
  const cyclic = copy(fixture); cyclic.extra = cyclic; assert.throws(() => evaluate(cyclic), { code: 'INVALID_EVALUATION_INPUT' });
});

test('offline dataset/evaluate CLI uses frozen fixtures and emits no partial report on errors', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'evaluation-cli-')); t.after(() => rm(temp, { recursive: true, force: true }));
  const run = args => spawnSync(process.execPath, [resolve('src/cli.js'), ...args], { encoding: 'utf8' });
  const compiled = run(['dataset', '--definition', resolve('fixtures/evaluation/definition.json')]);
  assert.equal(compiled.status, 0, compiled.stderr); assert.deepEqual(JSON.parse(compiled.stdout), dataset);
  const result = run(['evaluate', '--dataset', resolve('fixtures/evaluation/dataset.json'), '--runs', resolve('fixtures/evaluation/runs.json')]);
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), evaluate());
  const bad = join(temp, 'bad.json'); await writeFile(bad, '{bad');
  for (const args of [['evaluate', '--dataset', resolve('fixtures/evaluation/dataset.json'), '--runs', bad],
    ['evaluate', '--dataset', resolve('fixtures/evaluation/dataset.json'), '--runs', resolve('fixtures/evaluation/runs.json'), '--max-report-bytes', '1'],
    ['dataset', '--definition', resolve('fixtures/evaluation/definition.json'), '--unknown', 'x']]) {
    const result = run(args); assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert(JSON.parse(result.stderr).error.code);
  }
});

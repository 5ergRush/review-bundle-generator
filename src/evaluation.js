import { createHash } from 'node:crypto';
import { boundedJson, normalizeReviewerResponse } from './reviewer.js';

const MAX_BYTES = 64 * 1024 * 1024;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const oid = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value);
export class EvaluationError extends Error {
  constructor(code, message) { super(message); this.name = 'EvaluationError'; this.code = code; }
}
function check(condition, message, code = 'INVALID_EVALUATION_INPUT') {
  if (!condition) throw new EvaluationError(code, message);
}
function keys(value, names) {
  check(object(value) && Object.keys(value).sort().join(',') === [...names].sort().join(','), 'Unexpected or missing evaluation fields.');
}
function text(value, name, max = 4096) {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0'), `${name} must be bounded nonempty text.`); return value;
}
function id(value) { check(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value), 'Invalid evaluation identifier.'); return value; }
function integer(value, minimum, maximum) { check(Number.isSafeInteger(value) && value >= minimum && value <= maximum, 'Invalid bounded integer.'); return value; }
function bytes(value) { return integer(value, 1, MAX_BYTES); }
function copy(value, maxBytes) {
  try { return boundedJson(value, maxBytes, 'INVALID_EVALUATION_INPUT'); }
  catch (error) { throw new EvaluationError(error.code === 'REVIEW_LIMIT' ? 'EVALUATION_LIMIT' : 'INVALID_EVALUATION_INPUT', 'Evaluation input is not bounded plain JSON.'); }
}
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function provenance(value) {
  keys(value, ['kind', 'author', 'revision']); check(['human', 'synthetic'].includes(value.kind), 'Label/adjudication kind must be human or synthetic.');
  return { kind: value.kind, author: text(value.author, 'author', 128), revision: text(value.revision, 'revision', 128) };
}
function unique(items, key, maximum) {
  check(Array.isArray(items) && items.length <= maximum && new Set(items.map(key)).size === items.length, 'Duplicate or oversized records.');
}

export function compileEvaluationDataset(input, options = {}) {
  check(object(options) && Object.keys(options).every(key => key === 'maxDatasetBytes'), 'Unknown dataset options.');
  const maxBytes = bytes(options.maxDatasetBytes ?? 1024 * 1024);
  const data = copy(input, maxBytes);
  keys(data, ['schemaVersion', 'name', 'version', 'labelProvenance', 'cases']);
  check(data.schemaVersion === 'review-dataset/v1', 'Expected review-dataset/v1.');
  unique(data.cases, item => item?.id, 100); check(data.cases.length > 0, 'Dataset requires at least one case.');
  const cases = data.cases.map(item => {
    keys(item, ['id', 'description', 'baseCommit', 'headCommit', 'comparison', 'labels']);
    check(oid(item.baseCommit) && oid(item.headCommit) && ['direct', 'merge-base'].includes(item.comparison), 'Cases require pinned commits and comparison semantics.');
    unique(item.labels, label => label?.id, 250);
    const labels = item.labels.map(label => {
      keys(label, ['id', 'description', 'location']); keys(label.location, ['side', 'path', 'startLine', 'endLine']);
      const location = label.location;
      check(['old', 'new'].includes(location.side) && typeof location.path === 'string' && location.path.length > 0 && location.path.length <= 4096 &&
        !location.path.includes('\0') && !location.path.startsWith('/') && !location.path.split('/').some(part => !part || part === '..' || part === '.'), 'Invalid label location.');
      integer(location.startLine, 1, 0x7fffffff); integer(location.endLine, location.startLine, 0x7fffffff);
      return { id: id(label.id), description: text(label.description, 'label description'),
        location: { side: location.side, path: location.path, startLine: location.startLine, endLine: location.endLine } };
    }).sort((a, b) => compare(a.id, b.id));
    return { id: id(item.id), description: text(item.description, 'case description'), baseCommit: item.baseCommit,
      headCommit: item.headCommit, comparison: item.comparison, labels };
  }).sort((a, b) => compare(a.id, b.id));
  const payload = { schemaVersion: 'review-dataset/v1', name: text(data.name, 'dataset name', 128), version: text(data.version, 'dataset version', 128),
    labelProvenance: provenance(data.labelProvenance), cases };
  const result = { id: `dataset:${hash(payload)}`, ...payload };
  check(Buffer.byteLength(JSON.stringify(result)) <= maxBytes, 'Compiled dataset exceeds maxDatasetBytes.', 'EVALUATION_LIMIT');
  return freeze(result);
}

const ratio = (a, b) => b === 0 ? null : a / b;
function metrics(tp, fp, fn) { return { tp, fp, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), f1: ratio(2 * tp, 2 * tp + fp + fn) }; }
function score(findings, labels, judgments) {
  unique(judgments, item => item?.findingId, 250);
  const findingIds = new Set(findings.map(item => item.id)); const labelIds = new Set(labels.map(item => item.id));
  check(judgments.length === findings.length, 'Every normalized finding requires exactly one independent judgment.');
  const decisions = new Map();
  for (const judgment of judgments) {
    keys(judgment, ['findingId', 'labelId']); check(findingIds.has(judgment.findingId) && (judgment.labelId === null || labelIds.has(judgment.labelId)), 'Judgment references an unknown finding or label.');
    decisions.set(judgment.findingId, judgment.labelId);
  }
  const matched = new Set(); const falsePositiveFindingIds = []; const duplicateFindingIds = [];
  for (const finding of findings) {
    const labelId = decisions.get(finding.id);
    if (labelId === null) falsePositiveFindingIds.push(finding.id);
    else if (matched.has(labelId)) { falsePositiveFindingIds.push(finding.id); duplicateFindingIds.push(finding.id); }
    else matched.add(labelId);
  }
  const matchedLabelIds = [...matched].sort(compare);
  return { ...metrics(matched.size, falsePositiveFindingIds.length, labels.length - matched.size), matchedLabelIds,
    missedLabelIds: [...labelIds].filter(item => !matched.has(item)).sort(compare), falsePositiveFindingIds, duplicateFindingIds };
}
function claimSignature(finding) {
  const location = finding.location;
  return `claim:${hash({ ruleId: finding.ruleId, severity: finding.severity, title: finding.title, description: finding.description,
    location: { side: location.side, commit: location.commit, path: location.path, object: location.object,
      startLine: location.startLine, endLine: location.endLine } })}`;
}
function jaccard(a, b) {
  const left = new Set(a); const right = new Set(b); const union = new Set([...left, ...right]);
  return union.size === 0 ? 1 : [...left].filter(item => right.has(item)).length / union.size;
}
function stability(runs, repetitions) {
  const successful = runs.filter(run => run.status === 'success'); let pairs = 0; let claims = 0; let labels = 0;
  for (let i = 0; i < successful.length; i++) for (let j = i + 1; j < successful.length; j++) {
    pairs++; claims += jaccard(successful[i].claimSignatures, successful[j].claimSignatures);
    labels += jaccard(successful[i].score.matchedLabelIds, successful[j].score.matchedLabelIds);
  }
  return { expectedPairs: repetitions * (repetitions - 1) / 2, observedPairs: pairs,
    claimJaccard: ratio(claims, pairs), matchedLabelJaccard: ratio(labels, pairs) };
}
function measured(value) {
  if (value === null) return null;
  keys(value, ['source', 'inputTokens', 'outputTokens', 'costUsd', 'latencyMs']);
  check(['observed', 'synthetic'].includes(value.source), 'Measurements require an observed or synthetic source.');
  for (const field of ['inputTokens', 'outputTokens', 'costUsd', 'latencyMs']) {
    const number = value[field]; check(number === null || (typeof number === 'number' && Number.isFinite(number) && number >= 0 &&
      (!field.endsWith('Tokens') || Number.isSafeInteger(number))), 'Invalid measurement.');
  }
  return { source: value.source, inputTokens: value.inputTokens, outputTokens: value.outputTokens, costUsd: value.costUsd, latencyMs: value.latencyMs };
}
function measurements(runs) {
  return Object.fromEntries(['inputTokens', 'outputTokens', 'costUsd', 'latencyMs'].map(field => {
    const supplied = runs.filter(run => run.measurements?.[field] !== null && run.measurements?.[field] !== undefined);
    const total = supplied.reduce((sum, run) => sum + run.measurements[field], 0);
    check(Number.isFinite(total) && (!field.endsWith('Tokens') || Number.isSafeInteger(total)), 'Measurement aggregate overflows.', 'EVALUATION_LIMIT');
    const sources = new Set(supplied.map(run => run.measurements.source));
    return [field, { samples: supplied.length, missing: runs.length - supplied.length, total: supplied.length ? total : null,
      mean: ratio(total, supplied.length), source: !sources.size ? 'unavailable' : sources.size > 1 ? 'mixed' : [...sources][0] }];
  }));
}

function measurementComparison(runs, candidateId, baselineId) {
  const own = runs.filter(run => run.candidateId === candidateId);
  const baseline = new Map(runs.filter(run => run.candidateId === baselineId).map(run => [JSON.stringify([run.caseId, run.repetition]), run]));
  return Object.fromEntries(['inputTokens', 'outputTokens', 'costUsd', 'latencyMs'].map(field => {
    const paired = own.flatMap(run => {
      const other = baseline.get(JSON.stringify([run.caseId, run.repetition]));
      if (run.measurements?.source !== 'observed' || other?.measurements?.source !== 'observed' ||
        run.measurements[field] === null || other.measurements[field] === null) return [];
      return [run.measurements[field] - other.measurements[field]];
    });
    const total = paired.reduce((sum, value) => sum + value, 0);
    check(Number.isFinite(total) && (!field.endsWith('Tokens') || Number.isSafeInteger(total)), 'Paired measurement aggregate overflows.', 'EVALUATION_LIMIT');
    return [field, { expectedPairs: own.length, observedPairedSamples: paired.length, meanDelta: ratio(total, paired.length) }];
  }));
}

export function evaluateReviewRuns(inputDataset, input, options = {}) {
  check(object(options) && Object.keys(options).every(key => ['maxInputBytes', 'maxReportBytes'].includes(key)), 'Unknown evaluation options.');
  const maxInputBytes = bytes(options.maxInputBytes ?? MAX_BYTES); const maxReportBytes = bytes(options.maxReportBytes ?? 16 * 1024 * 1024);
  const stored = copy(inputDataset, MAX_BYTES); check(object(stored), 'Expected a compiled dataset.');
  const { id: datasetId, ...definition } = stored;
  const dataset = compileEvaluationDataset(definition, { maxDatasetBytes: MAX_BYTES }); check(dataset.id === datasetId, 'Dataset ID does not match frozen labels.');
  const data = copy(input, maxInputBytes);
  keys(data, ['schemaVersion', 'datasetId', 'baselineCandidateId', 'repetitions', 'candidates', 'adjudication', 'runs']);
  check(data.schemaVersion === 'review-evaluation/v1' && data.datasetId === dataset.id, 'Evaluation must reference the frozen dataset.');
  const repetitions = integer(data.repetitions, 1, 10); const adjudication = provenance(data.adjudication);
  unique(data.candidates, item => item?.id, 8); check(data.candidates.length > 0, 'At least one candidate is required.');
  const candidates = data.candidates.map(candidate => {
    keys(candidate, ['id', 'kind', 'reviewer']); keys(candidate.reviewer, ['id', 'version']);
    check(['synthetic', 'recorded-reviewer'].includes(candidate.kind), 'Candidate kind must identify synthetic or recorded reviewer execution.');
    return { id: id(candidate.id), kind: candidate.kind, reviewer: { id: text(candidate.reviewer.id, 'reviewer ID', 128), version: text(candidate.reviewer.version, 'reviewer version', 128) } };
  }).sort((a, b) => compare(a.id, b.id));
  check(candidates.some(item => item.id === data.baselineCandidateId), 'Baseline candidate is unknown.');
  const expectedRuns = candidates.length * dataset.cases.length * repetitions;
  check(expectedRuns <= 500 && Array.isArray(data.runs) && data.runs.length === expectedRuns, 'Require the complete candidate/case/repetition matrix, capped at 500 runs.');
  const slots = new Set(); const groupRequests = new Map(); const runs = [];
  for (const run of data.runs) {
    check(object(run) && ['success', 'failed'].includes(run.status), 'Run status must be success or failed.');
    keys(run, ['candidateId', 'caseId', 'repetition', 'status', 'request', 'measurements',
      ...(run.status === 'success' ? ['response', 'judgments'] : ['errorCode'])]);
    const candidate = candidates.find(item => item.id === run.candidateId); const item = dataset.cases.find(item => item.id === run.caseId);
    check(candidate && item, 'Unknown run candidate/case.'); integer(run.repetition, 1, repetitions);
    const slot = JSON.stringify([candidate.id, item.id, run.repetition]); check(!slots.has(slot), 'Duplicate run matrix slot.'); slots.add(slot);
    const request = run.request;
    check(object(request) && JSON.stringify(request.reviewer) === JSON.stringify(candidate.reviewer), 'Run reviewer does not match candidate.');
    const revisions = request.bundle?.provenance?.revisions;
    check(revisions?.effectiveBaseCommit === item.baseCommit && revisions?.headCommit === item.headCommit && revisions?.comparison === item.comparison, 'Run input does not match frozen case commits/comparison.');
    // Normalize even failure records against an empty synthetic response to validate the packet.
    let normalized;
    try {
      normalized = normalizeReviewerResponse(request, run.status === 'success' ? run.response : {
        schemaVersion: 'reviewer-response/v1', requestId: request.id, reviewer: request.reviewer,
        status: 'partial', reviewedRuleIds: [], findings: [], contextRequests: [],
      }, { maxResponseBytes: MAX_BYTES, maxResultBytes: MAX_BYTES });
    } catch { throw new EvaluationError('INVALID_EVALUATION_RUN', 'Run packet or reviewer response failed normalization.'); }
    const group = JSON.stringify([candidate.id, item.id]);
    check(!groupRequests.has(group) || groupRequests.get(group) === normalized.requestId, 'Repeated runs must use the same frozen packet.'); groupRequests.set(group, normalized.requestId);
    const common = { candidateId: candidate.id, caseId: item.id, repetition: run.repetition, status: run.status,
      requestId: normalized.requestId, bundleId: normalized.bundleId, measurements: measured(run.measurements) };
    if (run.status === 'failed') {
      runs.push({ ...common, errorCode: id(run.errorCode), score: null, resultId: null, reviewerStatus: null, claimSignatures: [], judgments: [] });
    } else {
      runs.push({ ...common, errorCode: null, score: score(normalized.findings, item.labels, run.judgments), resultId: normalized.id,
        reviewerStatus: normalized.coverage.reviewer.status, claimSignatures: [...new Set(normalized.findings.map(claimSignature))].sort(compare),
        judgments: run.judgments.map(item => ({ findingId: item.findingId, labelId: item.labelId })).sort((a, b) => compare(a.findingId, b.findingId)) });
    }
  }
  runs.sort((a, b) => compare(a.candidateId, b.candidateId) || compare(a.caseId, b.caseId) || a.repetition - b.repetition);
  const summaries = candidates.map(candidate => {
    const own = runs.filter(run => run.candidateId === candidate.id); const successful = own.filter(run => run.status === 'success');
    const totals = successful.reduce((sum, run) => ({ tp: sum.tp + run.score.tp, fp: sum.fp + run.score.fp, fn: sum.fn + run.score.fn }), { tp: 0, fp: 0, fn: 0 });
    const perCaseStability = dataset.cases.map(item => ({ caseId: item.id, ...stability(own.filter(run => run.caseId === item.id), repetitions) }));
    const pairs = perCaseStability.reduce((sum, item) => sum + item.observedPairs, 0);
    return { ...candidate, runCoverage: { expected: own.length, successful: successful.length, failed: own.length - successful.length,
      successRate: ratio(successful.length, own.length), completeReviews: successful.filter(run => run.reviewerStatus === 'complete').length,
      partialReviews: successful.filter(run => run.reviewerStatus === 'partial').length, needsContext: successful.filter(run => run.reviewerStatus === 'needs-context').length },
      quality: successful.length ? metrics(totals.tp, totals.fp, totals.fn) : null,
      duplicateClaims: successful.reduce((sum, run) => sum + run.score.duplicateFindingIds.length, 0),
      stability: { expectedPairs: perCaseStability.reduce((sum, item) => sum + item.expectedPairs, 0), observedPairs: pairs,
        claimJaccard: ratio(perCaseStability.reduce((sum, item) => sum + (item.claimJaccard ?? 0) * item.observedPairs, 0), pairs),
        matchedLabelJaccard: ratio(perCaseStability.reduce((sum, item) => sum + (item.matchedLabelJaccard ?? 0) * item.observedPairs, 0), pairs), cases: perCaseStability },
      measurements: measurements(own) };
  });
  const baseline = summaries.find(item => item.id === data.baselineCandidateId);
  const comparisons = summaries.filter(item => item !== baseline).map(candidate => ({ candidateId: candidate.id, baselineCandidateId: baseline.id,
    allAttemptsSuccessful: !candidate.runCoverage.failed && !baseline.runCoverage.failed,
    allReviewsComplete: candidate.runCoverage.completeReviews === candidate.runCoverage.expected && baseline.runCoverage.completeReviews === baseline.runCoverage.expected,
    qualityDelta: Object.fromEntries(['precision', 'recall', 'f1'].map(field => [field, candidate.quality?.[field] == null || baseline.quality?.[field] == null ? null : candidate.quality[field] - baseline.quality[field]])),
    observedMeasurementDelta: measurementComparison(runs, candidate.id, baseline.id) }));
  const evaluationInputId = `evaluation:${hash({ datasetId: dataset.id, baselineCandidateId: baseline.id, repetitions, candidates, adjudication, runs })}`;
  const payload = { schemaVersion: 'review-evaluation-report/v1', datasetId: dataset.id, evaluationInputId,
    labelProvenance: dataset.labelProvenance, adjudication, baselineCandidateId: baseline.id, repetitions,
    evidenceKind: dataset.labelProvenance.kind === 'synthetic' || adjudication.kind === 'synthetic' || candidates.some(item => item.kind === 'synthetic') ? 'synthetic-or-mixed' : 'human-adjudicated-recorded-runs',
    policy: { truth: 'frozen-independent-labels', matching: 'explicit-adjudication', duplicates: 'one-true-positive-per-label-per-run',
      quality: 'micro-counts-across-successful-attempts-including-partial-reviews', failures: 'excluded-from-quality-and-stability-reported-in-coverage',
      stability: 'pairwise-jaccard-on-identical-packets-empty-pair-is-one', missingMeasurements: 'null-not-zero' },
    candidates: summaries, comparisons, runs,
    limitations: ['Reported label/adjudication/execution provenance is caller supplied; evaluation does not independently verify it.',
      'Synthetic fixtures validate scoring logic, not actual reviewer quality or cost.',
      'Quality uses successful attempts only; inspect failure and reviewer-completion coverage before comparing.',
      'Partial and needs-context reviews are scored conservatively against all case labels.',
      'Measurements are externally supplied and retain observed/synthetic/mixed provenance; unavailable values stay null.',
      'Claims remain unverified reviewer claims outside this explicitly adjudicated evaluation.'] };
  const report = { id: `report:${hash(payload)}`, ...payload };
  check(Buffer.byteLength(JSON.stringify(report)) <= maxReportBytes, 'Evaluation report exceeds maxReportBytes.', 'EVALUATION_LIMIT');
  return freeze(report);
}

import { createHash } from 'node:crypto';
import { boundedJson, createReviewerRequest } from './reviewer.js';

const MAX_BYTES = 64 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const pair = value => JSON.stringify([value.oldPath, value.newPath]);
const oid = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value);
export class AcceptanceError extends Error {
  constructor(code, message) { super(message); this.name = 'AcceptanceError'; this.code = code; }
}
function check(ok, message, code = 'INVALID_ACCEPTANCE_INPUT') { if (!ok) throw new AcceptanceError(code, message); }
function keys(value, names) { check(object(value) && Object.keys(value).sort().join(',') === [...names].sort().join(','), 'Unexpected or missing acceptance fields.'); }
function bytes(value) { check(Number.isSafeInteger(value) && value > 0 && value <= MAX_BYTES, 'Byte limits must be integers from 1 to 67108864.'); return value; }
function text(value, max = 4096) { check(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0'), 'Expected bounded nonempty text.'); return value; }
function path(value) { check(value === null || (typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\0') && !value.startsWith('/') && !value.split('/').some(part => !part || ['.', '..'].includes(part))), 'Invalid expected path.'); return value; }
function copy(value, limit) {
  try { return boundedJson(value, limit, 'INVALID_ACCEPTANCE_INPUT'); }
  catch (error) { throw new AcceptanceError(error.code === 'REVIEW_LIMIT' ? 'ACCEPTANCE_LIMIT' : 'INVALID_ACCEPTANCE_INPUT', 'Acceptance input must be bounded plain JSON.'); }
}
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

const ownerDecisionKey = value => JSON.stringify([value.ruleId, value.oldPath, value.newPath, value.side]);
const canonicalSort = values => values.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
function compileOwnerExpectations(input, changes, ruleSource) {
  keys(input, ['candidatePaths', 'decisions']);
  check(ruleSource === 'pinned', 'Owner expectations require pinned rule mode.');
  check(Array.isArray(input.candidatePaths) && input.candidatePaths.length > 0 && input.candidatePaths.length <= 32 && new Set(input.candidatePaths).size === input.candidatePaths.length, 'Expected 1..32 unique owner candidate paths.');
  for (const candidate of input.candidatePaths) {
    path(candidate);
    check(typeof candidate === 'string' && candidate.endsWith('.ts') && !candidate.endsWith('.d.ts') && !/[\\\r\n]/u.test(candidate), 'Expected regular relative TypeScript candidate paths.');
  }
  const candidatePaths = [...input.candidatePaths].sort(compare), byPath = new Map(changes.map(change => [pair(change), change]));
  check(Array.isArray(input.decisions) && input.decisions.length <= 10000, 'At most 10000 expected owner decisions.');
  const seen = new Set();
  const decisions = input.decisions.map(decision => {
    keys(decision, ['ruleId', 'oldPath', 'newPath', 'side', 'status', 'reason', 'owners']);
    check(/^[a-z][a-z0-9-]*$/u.test(text(decision.ruleId, 80)), 'Invalid owner decision rule ID.');
    path(decision.oldPath); path(decision.newPath);
    check(['old', 'new', null].includes(decision.side), 'Invalid expected owner side.');
    const change = byPath.get(pair(decision));
    check(decision.side === null ? decision.oldPath === null && decision.newPath === null && !changes.some(item => item.selectedRuleIds.includes(decision.ruleId)) : !!change && change[`${decision.side}Path`] !== null && change.selectedRuleIds.includes(decision.ruleId), 'Owner decision must refer to a selected changed path side, or an unselected rule.');
    check(!seen.has(ownerDecisionKey(decision)), 'Duplicate expected owner decision.'); seen.add(ownerDecisionKey(decision));
    check(['included', 'omitted'].includes(decision.status), 'Invalid expected owner status.'); text(decision.reason, 128);
    check(Array.isArray(decision.owners) && decision.owners.length <= 64 && (decision.status === 'included' ? decision.owners.length > 0 : decision.owners.length === 0), 'Expected owner list disagrees with status.');
    check(decision.side !== null || decision.status === 'omitted' && decision.reason === 'rule-not-selected', 'Unselected rule requires rule-not-selected omission.');
    const owners = decision.owners.map(owner => {
      keys(owner, ['path', 'name', 'start', 'end']);
      check(candidatePaths.includes(owner.path), 'Expected owner must be within configured candidate paths.'); text(owner.name, 128);
      for (const point of [owner.start, owner.end]) {
        keys(point, ['line', 'column']);
        check(['line', 'column'].every(field => Number.isSafeInteger(point[field]) && point[field] > 0 && point[field] <= 0x7fffffff), 'Invalid expected owner range.');
      }
      check(owner.end.line > owner.start.line || owner.end.line === owner.start.line && owner.end.column > owner.start.column, 'Expected owner range must be nonempty and ordered.');
      return { path: owner.path, name: owner.name, start: { line: owner.start.line, column: owner.start.column }, end: { line: owner.end.line, column: owner.end.column } };
    });
    check(new Set(owners.map(owner => JSON.stringify(owner))).size === owners.length, 'Duplicate expected owner.');
    return { ruleId: decision.ruleId, oldPath: decision.oldPath, newPath: decision.newPath, side: decision.side, status: decision.status, reason: decision.reason, owners: canonicalSort(owners) };
  });
  return { candidatePaths, decisions: canonicalSort(decisions) };
}

function auditOwners(bundle, expected) {
  const context = bundle.angularTemplateOwnerContext;
  const byId = new Map(bundle.changes.map(change => [change.id, change]));
  const actual = (context?.decisions ?? []).map(decision => {
    const change = byId.get(decision.changeId);
    return { ruleId: decision.ruleId, oldPath: change?.oldPath ?? null, newPath: change?.newPath ?? null, side: decision.side,
      status: decision.status, reason: decision.reason, owners: canonicalSort(decision.owners.map(owner => ({ path: owner.component.origin.path, name: owner.component.name, start: owner.component.origin.start, end: owner.component.origin.end }))) };
  });
  const byKey = new Map(actual.map(decision => [ownerDecisionKey(decision), decision]));
  const expectedKeys = new Set(expected.decisions.map(ownerDecisionKey));
  const candidatePaths = context?.policy.candidatePaths ?? null;
  const candidatePathsPassed = JSON.stringify(candidatePaths) === JSON.stringify(expected.candidatePaths);
  const results = expected.decisions.map(decision => {
    const found = byKey.get(ownerDecisionKey(decision)) ?? null;
    const expectedOwners = new Set(decision.owners.map(owner => JSON.stringify(owner))), actualOwners = new Set((found?.owners ?? []).map(owner => JSON.stringify(owner)));
    return { expected: decision, actual: found, passed: found !== null && JSON.stringify(decision) === JSON.stringify(found),
      missedOwners: decision.owners.filter(owner => !actualOwners.has(JSON.stringify(owner))),
      unexpectedOwners: (found?.owners ?? []).filter(owner => !expectedOwners.has(JSON.stringify(owner))) };
  });
  const unexpectedDecisions = canonicalSort(actual.filter(decision => !expectedKeys.has(ownerDecisionKey(decision))));
  return { passed: !!context && candidatePathsPassed && unexpectedDecisions.length === 0 && results.every(result => result.passed),
    contextAvailable: !!context, expectedCandidatePaths: expected.candidatePaths, candidatePaths, candidatePathsPassed, results, unexpectedDecisions };
}

/** Freeze supplied expectations without reading a bundle or deriving labels from it. */
export function compileAcceptanceExpectations(input, options = {}) {
  check(object(options) && Object.keys(options).every(key => key === 'maxExpectationsBytes'), 'Unknown expectation options.');
  const limit = bytes(options.maxExpectationsBytes ?? 1024 * 1024); const data = copy(input, limit);
  const compiledId = data?.id; if (compiledId !== undefined) delete data.id;
  const ownerVersion = data.schemaVersion === 'review-acceptance-expectations/v2';
  keys(data, ['schemaVersion', 'caseId', 'cohort', 'provenance', 'revisions', 'ruleConfigId', 'ruleSource', 'changes', ...(ownerVersion ? ['angularOwners'] : [])]);
  check(ownerVersion || data.schemaVersion === 'review-acceptance-expectations/v1', 'Expected review-acceptance-expectations/v1 or v2.');
  check(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(text(data.caseId, 128)), 'Invalid case identifier.');
  check(['development', 'held-out'].includes(data.cohort), 'Invalid declared cohort.');
  keys(data.provenance, ['kind', 'author', 'revision']);
  check(['synthetic', 'approved-mr'].includes(data.provenance.kind), 'Expected synthetic or approved-mr provenance.');
  const provenance = { kind: data.provenance.kind, author: text(data.provenance.author, 128), revision: text(data.provenance.revision, 128) };
  keys(data.revisions, ['requestedBaseCommit', 'effectiveBaseCommit', 'headCommit', 'comparison']);
  check(['requestedBaseCommit', 'effectiveBaseCommit', 'headCommit'].every(key => oid(data.revisions[key])) && ['direct', 'merge-base'].includes(data.revisions.comparison), 'Expectations require pinned commits and comparison.');
  check(data.revisions.comparison !== 'direct' || data.revisions.requestedBaseCommit === data.revisions.effectiveBaseCommit, 'Direct comparison requires equal requested/effective base.');
  check(data.ruleConfigId === null || (typeof data.ruleConfigId === 'string' && /^rules:[a-f0-9]{64}$/u.test(data.ruleConfigId)), 'Invalid expected rule config ID.');
  check(['patch', 'pinned'].includes(data.ruleSource) && (data.ruleSource !== 'pinned' || data.ruleConfigId !== null), 'Invalid expected rule source.');
  check(Array.isArray(data.changes) && data.changes.length <= 10000, 'At most 10000 expected changes.');
  const seen = new Set();
  const changes = data.changes.map(change => {
    keys(change, ['status', 'oldPath', 'newPath', 'oldKind', 'newKind', 'coverage', 'addedLines', 'removedLines', 'selectedRuleIds', 'requiredPatchLines', 'sourceCoverage']);
    path(change.oldPath); path(change.newPath); check(change.oldPath !== null || change.newPath !== null, 'An expected change needs a path.');
    check(!seen.has(pair(change)), 'Duplicate expected path pair.'); seen.add(pair(change));
    check(['A', 'M', 'D', 'R', 'T'].includes(change.status), 'Invalid expected change status.');
    for (const side of ['old', 'new']) check(change[`${side}Path`] === null ? change[`${side}Kind`] === null : ['file', 'symlink', 'gitlink'].includes(change[`${side}Kind`]), 'Expected path/kind disagreement.');
    check(['text-diff', 'metadata-only', 'binary-omitted', 'special-entry'].includes(change.coverage), 'Invalid expected coverage.');
    for (const field of ['addedLines', 'removedLines']) check(['binary-omitted', 'special-entry'].includes(change.coverage) ? change[field] === null : Number.isSafeInteger(change[field]) && change[field] >= 0 && change[field] <= 0x7fffffff, 'Unavailable text counts must be null; available counts must be bounded integers.');
    check(Array.isArray(change.selectedRuleIds) && change.selectedRuleIds.length <= 250 && new Set(change.selectedRuleIds).size === change.selectedRuleIds.length, 'Duplicate or oversized expected rules.');
    for (const id of change.selectedRuleIds) check(/^[a-z][a-z0-9-]*$/u.test(text(id, 80)), 'Invalid expected rule ID.');
    check(data.ruleConfigId !== null || change.selectedRuleIds.length === 0, 'Expected rules require a rule config ID.');
    check(Array.isArray(change.requiredPatchLines) && change.requiredPatchLines.length <= 1000 && new Set(change.requiredPatchLines).size === change.requiredPatchLines.length, 'Duplicate or oversized required patch lines.');
    for (const line of change.requiredPatchLines) check(typeof line === 'string' && line.length > 0 && line.length <= 16384 && !line.includes('\n') && !line.includes('\0'), 'Required patch lines must be exact individual lines.');
    let sourceCoverage = null;
    if (change.sourceCoverage !== null) {
      keys(change.sourceCoverage, ['available', 'reason']);
      check(data.ruleSource === 'pinned' && typeof change.sourceCoverage.available === 'boolean', 'Source coverage requires pinned mode.');
      sourceCoverage = { available: change.sourceCoverage.available, reason: text(change.sourceCoverage.reason, 128) };
    }
    return { status: change.status, oldPath: change.oldPath, newPath: change.newPath, oldKind: change.oldKind, newKind: change.newKind,
      coverage: change.coverage, addedLines: change.addedLines, removedLines: change.removedLines,
      selectedRuleIds: [...change.selectedRuleIds].sort(compare), requiredPatchLines: [...change.requiredPatchLines].sort(compare), sourceCoverage };
  }).sort((a, b) => compare(pair(a), pair(b)));
  const r = data.revisions;
  const payload = { schemaVersion: data.schemaVersion, caseId: data.caseId, cohort: data.cohort, provenance,
    revisions: { requestedBaseCommit: r.requestedBaseCommit, effectiveBaseCommit: r.effectiveBaseCommit, headCommit: r.headCommit, comparison: r.comparison },
    ruleConfigId: data.ruleConfigId, ruleSource: data.ruleSource, changes,
    ...(ownerVersion ? { angularOwners: compileOwnerExpectations(data.angularOwners, changes, data.ruleSource) } : {}) };
  const result = { id: `expectations:${hash(payload)}`, ...payload };
  check(compiledId === undefined || compiledId === result.id, 'Invalid compiled expectation ID.');
  check(Buffer.byteLength(JSON.stringify(result)) <= limit, 'Compiled expectations exceed byte budget.', 'ACCEPTANCE_LIMIT');
  return freeze(result);
}

/** Audit imported ordinary bundles; no Git, provider or reviewer execution. */
export function auditReviewBundle(inputBundle, inputExpectations, options = {}) {
  check(object(options) && Object.keys(options).every(key => ['maxBundleBytes', 'maxExpectationsBytes', 'maxReportBytes'].includes(key)), 'Unknown acceptance options.');
  const reportLimit = bytes(options.maxReportBytes ?? 16 * 1024 * 1024);
  const expectations = compileAcceptanceExpectations(inputExpectations, { maxExpectationsBytes: options.maxExpectationsBytes });
  const bundle = copy(inputBundle, bytes(options.maxBundleBytes ?? 16 * 1024 * 1024));
  // Reuse the packet boundary to recompute facts, rule selection and source integrity.
  try { createReviewerRequest(bundle, { id: 'offline-acceptance', version: '1' }, { maxRequestBytes: MAX_BYTES }); }
  catch (error) { throw new AcceptanceError(error.code === 'REVIEW_LIMIT' ? 'ACCEPTANCE_LIMIT' : 'INVALID_ACCEPTANCE_BUNDLE', 'Acceptance requires a valid ordinary review bundle.'); }
  const mismatches = [];
  for (const field of Object.keys(expectations.revisions)) if (bundle.provenance.revisions[field] !== expectations.revisions[field]) mismatches.push({ field, expected: expectations.revisions[field], actual: bundle.provenance.revisions[field] });
  const configId = bundle.ruleSelection?.configId ?? null; const ruleSource = ['review-bundle/v4', 'review-bundle/v5', 'review-bundle/v6', 'review-bundle/v7'].includes(bundle.schemaVersion) ? 'pinned' : 'patch';
  for (const [field, actual] of [['ruleConfigId', configId], ['ruleSource', ruleSource]]) if (expectations[field] !== actual) mismatches.push({ field, expected: expectations[field], actual });
  const byPath = new Map(bundle.changes.map(change => [pair(change), change]));
  const textFacts = new Map(bundle.facts.filter(fact => fact.type === 'text-change').map(fact => [fact.changeId, fact.value]));
  const evidence = new Map(bundle.evidence.map(item => [item.id, item]));
  const selections = new Map();
  for (const decision of bundle.ruleSelection?.decisions ?? []) for (const match of decision.matches) {
    if (!selections.has(match.changeId)) selections.set(match.changeId, new Set()); selections.get(match.changeId).add(decision.ruleId);
  }
  const coverage = new Map((bundle.ruleSelection?.sourceCoverage ?? []).map(item => [item.changeId, { available: item.available, reason: item.reason }]));
  const results = expectations.changes.map(expected => {
    const change = byPath.get(pair(expected)); const differences = [];
    const selectedRuleIds = [...(selections.get(change?.id) ?? [])].sort(compare);
    const falseSelections = selectedRuleIds.filter(id => !expected.selectedRuleIds.includes(id));
    const missedRules = expected.selectedRuleIds.filter(id => !selectedRuleIds.includes(id));
    const sourceCoverage = coverage.get(change?.id) ?? null;
    if (change) {
      const fact = textFacts.get(change.id);
      const actual = { ...change, addedLines: fact?.addedLines ?? null, removedLines: fact?.removedLines ?? null };
      for (const field of ['status', 'oldKind', 'newKind', 'coverage', 'addedLines', 'removedLines']) if (expected[field] !== actual[field]) differences.push({ field, expected: expected[field], actual: actual[field] });
    }
    const patchLines = new Set((change?.evidenceIds ?? []).flatMap(id => evidence.get(id).content.split('\n')));
    const missingPatchLines = expected.requiredPatchLines.filter(line => !patchLines.has(line));
    const sourceCoveragePassed = JSON.stringify(expected.sourceCoverage) === JSON.stringify(sourceCoverage);
    return { oldPath: expected.oldPath, newPath: expected.newPath, changeId: change?.id ?? null,
      factsPassed: !!change && differences.length === 0 && missingPatchLines.length === 0,
      ruleSelectionPassed: !!change && falseSelections.length === 0 && missedRules.length === 0 && sourceCoveragePassed,
      differences, missingPatchLines, expectedRuleIds: expected.selectedRuleIds, selectedRuleIds, falseSelections, missedRules,
      expectedSourceCoverage: expected.sourceCoverage, sourceCoverage, sourceCoveragePassed };
  });
  const expectedPaths = new Set(expectations.changes.map(pair));
  const unexpectedChanges = bundle.changes.filter(change => !expectedPaths.has(pair(change))).map(change => ({ changeId: change.id, oldPath: change.oldPath, newPath: change.newPath })).sort((a, b) => compare(pair(a), pair(b)));
  const revisionsPassed = !mismatches.some(item => Object.hasOwn(expectations.revisions, item.field));
  const rulePolicyPassed = !mismatches.some(item => ['ruleConfigId', 'ruleSource'].includes(item.field));
  const identityPassed = revisionsPassed && rulePolicyPassed;
  const factsPassed = revisionsPassed && unexpectedChanges.length === 0 && results.every(result => result.factsPassed);
  const ruleSelectionPassed = identityPassed && unexpectedChanges.length === 0 && results.every(result => result.ruleSelectionPassed);
  const ownerAudit = expectations.angularOwners ? auditOwners(bundle, expectations.angularOwners) : null;
  const angularOwnersPassed = ownerAudit ? identityPassed && unexpectedChanges.length === 0 && ownerAudit.passed : null;
  const payload = { schemaVersion: ownerAudit ? 'review-acceptance-report/v2' : 'review-acceptance-report/v1', caseId: expectations.caseId, expectationsId: expectations.id, bundleId: bundle.id,
    declaredProvenance: expectations.provenance, declaredCohort: expectations.cohort, provenanceVerification: 'not-verified',
    identityPassed, revisionsPassed, rulePolicyPassed, mismatches, factsPassed, ruleSelectionPassed, passed: factsPassed && ruleSelectionPassed && angularOwnersPassed !== false, results, unexpectedChanges,
    ...(ownerAudit ? { angularOwnersPassed, angularOwners: ownerAudit } : {}),
    reviewerImprovement: 'not-measured', limitations: ['Expectations and cohort/approval/author declarations are supplied by the caller; independence and pre-run freezing are not verified.',
      'Bundle validation checks internal evidence consistency, not repository/commit/MR authenticity.',
      'Passing rule relevance is agreement with supplied policy, not defect proof, framework/runtime correctness or reviewer-quality improvement.'] };
  const result = { id: `acceptance:${hash(payload)}`, ...payload };
  check(Buffer.byteLength(JSON.stringify(result)) <= reportLimit, 'Acceptance report exceeds byte budget.', 'ACCEPTANCE_LIMIT');
  return freeze(result);
}

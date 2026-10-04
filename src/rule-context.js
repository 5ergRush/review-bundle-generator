import { createHash } from 'node:crypto';
import { createReviewBundle } from './bundle.js';
import { parseRulesYaml } from './rules.js';
import { boundedJson } from './reviewer.js';

export class RuleContextError extends Error {
  constructor(code, message) { super(message); this.name = 'RuleContextError'; this.code = code; }
}
const fail = message => { throw new RuleContextError('INVALID_CONTEXT_POLICY', message); };
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function clone(value, bytes, code) {
  try { return boundedJson(value, bytes, code); }
  catch (error) { throw new RuleContextError(error.code === 'REVIEW_LIMIT' ? 'CONTEXT_LIMIT' : code, error.message); }
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

// Policy is supplied by the operator; it is never discovered in the source checkout.
export async function createRuleContextBundle(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail('An options object is required.');
  const { contextPolicy, maxTargets = 50, maxEnvelopeBytes = 16 * 1024 * 1024, ...config } = options;
  if (Object.hasOwn(config, 'semantic') || Object.hasOwn(config, 'contextRequests')) fail('Semantic analysis and requests are controlled by this operation.');
  if (!Number.isSafeInteger(maxTargets) || maxTargets < 1 || maxTargets > 50) fail('maxTargets must be between 1 and 50.');
  if (!Number.isSafeInteger(maxEnvelopeBytes) || maxEnvelopeBytes < 1 || maxEnvelopeBytes > 64 * 1024 * 1024) fail('Invalid maxEnvelopeBytes (maximum 64 MiB).');
  const policy = clone(contextPolicy, 256 * 1024, 'INVALID_CONTEXT_POLICY');
  if (!Array.isArray(policy) || policy.length > 50) fail('contextPolicy must be an array of at most 50 rules.');
  const rules = parseRulesYaml(config.rulesYaml);
  const seen = new Set();
  for (const item of policy) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'kind,ruleId,sides' ||
      item.kind !== 'direct-callers' || !rules.rules.some(rule => rule.id === item.ruleId) || seen.has(item.ruleId) ||
      !Array.isArray(item.sides) || !item.sides.length || item.sides.length > 2 ||
      item.sides.some(side => !['old', 'new'].includes(side)) || new Set(item.sides).size !== item.sides.length) fail('Expected unique known ruleId, direct-callers kind, and unique old/new sides.');
    item.sides.sort(compare); seen.add(item.ruleId);
  }
  policy.sort((a, b) => compare(a.ruleId, b.ruleId));
  const initial = await createReviewBundle({ ...config, semantic: true });
  const analysis = initial.semanticAnalysis;
  const declarations = new Map(analysis.declarations.map(item => [item.id, item]));
  const callable = analysis.declarations.filter(item => ['FunctionDeclaration', 'MethodDeclaration'].includes(item.kind));
  const decisions = []; const proposed = new Set(); let operations = 0;
  const tick = () => { if (++operations > 5_000_000) throw new RuleContextError('CONTEXT_LIMIT', 'Context planning exceeds 5000000 operations.'); };
  for (const item of policy) {
    const selection = initial.ruleSelection.decisions.find(decision => decision.ruleId === item.ruleId);
    const decision = { ruleId: item.ruleId, selectionStatus: selection.status, selectionReason: selection.reason, targets: [], omissions: [] };
    decisions.push(decision);
    if (selection.status !== 'matched') { decision.omissions.push({ reason: 'rule-not-selected' }); continue; }
    const observations = new Map();
    for (const match of selection.matches) for (const observation of (match.syntaxMatches ?? []).flat()) {
      tick(); const anchor = { changeId: match.changeId, evidenceId: observation.evidenceId, side: observation.side === 'removed' ? 'old' : 'new', startLine: observation.startLine, endLine: observation.endLine, within: observation.within ?? null, withinLine: observation.withinLine ?? null };
      observations.set(JSON.stringify(anchor), anchor);
    }
    if (!observations.size) { decision.omissions.push({ reason: 'syntax-anchor-required' }); continue; }
    for (const anchor of [...observations.values()].sort((a, b) => { tick(); return compare(JSON.stringify(a), JSON.stringify(b)); })) {
      if (decision.targets.length + decision.omissions.length >= 10000) throw new RuleContextError('CONTEXT_LIMIT', 'More than 10000 planning records per rule.');
      if (anchor.within === null || anchor.withinLine === null) { decision.omissions.push({ anchor, reason: 'named-scope-unavailable' }); continue; }
      const candidates = callable.filter(declaration => {
        tick(); return declaration.name === anchor.within && declaration.side === anchor.side && declaration.changeId === anchor.changeId && declaration.origin.start.line <= Math.min(anchor.withinLine, anchor.startLine) && declaration.origin.end.line >= Math.max(anchor.withinLine, anchor.endLine);
      }).sort((a, b) => { tick(); return (a.origin.end.line - a.origin.start.line) - (b.origin.end.line - b.origin.start.line) || compare(a.id, b.id); });
      const target = candidates[0];
      const malformed = target && analysis.revisions.find(revision => revision.side === anchor.side).parseDiagnostics.some(diagnostic => { tick(); return diagnostic.path === target.origin.path; });
      if (!target || malformed || (candidates[1] && candidates[1].origin.end.line - candidates[1].origin.start.line === target.origin.end.line - target.origin.start.line)) {
        decision.omissions.push({ anchor, reason: malformed ? 'parse-unavailable' : target ? 'ambiguous-anchor' : 'callable-anchor-unavailable' }); continue;
      }
      for (const side of item.sides) {
        tick(); let selected = target; let basis = 'matched-syntax-enclosing-callable';
        if (side !== target.side) {
          const links = analysis.counterparts.filter(link => { tick(); return target.side === 'old' ? link.oldTargetId === target.id : link.newTargetId === target.id; });
          const link = links.length === 1 ? links[0] : null;
          selected = link && declarations.get(target.side === 'old' ? link.newTargetId : link.oldTargetId);
          basis = 'structural-counterpart';
          if (!selected) { decision.omissions.push({ anchor, anchorTargetId: target.id, side, reason: link?.status ?? 'counterpart-unavailable' }); continue; }
        }
        proposed.add(selected.id);
        decision.targets.push({ targetId: selected.id, side, commit: selected.origin.commit, anchor, anchorTargetId: target.id, basis });
      }
    }
  }
  if (decisions.some(decision => decision.targets.length + decision.omissions.length > 10000)) throw new RuleContextError('CONTEXT_LIMIT', 'More than 10000 planning records per rule.');
  const targetIds = [...proposed].sort(compare); const included = new Set(targetIds.slice(0, maxTargets));
  for (const decision of decisions) for (const target of decision.targets) {
    target.status = included.has(target.targetId) ? 'requested' : 'omitted';
    target.reason = included.has(target.targetId) ? 'selected-rule-policy' : 'target-limit';
  }
  const requests = [...included].map(targetId => ({ kind: 'direct-callers', targetId }));
  const revisions = initial.provenance.revisions;
  // Resolve caller-provided moving refs only once; expansion uses the same commits.
  const bundle = requests.length ? await createReviewBundle({ ...config, base: revisions.requestedBaseCommit, head: revisions.headCommit, comparison: revisions.comparison, semantic: true, contextRequests: requests }) : initial;
  const payload = { schemaVersion: 'rule-context-bundle/v1', bundle, contextPlan: {
    schemaVersion: 'rule-context-plan/v1', rulesConfigId: initial.ruleSelection.configId,
    policy, limits: { maxTargets, maxOperations: 5_000_000, maxRecordsPerRule: 10000 }, decisions, requests,
    omittedTargetIds: targetIds.filter(id => !included.has(id)),
  }, limitations: ['Only v3 matched syntax with a known nearest named function or method requests callers; older rules, path-only rules and anonymous scopes omit context.', 'Counterparts are structural associations, not semantic equivalence. Indirect calls, framework relationships and runtime dispatch remain unsupported.', 'Target and snippet limits may omit context; zero static callers does not prove absence. Reviewer improvement is not measured.'] };
  const result = { id: `rule-context-bundle:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`, ...payload };
  return freeze(clone(result, maxEnvelopeBytes, 'INVALID_CONTEXT_BUNDLE'));
}

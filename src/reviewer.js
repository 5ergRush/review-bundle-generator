import { createHash } from 'node:crypto';
import { compileReviewBundle } from './bundle.js';
import { parseRulesYaml, selectRules } from './rules.js';
import ts from 'typescript';
import { validateRuleSources } from './source-rules.js';
import { compileAngularTemplateContext } from './angular-context.js';
import { compileAngularTemplateBindings } from './angular-bindings.js';
import { compileAngularTemplateOwners } from './angular-owners.js';

const MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_BYTES = 16 * 1024 * 1024;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const oid = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 0x7fffffff;
const path = value => typeof value === 'string' && value.length > 0 && !value.includes('\0') &&
  !value.startsWith('/') && !value.split('/').some(part => !part || part === '..' || part === '.');

export class ReviewerError extends Error {
  constructor(code, message) { super(message); this.name = 'ReviewerError'; this.code = code; }
}
function requireCondition(condition, code, message) {
  if (!condition) throw new ReviewerError(code, message);
}
function keys(value, expected, code) {
  requireCondition(object(value) && Object.keys(value).sort().join(',') === [...expected].sort().join(','), code, 'Unexpected or missing contract fields.');
}
function limit(value, name, ceiling = MAX_BYTES) {
  requireCondition(Number.isSafeInteger(value) && value > 0 && value <= ceiling, 'INVALID_INPUT', `${name} must be an integer from 1 to ${ceiling}.`);
  return value;
}
// Shared internally with offline evaluation; not part of the package exports.
export function boundedJson(value, maxBytes, code) {
  // Check plain JSON before serialization: no getters, toJSON hooks, cycles or lossy values.
  const stack = [{ value, depth: 0 }]; const active = new Set(); let nodes = 0; let stringBytes = 0;
  while (stack.length) {
    const item = stack.pop(); const current = item.value;
    if (item.exit) { active.delete(current); continue; }
    requireCondition(++nodes <= 500_000 && item.depth <= 64, code, 'JSON structure exceeds node/depth limits.');
    if (typeof current === 'string') {
      stringBytes += Buffer.byteLength(current);
      requireCondition(stringBytes <= maxBytes, 'REVIEW_LIMIT', `Input strings exceed byte budget (${maxBytes}).`); continue;
    }
    if (current === null || typeof current === 'boolean') continue;
    if (typeof current === 'number') { requireCondition(Number.isFinite(current), code, 'JSON numbers must be finite.'); continue; }
    requireCondition(typeof current === 'object' && (Array.isArray(current) || Object.getPrototypeOf(current) === Object.prototype || Object.getPrototypeOf(current) === null), code, 'Expected plain JSON data.');
    requireCondition(!active.has(current), code, 'JSON cycles are unsupported.'); active.add(current);
    stack.push({ value: current, exit: true });
    const descriptors = Object.getOwnPropertyDescriptors(current);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (Array.isArray(current) && key === 'length') continue;
      const descriptor = descriptors[key];
      requireCondition(typeof key === 'string' && descriptor.enumerable && Object.hasOwn(descriptor, 'value') &&
        (!Array.isArray(current) || /^(?:0|[1-9]\d*)$/u.test(key)), code, 'Expected JSON data properties.');
      stack.push({ value: descriptor.value, depth: item.depth + 1 });
    }
    if (Array.isArray(current)) requireCondition(Object.keys(current).length === current.length, code, 'Sparse arrays are unsupported.');
  }
  const serialized = JSON.stringify(value);
  requireCondition(Buffer.byteLength(serialized) <= maxBytes, 'REVIEW_LIMIT', `Serialized input exceeds byte budget (${maxBytes}).`);
  return JSON.parse(serialized);
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function string(value, name, max, code) {
  requireCondition(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0'), code, `${name} must be nonempty text of at most ${max} characters.`);
  return value;
}
function reviewer(value, code) {
  keys(value, ['id', 'version'], code);
  requireCondition(typeof value.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/u.test(value.id), code, 'Invalid reviewer ID.');
  const version = string(value.version, 'reviewer.version', 128, code);
  requireCondition(!/[\x00-\x1f\x7f]/u.test(version), code, 'Reviewer version cannot contain control characters.');
  return { id: value.id, version };
}
function contentId(record, prefix, code) {
  requireCondition(object(record), code, `Expected a ${prefix} record.`);
  const { id, ...payload } = record;
  requireCondition(id === `${prefix}:${hash(payload)}`, code, `Invalid ${prefix} content ID.`);
}

function sourceOrigin(origin, commits, code) {
  keys(origin, ['commit', 'path', 'object', 'start', 'end'], code);
  keys(origin.start, ['line', 'column'], code); keys(origin.end, ['line', 'column'], code);
  requireCondition(commits.includes(origin.commit) && path(origin.path) && oid(origin.object) &&
    positive(origin.start.line) && positive(origin.start.column) && positive(origin.end.line) && positive(origin.end.column) &&
    (origin.end.line > origin.start.line || (origin.end.line === origin.start.line && origin.end.column > origin.start.column)), code, 'Invalid source origin.');
}

function validateBundle(bundle) {
  const code = 'INVALID_REVIEW_BUNDLE';
  requireCondition(object(bundle) && ['review-bundle/v1', 'review-bundle/v2', 'review-bundle/v3', 'review-bundle/v4', 'review-bundle/v5', 'review-bundle/v6', 'review-bundle/v7'].includes(bundle.schemaVersion), code, 'Expected review-bundle/v1 through v7.');
  const angularOwners = bundle.schemaVersion === 'review-bundle/v7';
  const angularBindings = bundle.schemaVersion === 'review-bundle/v6' || (angularOwners && bundle.angularTemplateBindings !== undefined);
  const angularTemplates = ['review-bundle/v5', 'review-bundle/v6', 'review-bundle/v7'].includes(bundle.schemaVersion);
  const pinnedRules = ['review-bundle/v4', 'review-bundle/v5', 'review-bundle/v6', 'review-bundle/v7'].includes(bundle.schemaVersion);
  const semantic = bundle.schemaVersion === 'review-bundle/v3' || (pinnedRules && bundle.semanticAnalysis !== undefined);
  requireCondition(pinnedRules ? ['rule-selection/v4', 'rule-selection/v5'].includes(bundle.ruleSelection?.schemaVersion) : !['rule-selection/v4', 'rule-selection/v5'].includes(bundle.ruleSelection?.schemaVersion), code, 'Pinned rules require bundle v4/v5/v6 and selection v4/v5.');
  keys(bundle, ['id', 'schemaVersion', 'provenance', 'summary', 'changes', 'evidence', 'facts', 'coverage',
    ...(bundle.ruleSelection !== undefined ? ['ruleSelection'] : []),
    ...(semantic ? ['semanticAnalysis', 'contextExpansion'] : []), ...(angularTemplates ? ['angularTemplateContext'] : []), ...(angularBindings ? ['angularTemplateBindings'] : []), ...(angularOwners ? ['angularTemplateOwnerContext'] : [])], code);
  contentId(bundle, 'bundle', code);
  requireCondition(Array.isArray(bundle.changes) && Array.isArray(bundle.evidence) && Array.isArray(bundle.facts) && object(bundle.provenance), code, 'Missing bundle records.');
  const patches = bundle.evidence.filter(item => item?.type === 'git-patch');
  let baseline;
  try {
    baseline = compileReviewBundle({ schemaVersion: bundle.provenance.ingestionSchemaVersion,
      tool: bundle.provenance.tool, revisions: bundle.provenance.revisions, policy: bundle.provenance.policy,
      changes: bundle.changes.map(({ id, evidenceIds, coverage, ...change }) => change),
      patch: patches.map(item => item.content).join(''), limitations: [] }, { maxBundleBytes: MAX_BYTES });
  } catch { throw new ReviewerError(code, 'Bundle Git evidence could not be recompiled.'); }
  for (const [actual, expected] of [[bundle.changes, baseline.changes], [patches, baseline.evidence],
    [bundle.facts, baseline.facts], [bundle.summary, baseline.summary], [bundle.provenance, baseline.provenance]]) {
    requireCondition(JSON.stringify(actual) === JSON.stringify(expected), code, 'Bundle Git facts, evidence or provenance are inconsistent.');
  }
  requireCondition(object(bundle.coverage) && bundle.coverage.status === 'partial' && object(bundle.coverage.stages) && Array.isArray(bundle.coverage.limitations), code, 'Missing partial coverage contract.');
  keys(bundle.coverage, ['status', 'stages', 'limitations'], code);
  keys(bundle.coverage.stages, ['gitDiff', 'deterministicFacts', 'semanticAnalysis', 'ruleSelection', 'contextExpansion', ...(angularTemplates ? ['angularTemplates'] : []), ...(angularBindings ? ['angularBindings'] : []), ...(angularOwners ? ['angularOwners'] : [])], code);
  requireCondition(!angularOwners || bundle.coverage.stages.angularOwners === 'partial', code, 'Angular owner coverage must be partial.');
  requireCondition(!angularBindings || bundle.coverage.stages.angularBindings === 'partial', code, 'Angular binding coverage must be partial.');
  requireCondition(!angularTemplates || bundle.coverage.stages.angularTemplates === 'partial', code, 'Angular template coverage must be partial.');
  requireCondition(bundle.coverage.stages.gitDiff === 'complete' && bundle.coverage.stages.deterministicFacts === 'complete' &&
    bundle.coverage.stages.ruleSelection === (bundle.ruleSelection ? 'complete' : 'not-run') &&
    bundle.coverage.stages.semanticAnalysis === (semantic ? 'partial' : 'not-run') &&
    bundle.coverage.limitations.every(item => typeof item === 'string'), code, 'Invalid bundle stage coverage.');
  const selectedRules = [];
  const ruleSources = bundle.evidence.filter(item => item?.type === 'typescript-rule-source');
  if (pinnedRules) {
    try { validateRuleSources(ruleSources, bundle.changes, bundle.provenance.revisions); }
    catch { throw new ReviewerError(code, 'Invalid pinned rule source evidence.'); }
  } else requireCondition(ruleSources.length === 0, code, 'Rule source evidence requires bundle v4/v5/v6.');
  if (bundle.ruleSelection !== undefined) {
    try {
      const rules = bundle.ruleSelection.rules.map(rule => ({ ...rule,
        scope: Object.fromEntries(Object.entries(rule.scope).filter(([, value]) => value !== null)),
        when: Object.fromEntries(Object.entries(rule.when).filter(([, value]) => value !== null)) }));
      const config = parseRulesYaml(JSON.stringify({ schemaVersion: bundle.ruleSelection.schemaVersion === 'rule-selection/v5' ? 'review-rules/v4' : ['rule-selection/v3', 'rule-selection/v4'].includes(bundle.ruleSelection.schemaVersion) ? 'review-rules/v3' : bundle.ruleSelection.schemaVersion === 'rule-selection/v2' ? 'review-rules/v2' : 'review-rules/v1', rules }));
      const expected = selectRules(config, baseline.changes, baseline.facts, [...baseline.evidence, ...ruleSources], pinnedRules ? 'pinned' : 'patch');
      requireCondition(JSON.stringify(bundle.ruleSelection) === JSON.stringify(expected), code, 'Invalid rule selection.');
      for (const decision of expected.decisions.filter(item => item.status === 'matched')) {
        const rule = config.rules.find(item => item.id === decision.ruleId);
        selectedRules.push({ ...rule, matches: decision.matches });
      }
    } catch { throw new ReviewerError(code, 'Bundle rule configuration or selection is inconsistent.'); }
  }
  requireCondition((bundle.schemaVersion !== 'review-bundle/v1' || !bundle.ruleSelection) &&
    (bundle.schemaVersion !== 'review-bundle/v2' || bundle.ruleSelection), code, 'Bundle version and rule selection disagree.');
  const evidenceById = new Map();
  const templateSources = bundle.evidence.filter(item => item?.type === 'angular-template-source');
  if (angularTemplates) {
    try { requireCondition(JSON.stringify(bundle.angularTemplateContext) === JSON.stringify(compileAngularTemplateContext(bundle, templateSources)), code, 'Invalid Angular template context.'); }
    catch { throw new ReviewerError(code, 'Angular ownership or template evidence is inconsistent.'); }
  } else requireCondition(templateSources.length === 0, code, 'Angular template sources require bundle v5/v6.');
  const ownerSources = bundle.evidence.filter(item => item?.type === 'angular-owner-source');
  const ownerTemplates = bundle.evidence.filter(item => item?.type === 'angular-owner-template-source');
  if (angularOwners) {
    try { requireCondition(JSON.stringify(bundle.angularTemplateOwnerContext) === JSON.stringify(compileAngularTemplateOwners(bundle, bundle.angularTemplateOwnerContext?.policy?.candidatePaths, ownerSources, ownerTemplates)), code, 'Invalid changed-template ownership.'); }
    catch { throw new ReviewerError(code, 'Candidate ownership sources or relationships are inconsistent.'); }
  } else requireCondition(ownerSources.length === 0 && ownerTemplates.length === 0, code, 'Ownership evidence requires bundle v7.');
  if (angularBindings) {
    try { requireCondition(JSON.stringify(bundle.angularTemplateBindings) === JSON.stringify(compileAngularTemplateBindings(bundle)), code, 'Invalid Angular template bindings.'); }
    catch { throw new ReviewerError(code, 'Angular binding relationships or coordinates are inconsistent.'); }
  }
  const commits = [bundle.provenance.revisions.effectiveBaseCommit, bundle.provenance.revisions.headCommit];
  let sourceBytes = 0; let sourceCount = 0;
  for (const evidence of bundle.evidence) {
    requireCondition(object(evidence) && !evidenceById.has(evidence.id), code, 'Duplicate or invalid evidence.');
    contentId(evidence, 'evidence', code); evidenceById.set(evidence.id, evidence);
    if (evidence.type === 'git-patch') continue;
    if (evidence.type === 'typescript-rule-source') continue;
    if (evidence.type === 'angular-template-source' || (angularOwners && ['angular-owner-source', 'angular-owner-template-source'].includes(evidence.type))) continue;
    keys(evidence, ['id', 'type', 'origin', 'content'], code);
    requireCondition(semantic && evidence.type === 'typescript-source' &&
      typeof evidence.content === 'string' && evidence.content.length > 0, code, 'Unsupported source evidence.');
    const origin = evidence.origin;
    sourceOrigin(origin, commits, code);
    const lines = evidence.content.split(/\r\n|[\r\n\u2028\u2029]/u);
    requireCondition(origin.end.line === origin.start.line + lines.length - 1 &&
      origin.end.column === (lines.length === 1 ? origin.start.column + evidence.content.length : lines.at(-1).length + 1), code, 'Source snippet content and coordinates disagree.');
    sourceBytes += Buffer.byteLength(JSON.stringify(evidence)); sourceCount++;
    requireCondition(sourceCount <= 10 && sourceBytes <= 64 * 1024 && origin.end.line - origin.start.line + 1 <= 80, code, 'Source evidence exceeds caller context budgets.');
  }
  const contextChanges = new Map();
  for (const decision of bundle.angularTemplateContext?.decisions ?? []) if (decision.template?.kind === 'external') {
    const id = decision.template.evidenceId; if (!contextChanges.has(id)) contextChanges.set(id, new Set());
    contextChanges.get(id).add(decision.anchor.changeId);
  }
  for (const decision of bundle.angularTemplateOwnerContext?.decisions ?? []) for (const owner of decision.owners) for (const id of [owner.sourceEvidenceId, owner.template.evidenceId]) {
    if (!contextChanges.has(id)) contextChanges.set(id, new Set()); contextChanges.get(id).add(decision.changeId);
  }
  if (semantic) {
    requireCondition(['typescript-analysis/v1', 'typescript-analysis/v2'].includes(bundle.semanticAnalysis?.schemaVersion) && Array.isArray(bundle.semanticAnalysis.declarations) &&
      ['caller-context/v1', 'caller-context/v2'].includes(bundle.contextExpansion?.schemaVersion) && Array.isArray(bundle.contextExpansion.decisions) &&
      bundle.contextExpansion.decisions.length <= 50, code, 'Missing or oversized semantic/context sections.');
    const declarations = new Map();
    for (const declaration of bundle.semanticAnalysis.declarations) {
      contentId(declaration, 'declaration', code);
      sourceOrigin(declaration.origin, commits, code);
      const change = bundle.changes.find(item => item.id === declaration.changeId);
      const side = declaration.side === 'old' ? 'old' : declaration.side === 'new' ? 'new' : null;
      requireCondition(change && side && declaration.origin?.path === change[`${side}Path`] && declaration.origin?.object === change[`${side}Object`] &&
        declaration.origin?.commit === bundle.provenance.revisions[side === 'old' ? 'effectiveBaseCommit' : 'headCommit'] &&
        JSON.stringify(declaration.evidenceIds) === JSON.stringify(change.evidenceIds) && !declarations.has(declaration.id), code, 'Invalid declaration provenance.');
      declarations.set(declaration.id, declaration);
    }
    const version2 = bundle.semanticAnalysis.schemaVersion === 'typescript-analysis/v2';
    for (const declaration of declarations.values()) {
      if (declaration.basis !== undefined || declaration.counterpartOf !== undefined) {
        const old = declarations.get(declaration.counterpartOf);
        requireCondition(version2 && declaration.basis === 'structural-counterpart' && declaration.side === 'new' && old?.side === 'old' &&
          old.basis === undefined && old.changeId === declaration.changeId && old.kind === declaration.kind && old.qualifiedName === declaration.qualifiedName,
        code, 'Invalid structural counterpart provenance.');
      }
    }
    if (!version2) requireCondition(bundle.semanticAnalysis.counterparts === undefined, code, 'Legacy analysis cannot contain counterpart decisions.');
    if (version2) {
      requireCondition(Array.isArray(bundle.semanticAnalysis.counterparts) && bundle.semanticAnalysis.counterparts.length === [...declarations.values()].filter(d => d.side === 'old').length,
        code, 'Missing counterpart decisions.');
      const seen = new Set(); const linked = new Set();
      for (const decision of bundle.semanticAnalysis.counterparts) {
        keys(decision, ['oldTargetId', 'status', 'newTargetId'], code);
        const old = declarations.get(decision.oldTargetId); const next = declarations.get(decision.newTargetId);
        requireCondition(old?.side === 'old' && !seen.has(old.id) && ['matched', 'already-indexed', 'missing', 'ambiguous', 'parse-unavailable', 'source-unavailable', 'unsupported-scope'].includes(decision.status), code, 'Invalid counterpart decision.');
        seen.add(old.id);
        if (['matched', 'already-indexed'].includes(decision.status)) {
          requireCondition(next?.side === 'new' && next.changeId === old.changeId && next.kind === old.kind && next.qualifiedName === old.qualifiedName &&
            (decision.status === 'matched' ? next.basis === 'structural-counterpart' && next.counterpartOf === old.id : next.basis === undefined), code, 'Invalid counterpart target.');
          requireCondition(!linked.has(next.id), code, 'Duplicate counterpart target.'); linked.add(next.id);
        } else requireCondition(decision.newTargetId === null, code, 'Unavailable counterpart must have a null target.');
      }
      for (const declaration of declarations.values()) if (declaration.basis === 'structural-counterpart') requireCondition(linked.has(declaration.id), code, 'Unreferenced structural counterpart.');
    }
    const contextV2 = bundle.contextExpansion.schemaVersion === 'caller-context/v2';
    const contextPolicy = bundle.contextExpansion.policy;
    requireCondition(contextPolicy?.maxRequests === 50 && contextPolicy.maxSnippets === 10 && contextPolicy.maxLinesPerSnippet === 80 && contextPolicy.maxBytes === 64 * 1024 &&
      (!contextV2 || contextPolicy.maxAliasDepth === 8), code, 'Unsupported caller context policy.');
    const contains = (outer, inner) => (inner.start.line > outer.start.line || (inner.start.line === outer.start.line && inner.start.column >= outer.start.column)) &&
      (inner.end.line < outer.end.line || (inner.end.line === outer.end.line && inner.end.column <= outer.end.column));
    const linkEvidence = (record, target) => {
      sourceOrigin(record.origin, commits, code);
      requireCondition(record.origin.commit === target.origin.commit, code, 'Caller evidence belongs to a different target revision.');
      if (record.evidenceId === null) { requireCondition(['snippet-line-limit', 'snippet-count-limit', 'context-byte-limit'].includes(record.omission), code, 'Unmarked context omission.'); return null; }
      const evidence = evidenceById.get(record.evidenceId);
      requireCondition(evidence?.type === 'typescript-source' && evidence.origin.commit === record.origin.commit && evidence.origin.path === record.origin.path &&
        evidence.origin.object === record.origin.object && record.omission === null && contains(evidence.origin, record.origin), code, 'Invalid caller evidence reference.');
      if (!contextChanges.has(evidence.id)) contextChanges.set(evidence.id, new Set());
      contextChanges.get(evidence.id).add(target.changeId); return evidence;
    };
    const parsedEvidence = new Map();
    const syntaxNodes = evidence => {
      if (!parsedEvidence.has(evidence.id)) {
        let file; try { file = ts.createSourceFile(evidence.origin.path, evidence.content, ts.ScriptTarget.ESNext, true); }
        catch { throw new ReviewerError(code, 'Caller provenance snippet could not be parsed.'); }
        requireCondition(!file.parseDiagnostics.length, code, 'Malformed caller provenance snippet.');
        const bindings = new Map(); const calls = new Map(); const pending = [file]; let count = 0;
        while (pending.length) {
          const node = pending.pop(); requireCondition(++count <= 25000, code, 'Caller provenance snippet exceeds AST limit.');
          if (ts.isVariableDeclaration(node)) bindings.set(JSON.stringify(nodeOrigin(evidence, file, node)), node);
          if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) calls.set(JSON.stringify(nodeOrigin(evidence, file, node)), node.expression.text);
          ts.forEachChild(node, child => { pending.push(child); });
        }
        parsedEvidence.set(evidence.id, { file, bindings, calls });
      }
      return parsedEvidence.get(evidence.id);
    };
    const nodeOrigin = (evidence, file, node) => {
      const position = offset => { const p = file.getLineAndCharacterOfPosition(offset); return { line: evidence.origin.start.line + p.line,
        column: p.line === 0 ? evidence.origin.start.column + p.character : p.character + 1 }; };
      return { ...evidence.origin, start: position(node.getStart(file)), end: position(node.end) };
    };
    const partialMatch = match => match.omission || (contextV2 && match.resolution.aliases.some(alias => alias.omission));
    const targets = new Set();
    for (const decision of bundle.contextExpansion.decisions) {
      requireCondition(object(decision), code, 'Invalid caller context decision.');
      const target = declarations.get(decision.targetId);
      requireCondition(target && !targets.has(decision.targetId) && decision.kind === 'direct-callers' && Array.isArray(decision.matches), code, 'Invalid caller context target.');
      targets.add(decision.targetId);
      for (const match of decision.matches) {
        keys(match, ['origin', 'evidenceId', 'omission', ...(contextV2 ? ['resolution'] : [])], code);
        const callEvidence = linkEvidence(match, target);
        if (contextV2) {
          keys(match.resolution, ['kind', 'aliases'], code);
          const { kind, aliases } = match.resolution;
          requireCondition(Array.isArray(aliases) && (kind === 'direct-symbol' ? aliases.length === 0 : kind === 'local-const-alias' && aliases.length >= 1 && aliases.length <= 8), code, 'Invalid caller resolution.');
          for (let index = 0; index < aliases.length; index++) {
            const alias = aliases[index]; keys(alias, ['name', 'initializerName', 'origin', 'evidenceId', 'omission'], code);
            requireCondition(typeof alias.name === 'string' && alias.name.length > 0 && typeof alias.initializerName === 'string' && alias.initializerName.length > 0 &&
              alias.origin?.path === match.origin.path && alias.origin?.object === match.origin.object &&
              (index === aliases.length - 1 || alias.initializerName === aliases[index + 1]?.name), code, 'Invalid alias chain provenance.');
            sourceOrigin(alias.origin, commits, code);
            const use = index === 0 ? match.origin : aliases[index - 1].origin;
            requireCondition(alias.origin.end.line < use.start.line || (alias.origin.end.line === use.start.line && alias.origin.end.column <= use.start.column), code, 'Alias initialization must precede its use.');
            const evidence = linkEvidence(alias, target);
            if (evidence) {
              const { file, bindings } = syntaxNodes(evidence);
              requireCondition(file.statements.length === 1 && ts.isVariableStatement(file.statements[0]) && (file.statements[0].declarationList.flags & ts.NodeFlags.Const), code, 'Alias evidence is not a const declaration.');
              const node = bindings.get(JSON.stringify(alias.origin));
              requireCondition(node?.parent === file.statements[0].declarationList && ts.isIdentifier(node.name) && node.name.text === alias.name &&
                node.initializer && ts.isIdentifier(node.initializer) && node.initializer.text === alias.initializerName, code, 'Alias binding and source evidence disagree.');
            }
          }
          if (aliases.length && callEvidence) {
            const { calls } = syntaxNodes(callEvidence);
            requireCondition(calls.get(JSON.stringify(match.origin)) === aliases[0].name, code, 'Alias call and source evidence disagree.');
          }
        }
      }
      requireCondition(decision.status === (decision.matches.some(partialMatch) ? 'partial' : 'complete-static-matches'), code, 'Invalid context decision coverage.');
    }
    requireCondition(bundle.evidence.filter(item => item.type === 'typescript-source').every(item => contextChanges.has(item.id)), code, 'Unreferenced source context.');
    const expectedContextCoverage = !bundle.contextExpansion.decisions.length ? 'not-requested' :
      bundle.contextExpansion.decisions.some(item => item.matches.some(partialMatch)) ? 'partial' : 'complete-static-matches';
    requireCondition(bundle.coverage.stages.contextExpansion === expectedContextCoverage, code, 'Invalid caller context coverage.');
    requireCondition(bundle.contextExpansion.serializedEvidenceBytes === sourceBytes, code, 'Invalid context byte accounting.');
  } else requireCondition(!bundle.semanticAnalysis && !bundle.contextExpansion && bundle.coverage.stages.contextExpansion === 'not-run', code, 'Semantic sections require bundle v3/v4/v5.');
  return { selectedRules, evidenceById, contextChanges };
}

export function createReviewerRequest(input, identity, options = {}) {
  requireCondition(object(options) && Object.keys(options).every(key => key === 'maxRequestBytes'), 'INVALID_INPUT', 'Unknown request options.');
  const maxBytes = limit(options.maxRequestBytes ?? DEFAULT_BYTES, 'maxRequestBytes');
  const bundle = boundedJson(input, MAX_BYTES, 'INVALID_REVIEW_BUNDLE');
  const validated = validateBundle(bundle);
  const payload = { schemaVersion: 'reviewer-request/v1', reviewer: reviewer(identity, 'INVALID_INPUT'),
    bundleId: bundle.id, bundle, selectedRules: validated.selectedRules,
    policy: { sourceContent: 'untrusted-review-data', instructions: 'selected-rules-and-adapter-policy',
      findings: 'evidence-bound-unverified-claims', maxFindings: 250, maxContextRequests: 50 } };
  const result = { id: `request:${hash(payload)}`, ...payload };
  requireCondition(Buffer.byteLength(JSON.stringify(result)) <= maxBytes, 'REVIEW_LIMIT', 'Reviewer request exceeds maxRequestBytes; no partial packet returned.');
  return freeze(result);
}

function validateRequest(input) {
  const request = boundedJson(input, MAX_BYTES, 'INVALID_REVIEW_REQUEST');
  keys(request, ['id', 'schemaVersion', 'reviewer', 'bundleId', 'bundle', 'selectedRules', 'policy'], 'INVALID_REVIEW_REQUEST');
  contentId(request, 'request', 'INVALID_REVIEW_REQUEST');
  let expected;
  try { expected = createReviewerRequest(request.bundle, request.reviewer, { maxRequestBytes: MAX_BYTES }); }
  catch { throw new ReviewerError('INVALID_REVIEW_REQUEST', 'Request contains an invalid bundle or reviewer.'); }
  requireCondition(request.id === expected.id, 'INVALID_REVIEW_REQUEST', 'Request does not match the derived contract.');
  return expected;
}

function uniqueStrings(value, maximum, code) {
  requireCondition(Array.isArray(value) && value.length <= maximum && value.every(item => typeof item === 'string') && new Set(value).size === value.length, code, 'Expected a bounded array of unique string IDs.');
  return [...value].sort(compare);
}

export function normalizeReviewerResponse(inputRequest, inputResponse, options = {}) {
  requireCondition(object(options) && Object.keys(options).every(key => ['maxResponseBytes', 'maxResultBytes'].includes(key)), 'INVALID_INPUT', 'Unknown normalization options.');
  const maxResponseBytes = limit(options.maxResponseBytes ?? 1024 * 1024, 'maxResponseBytes');
  const maxResultBytes = limit(options.maxResultBytes ?? DEFAULT_BYTES, 'maxResultBytes');
  const request = validateRequest(inputRequest);
  const response = boundedJson(inputResponse, maxResponseBytes, 'INVALID_REVIEW_RESPONSE');
  const code = 'INVALID_REVIEW_RESPONSE';
  keys(response, ['schemaVersion', 'requestId', 'reviewer', 'status', 'reviewedRuleIds', 'findings', 'contextRequests'], code);
  requireCondition(response.schemaVersion === 'reviewer-response/v1' && response.requestId === request.id &&
    JSON.stringify(reviewer(response.reviewer, code)) === JSON.stringify(request.reviewer) &&
    ['complete', 'partial', 'needs-context'].includes(response.status), code, 'Response identity, version or status does not match request.');
  const reviewedRuleIds = uniqueStrings(response.reviewedRuleIds, 250, code);
  const selected = new Map(request.selectedRules.map(rule => [rule.id, rule]));
  requireCondition(reviewedRuleIds.every(id => selected.has(id)), code, 'Response claims an unselected rule was reviewed.');
  const { evidenceById, contextChanges } = validateBundle(request.bundle);
  requireCondition(Array.isArray(response.findings) && response.findings.length <= 250, code, 'At most 250 findings are allowed.');
  const findings = new Map();
  for (const finding of response.findings) {
    keys(finding, ['ruleId', 'severity', 'title', 'description', 'evidenceIds', 'location'], code);
    requireCondition(['info', 'warning', 'error'].includes(finding.severity) &&
      (finding.ruleId === null || reviewedRuleIds.includes(finding.ruleId)), code, 'Invalid severity or unreviewed finding rule.');
    const evidenceIds = uniqueStrings(finding.evidenceIds, 32, code);
    requireCondition(evidenceIds.length > 0 && evidenceIds.every(id => evidenceById.has(id)), code, 'Findings must reference supplied evidence.');
    const location = finding.location;
    keys(location, ['evidenceId', 'side', 'startLine', 'endLine'], code);
    requireCondition(evidenceIds.includes(location.evidenceId) && positive(location.startLine) && positive(location.endLine) &&
      location.endLine >= location.startLine, code, 'Invalid finding location.');
    const evidence = evidenceById.get(location.evidenceId);
    let origin;
    if (evidence.type === 'git-patch') {
      requireCondition(['old', 'new'].includes(location.side), code, 'Patch locations require old or new side.');
      origin = evidence.origin[location.side];
      requireCondition(origin && evidence.hunks.some(hunk => hunk[location.side].lines > 0 &&
        location.startLine >= hunk[location.side].start && location.endLine < hunk[location.side].start + hunk[location.side].lines), code, 'Location lies outside supplied patch lines.');
    } else {
      requireCondition(location.side === 'source' && location.startLine >= evidence.origin.start.line &&
        location.endLine <= evidence.origin.end.line - (evidence.origin.end.column === 1 ? 1 : 0), code, 'Location lies outside supplied source snippet.');
      origin = { commit: evidence.origin.commit, path: evidence.origin.path, object: evidence.origin.object };
    }
    if (finding.ruleId !== null) {
      const matched = new Set(selected.get(finding.ruleId).matches.map(match => match.changeId));
      if (evidence.type === 'angular-template-source') requireCondition(request.bundle.angularTemplateContext.decisions.some(decision =>
        decision.ruleId === finding.ruleId && decision.template?.evidenceId === evidence.id), code, 'Primary template evidence is outside the cited rule ownership.');
      if (['angular-owner-source', 'angular-owner-template-source'].includes(evidence.type)) requireCondition(request.bundle.angularTemplateOwnerContext.decisions.some(decision =>
        decision.ruleId === finding.ruleId && decision.owners.some(owner => evidence.type === 'angular-owner-template-source' ? owner.template.evidenceId === evidence.id : owner.sourceEvidenceId === evidence.id &&
          [owner.component.origin, owner.component.decorator.binding.origin].some(range => location.startLine >= range.start.line && location.endLine <= range.end.line - (range.end.column === 1 ? 1 : 0)))), code, 'Primary owner evidence is outside the cited rule/component scope.');
      requireCondition(['git-patch', 'typescript-rule-source'].includes(evidence.type) ? matched.has(evidence.changeId) :
        [...(contextChanges.get(evidence.id) ?? [])].some(id => matched.has(id)), code, 'Primary evidence is outside the selected rule scope.');
    }
    const payload = { type: 'reviewer-claim', verification: 'unverified', requestId: request.id, bundleId: request.bundleId,
      reviewer: request.reviewer, ruleId: finding.ruleId,
      ruleConfigId: finding.ruleId === null ? null : request.bundle.ruleSelection.configId,
      severity: finding.severity, title: string(finding.title, 'title', 512, code),
      description: string(finding.description, 'description', 16_384, code), evidenceIds,
      location: { evidenceId: location.evidenceId, side: location.side, ...origin, startLine: location.startLine, endLine: location.endLine } };
    const id = `finding:${hash(payload)}`; findings.set(id, { id, ...payload });
  }
  requireCondition(Array.isArray(response.contextRequests) && response.contextRequests.length <= 50, code, 'At most 50 context requests are allowed.');
  const contextRequests = []; const targets = new Set();
  for (const item of response.contextRequests) {
    keys(item, ['kind', 'targetId'], code);
    requireCondition(item.kind === 'direct-callers' && typeof item.targetId === 'string' && !targets.has(item.targetId) &&
      request.bundle.semanticAnalysis?.declarations.some(declaration => declaration.id === item.targetId), code, 'Context target is unknown or duplicated; semantic analysis is required.');
    targets.add(item.targetId); contextRequests.push({ kind: item.kind, targetId: item.targetId });
  }
  contextRequests.sort((a, b) => compare(a.targetId, b.targetId));
  requireCondition(response.status === 'needs-context' ? contextRequests.length > 0 : contextRequests.length === 0, code, 'Context requests require needs-context status.');
  const pendingRuleIds = [...selected.keys()].filter(id => !reviewedRuleIds.includes(id)).sort(compare);
  const payload = { schemaVersion: 'review-result/v1', requestId: request.id, bundleId: request.bundleId,
    reviewer: request.reviewer, provenance: request.bundle.provenance,
    ruleConfigId: request.bundle.ruleSelection?.configId ?? null,
    findings: [...findings.values()].sort((a, b) => compare(a.id, b.id)), contextRequests,
    coverage: { status: 'partial', bundle: request.bundle.coverage,
      reviewer: { reportedStatus: response.status, status: response.status === 'complete' && pendingRuleIds.length ? 'partial' : response.status,
        reviewedRuleIds, pendingRuleIds } },
    limitations: ['Findings are unverified reviewer claims; evidence references do not establish correctness.',
      'Reviewer completion does not override bundle analysis limitations or establish the absence of defects.'] };
  const result = { id: `result:${hash(payload)}`, ...payload };
  requireCondition(Buffer.byteLength(JSON.stringify(result)) <= maxResultBytes, 'REVIEW_LIMIT', 'Normalized result exceeds maxResultBytes; no partial result returned.');
  return freeze(result);
}

export async function runReviewerAdapter(inputRequest, adapter, options = {}) {
  requireCondition(object(options) && Object.keys(options).every(key => ['timeoutMs', 'maxResponseBytes', 'maxResultBytes'].includes(key)), 'INVALID_INPUT', 'Unknown adapter options.');
  requireCondition(typeof adapter === 'function', 'INVALID_INPUT', 'Adapter must be a caller-supplied function.');
  const timeoutMs = limit(options.timeoutMs ?? 30_000, 'timeoutMs', 300_000);
  // Validate normalization limits before invoking any external adapter.
  limit(options.maxResponseBytes ?? 1024 * 1024, 'maxResponseBytes'); limit(options.maxResultBytes ?? DEFAULT_BYTES, 'maxResultBytes');
  const request = validateRequest(inputRequest); const controller = new AbortController(); let timer;
  const started = performance.now();
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new ReviewerError('REVIEW_TIMEOUT', 'Reviewer adapter exceeded timeoutMs; no partial result returned.')); }, timeoutMs);
  });
  const invocation = Promise.resolve().then(() => adapter(request, { signal: controller.signal }));
  try {
    let response;
    try { response = await Promise.race([invocation, timeout]); }
    catch (error) {
      if (controller.signal.aborted) throw new ReviewerError('REVIEW_TIMEOUT', 'Reviewer adapter exceeded timeoutMs; no partial result returned.');
      throw new ReviewerError('REVIEW_ADAPTER_FAILED', 'Reviewer adapter failed; no partial result returned.');
    }
    if (performance.now() - started >= timeoutMs) {
      controller.abort(); throw new ReviewerError('REVIEW_TIMEOUT', 'Reviewer adapter exceeded timeoutMs; no partial result returned.');
    }
    return normalizeReviewerResponse(request, response, { maxResponseBytes: options.maxResponseBytes ?? 1024 * 1024,
      maxResultBytes: options.maxResultBytes ?? DEFAULT_BYTES });
  } finally { clearTimeout(timer); }
}

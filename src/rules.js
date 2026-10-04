import { observeChangedSyntax, SYNTAX_COMPILER_VERSION } from './changed-syntax.js';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { parseDocument, isAlias, isMap, isSeq } from 'yaml';

export const MAX_RULE_BYTES = 256 * 1024;
const MAX_OPERATIONS = 5_000_000;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export class RuleError extends Error {
  constructor(code, message) { super(message); this.name = 'RuleError'; this.code = code; }
}
function check(condition, message) {
  if (!condition) throw new RuleError('INVALID_RULES', message);
}
function keys(value, allowed, label) {
  check(object(value) && Object.keys(value).every(k => allowed.includes(k)), `${label} has unknown keys or is not a mapping.`);
}
function text(value, limit, label) {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= limit, `${label} must be a nonempty string of at most ${limit} characters.`);
  return value.trim();
}
function list(value, validate, label, allowEmpty = false) {
  check(Array.isArray(value) && value.length >= (allowEmpty ? 0 : 1) && value.length <= 32 && value.every(validate), `Invalid ${label}; expected ${allowEmpty ? '0' : '1'}–32 supported strings.`);
  return [...new Set(value)].sort(compare);
}
function validGlob(value) {
  if (typeof value !== 'string' || !value || value.length > 256 || /[\x00-\x1f\x7f\\[\]{}()!]/u.test(value)) return false;
  const segments = value.split('/');
  return segments.length <= 64 && segments.every(s => s && !['.', '..'].includes(s) && (s === '**' || !s.includes('**')));
}

/** Strict single-document YAML; no custom tags, anchors, aliases or merges. */
export function parseRulesYaml(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_RULE_BYTES) {
    throw new RuleError('RULE_INPUT_LIMIT', `Rule YAML must be a string of at most ${MAX_RULE_BYTES} UTF-8 bytes.`);
  }
  let doc;
  try { doc = parseDocument(source, { version: '1.2', schema: 'core', strict: true,
    uniqueKeys: true, stringKeys: true, merge: false, prettyErrors: false }); }
  catch { throw new RuleError('INVALID_YAML', 'Rule YAML could not be parsed.'); }
  if (doc.errors.length || doc.warnings.length || doc.directives.yaml.version !== '1.2') {
    throw new RuleError('INVALID_YAML', 'Expected one valid YAML 1.2 document without warnings or duplicate keys.');
  }
  // Inspect the AST before conversion, using an iterative walk with strict limits.
  const pending = [{ node: doc.contents, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop();
    if (!node) continue;
    if (++count > 10000 || depth > 12) throw new RuleError('RULE_INPUT_LIMIT', 'Rule YAML exceeds structural limits.');
    if (isAlias(node) || node.anchor || node.tag) throw new RuleError('INVALID_YAML', 'Tags, anchors and aliases are unsupported in rule YAML.');
    if (isMap(node)) for (const pair of node.items) pending.push({ node: pair.key, depth: depth + 1 }, { node: pair.value, depth: depth + 1 });
    if (isSeq(node)) for (const item of node.items) pending.push({ node: item, depth: depth + 1 });
  }
  let input;
  try { input = doc.toJS({ maxAliasCount: 0 }); }
  catch { throw new RuleError('INVALID_YAML', 'Rule YAML could not be converted.'); }
  keys(input, ['schemaVersion', 'rules'], 'Rule document');
  check(['review-rules/v1', 'review-rules/v2'].includes(input.schemaVersion), 'Expected review-rules/v1 or v2.');
  const version2 = input.schemaVersion === 'review-rules/v2';
  check(Array.isArray(input.rules) && input.rules.length <= 250, 'Expected at most 250 rules.');
  const seen = new Set();
  const rules = input.rules.map(rule => {
    keys(rule, ['id', 'title', 'instruction', 'severity', 'enabled', 'scope', 'when'], 'Rule');
    const id = text(rule.id, 80, 'Rule ID');
    check(/^[a-z][a-z0-9-]*$/u.test(id) && !seen.has(id), 'Rule IDs must be unique lowercase slugs.'); seen.add(id);
    const title = text(rule.title, 200, `Title for ${id}`);
    const instruction = text(rule.instruction, 8000, `Instruction for ${id}`);
    const severity = rule.severity === undefined ? 'warning' : rule.severity;
    const enabled = rule.enabled === undefined ? true : rule.enabled;
    check(['info', 'warning', 'error'].includes(severity), `Invalid severity for ${id}.`);
    check(typeof enabled === 'boolean', `enabled must be boolean for ${id}.`);
    keys(rule.scope, ['paths', 'excludePaths', 'statuses', 'extensions', 'entryKinds'], `Scope for ${id}`);
    const paths = list(rule.scope.paths, validGlob, 'scope paths');
    const excludePaths = rule.scope.excludePaths === undefined ? [] : list(rule.scope.excludePaths, validGlob, 'excluded paths', true);
    const statuses = list(rule.scope.statuses === undefined ? ['A', 'M', 'D', 'R', 'T'] : rule.scope.statuses, v => ['A', 'M', 'D', 'R', 'T'].includes(v), 'statuses');
    const extensions = rule.scope.extensions === undefined ? null : list(rule.scope.extensions,
      v => typeof v === 'string' && /^\.[a-z0-9]+$/u.test(v), 'lowercase extensions');
    const entryKinds = list(rule.scope.entryKinds === undefined ? ['file'] : rule.scope.entryKinds, v => ['file', 'symlink', 'gitlink'].includes(v), 'entry kinds');
    const condition = rule.when === undefined ? {} : rule.when;
    keys(condition, ['minAddedLines', 'minRemovedLines', ...(version2 ? ['changedSyntax'] : [])], `Conditions for ${id}`);
    for (const value of [condition.minAddedLines, condition.minRemovedLines].filter(value => value !== undefined)) check(Number.isSafeInteger(value) && value >= 0 && value <= 10000000, 'Line thresholds must be nonnegative integers up to 10000000.');
    let changedSyntax = [];
    if (condition.changedSyntax !== undefined) {
      check(Array.isArray(condition.changedSyntax) && condition.changedSyntax.length <= 8, 'changedSyntax must have 0–8 predicates.');
      changedSyntax = condition.changedSyntax.map(predicate => {
        keys(predicate, ['side', 'kind', 'identifiers', 'callee'], 'Syntax predicate');
        check(['added', 'removed'].includes(predicate.side) && ['throw-guard', 'call'].includes(predicate.kind), 'Unsupported syntax predicate.');
        const identifiers = predicate.identifiers === undefined ? [] : list(predicate.identifiers, value => typeof value === 'string' && /^[a-zA-Z_$][a-zA-Z0-9_$]{0,79}$/u.test(value), 'identifiers', true);
        check(predicate.kind === 'call' ? typeof predicate.callee === 'string' && /^[a-zA-Z_$][a-zA-Z0-9_$]*(\.[a-zA-Z_$][a-zA-Z0-9_$]*)*$/u.test(predicate.callee) && predicate.callee.length <= 200 : predicate.callee === undefined, 'Calls require a bounded literal callee; guards cannot have a callee.');
        return { side: predicate.side, kind: predicate.kind, identifiers, ...(predicate.kind === 'call' ? { callee: predicate.callee } : {}) };
      }).sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
      changedSyntax = changedSyntax.filter((item, index) => index === 0 || JSON.stringify(item) !== JSON.stringify(changedSyntax[index - 1]));
    }
    return { id, title, instruction, severity, enabled, scope: { paths, excludePaths, statuses, extensions, entryKinds },
      when: { minAddedLines: condition.minAddedLines ?? null, minRemovedLines: condition.minRemovedLines ?? null, ...(version2 ? { changedSyntax } : {}) } };
  }).sort((a, b) => compare(a.id, b.id));
  const normalized = { schemaVersion: input.schemaVersion, rules };
  return { id: `rules:${createHash('sha256').update(JSON.stringify(normalized)).digest('hex')}`, ...normalized };
}

export async function readRulesFile(path) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    if (!(await file.stat()).isFile()) throw new RuleError('INVALID_RULE_FILE', 'Rule source must be a regular file.');
    const bytes = Buffer.alloc(MAX_RULE_BYTES + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > MAX_RULE_BYTES) throw new RuleError('RULE_INPUT_LIMIT', 'Rule file exceeds the UTF-8 byte limit.');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset)); }
    catch { throw new RuleError('INVALID_YAML', 'Rule file is not valid UTF-8.'); }
  } catch (error) {
    if (error instanceof RuleError) throw error;
    throw new RuleError('INVALID_RULE_FILE', 'Rule file could not be read.');
  } finally { if (file) await file.close(); }
}

function segmentMatch(pattern, value, tick) {
  const p = Array.from(pattern), v = Array.from(value);
  let i = 0, j = 0, star = -1, retry = 0;
  while (j < v.length) {
    tick();
    if (p[i] === '?' || p[i] === v[j]) { i++; j++; }
    else if (p[i] === '*') { star = i++; retry = j; }
    else if (star >= 0) { i = star + 1; j = ++retry; }
    else return false;
  }
  while (p[i] === '*') { tick(); i++; }
  return i === p.length;
}

function globMatch(pattern, path, tick) {
  const p = pattern.split('/'), parts = path.split('/');
  let previous = new Array(parts.length + 1).fill(false); previous[0] = true;
  for (const segment of p) {
    const next = new Array(parts.length + 1).fill(false);
    if (segment === '**') next[0] = previous[0];
    for (let i = 1; i <= parts.length; i++) {
      tick();
      next[i] = segment === '**' ? previous[i] || next[i - 1] : previous[i - 1] && segmentMatch(segment, parts[i - 1], tick);
    }
    previous = next;
  }
  return previous[parts.length];
}

// Internal input comes from the validated compiler, never arbitrary reviewer output.
export function selectRules(config, changes, facts, evidence = []) {
  let operations = 0;
  const tick = () => {
    if (++operations > MAX_OPERATIONS) throw new RuleError('SELECTION_LIMIT', 'Rule selection exceeded the deterministic operation budget; no partial selection returned.');
  };
  const textFacts = new Map(facts.filter(f => f.type === 'text-change').map(f => [f.changeId, f]));
  const decisions = [];
  const version2 = config.schemaVersion === 'review-rules/v2';
  const syntaxCache = new Map();
  for (const rule of config.rules) {
    const matches = [], rejected = { status: 0, scope: 0, textUnavailable: 0, threshold: 0, ...(version2 ? { syntaxUnavailable: 0, syntaxNotMatched: 0 } : {}) };
    if (rule.enabled) for (const change of changes) {
      tick();
      if (!rule.scope.statuses.includes(change.status)) { rejected.status++; continue; }
      const matchedPaths = [];
      for (const side of ['old', 'new']) {
        const path = change[`${side}Path`];
        if (path === null) continue;
        if (path.length > 4096) throw new RuleError('SELECTION_LIMIT', 'Changed path exceeds the selector path-length limit.');
        if (!rule.scope.entryKinds.includes(change[`${side}Kind`]) ||
          (rule.scope.extensions !== null && !rule.scope.extensions.includes(posix.extname(path).toLowerCase()))) continue;
        if (!rule.scope.paths.some(pattern => globMatch(pattern, path, tick)) ||
          rule.scope.excludePaths.some(pattern => globMatch(pattern, path, tick))) continue;
        matchedPaths.push({ side, path });
      }
      if (!matchedPaths.length) { rejected.scope++; continue; }
      const requiresText = rule.when.minAddedLines !== null || rule.when.minRemovedLines !== null;
      const fact = textFacts.get(change.id);
      if (requiresText && !fact) { rejected.textUnavailable++; continue; }
      if (requiresText && ((rule.when.minAddedLines !== null && fact.value.addedLines < rule.when.minAddedLines) ||
        (rule.when.minRemovedLines !== null && fact.value.removedLines < rule.when.minRemovedLines))) { rejected.threshold++; continue; }
      let syntaxMatches = [];
      if (version2 && rule.when.changedSyntax.length) {
        if (!syntaxCache.has(change.id)) syntaxCache.set(change.id, observeChangedSyntax(change, evidence, tick));
        const observed = syntaxCache.get(change.id);
        syntaxMatches = rule.when.changedSyntax.map(predicate => observed.observations.filter(item => {
          tick(); return item.side === predicate.side && item.kind === predicate.kind &&
            (predicate.kind !== 'call' || predicate.callee === item.callee) && predicate.identifiers.every(name => item.identifiers.includes(name)) &&
            matchedPaths.some(path => path.side === (item.side === 'removed' ? 'old' : 'new'));
        }));
        if (syntaxMatches.some(items => !items.length)) {
          if (!observed.available) rejected.syntaxUnavailable++; else rejected.syntaxNotMatched++;
          continue;
        }
      }
      matches.push({ changeId: change.id, evidenceIds: [...change.evidenceIds], matchedPaths,
        conditionFactIds: requiresText ? [fact.id] : [], ...(version2 ? { syntaxMatches } : {}) });
    }
    const status = matches.length ? 'matched' : 'skipped';
    const reason = !rule.enabled ? 'disabled' : !changes.length ? 'no-changes' : matches.length ? 'scope-and-conditions-match' :
      rejected.syntaxUnavailable ? 'syntax-evidence-unavailable' : rejected.syntaxNotMatched ? 'changed-syntax-not-matched' : rejected.textUnavailable ? 'text-evidence-unavailable' : rejected.threshold ? 'line-threshold-not-met' :
        rejected.scope ? 'scope-not-matched' : 'status-not-matched';
    decisions.push({ ruleId: rule.id, status, reason, matches, rejected });
  }
  return { schemaVersion: version2 ? 'rule-selection/v2' : 'rule-selection/v1', configId: config.id, rules: config.rules,
    policy: { paths: 'old-or-new-side', criteria: 'same-side-and', defaultEntryKinds: ['file'],
      maxOperations: MAX_OPERATIONS, unavailableText: 'skip-with-reason', ...(version2 ? { syntax: 'bounded-typescript-patch-context', compilerVersion: SYNTAX_COMPILER_VERSION, comparison: 'token-multiset-within-hunk', identifierBinding: 'spelling-only', calleeResolution: 'literal-property-chain', syntaxConditions: 'all-predicates-same-change', unavailableSyntax: 'skip-with-reason', maxHunkBytesPerSide: 128 * 1024, maxTokensAndNodesPerHunkSide: 25000 } : {}) }, decisions };
}

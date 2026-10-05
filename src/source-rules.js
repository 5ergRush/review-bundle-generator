import ts from 'typescript';
import { createHash } from 'node:crypto';
import { readTypeScriptSources } from './git.js';
import { discoverAngularComponents } from './angular-context.js';

export const RULE_SOURCE_LIMITS = { maxFiles: 64, maxBytes: 4 * 1024 * 1024, maxFileBytes: 512 * 1024, maxNodesPerFile: 250000 };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class RuleSourceError extends Error {
  constructor(code, message) { super(message); this.name = 'RuleSourceError'; this.code = code; }
}
const check = (ok, message) => { if (!ok) throw new RuleSourceError('INVALID_RULE_SOURCE', message); };
const eligible = change => change.coverage === 'text-diff' && ['old', 'new'].every(side => change[`${side}Path`] === null || (change[`${side}Kind`] === 'file' && change[`${side}Path`].endsWith('.ts')));
const fullRange = content => { const lines = content.split(/\r\n|[\r\n\u2028\u2029]/u); return { start: { line: 1, column: 1 }, end: { line: lines.length, column: lines.at(-1).length + 1 } }; };

export async function readRuleSourceEvidence(repo, bundle) {
  const changes = bundle.changes.filter(eligible);
  const paths = ['old', 'new'].map(side => new Set(changes.map(change => change[`${side}Path`]).filter(Boolean)));
  if (paths.reduce((sum, set) => sum + set.size, 0) > RULE_SOURCE_LIMITS.maxFiles) throw new RuleSourceError('RULE_SOURCE_LIMIT', 'More than 64 changed TypeScript source sides.');
  const r = bundle.provenance.revisions;
  const revisions = await readTypeScriptSources(repo, [r.effectiveBaseCommit, r.headCommit], paths);
  const result = [];
  for (const change of changes) for (const [index, side] of ['old', 'new'].entries()) {
    if (change[`${side}Path`] === null) continue;
    const source = revisions[index].sources.find(item => item.path === change[`${side}Path`]);
    check(source, 'Pinned changed source is unavailable.');
    const payload = { type: 'typescript-rule-source', changeId: change.id, side,
      origin: { commit: revisions[index].commit, path: source.path, object: source.object, ...fullRange(source.content) }, content: source.content };
    result.push({ id: `evidence:${hash(payload)}`, ...payload });
  }
  validateRuleSources(result, bundle.changes, r); return result;
}

export function validateRuleSources(records, changes, revisions) {
  check(Array.isArray(records), 'Rule source evidence must be an array.');
  if (records.length > RULE_SOURCE_LIMITS.maxFiles) throw new RuleSourceError('RULE_SOURCE_LIMIT', 'More than 64 rule source records.');
  const expected = new Map();
  for (const change of changes.filter(eligible)) for (const side of ['old', 'new']) if (change[`${side}Path`] !== null) expected.set(`${change.id}:${side}`, change);
  let bytes = 0; const seen = new Set();
  for (const record of records) {
    check(record && Object.keys(record).sort().join(',') === 'changeId,content,id,origin,side,type' && record.type === 'typescript-rule-source' && typeof record.content === 'string', 'Invalid rule source fields.');
    const key = `${record.changeId}:${record.side}`; const change = expected.get(key); const origin = record.origin;
    check(change && !seen.has(key) && origin && Object.keys(origin).sort().join(',') === 'commit,end,object,path,start' &&
      origin.commit === revisions[record.side === 'old' ? 'effectiveBaseCommit' : 'headCommit'] && origin.path === change[`${record.side}Path`] && origin.object === change[`${record.side}Object`] &&
      JSON.stringify({ start: origin.start, end: origin.end }) === JSON.stringify(fullRange(record.content)) && Buffer.from(record.content).toString('utf8') === record.content, 'Invalid or duplicate rule source provenance.');
    seen.add(key); const size = Buffer.byteLength(record.content); bytes += size;
    if (size > RULE_SOURCE_LIMITS.maxFileBytes || bytes > RULE_SOURCE_LIMITS.maxBytes) throw new RuleSourceError('RULE_SOURCE_LIMIT', 'Rule sources exceed 512 KiB per file or 4 MiB total.');
    const { id, ...payload } = record; check(id === `evidence:${hash(payload)}`, 'Invalid rule source evidence ID.');
    const blob = createHash(origin.object.length === 40 ? 'sha1' : 'sha256').update(`blob ${size}\0`).update(record.content).digest('hex');
    check(blob === origin.object, 'Rule source bytes do not match their Git blob ID.');
  }
  check(seen.size === expected.size, 'Complete changed TypeScript source sides are required.');
}

function shape(node) {
  let kind; let condition; let callee = null; let target;
  if (ts.isIfStatement(node) && !node.elseStatement) {
    const body = ts.isBlock(node.thenStatement) ? node.thenStatement.statements : [node.thenStatement];
    if (body.length === 1 && ts.isThrowStatement(body[0])) { kind = 'throw-guard'; condition = node.expression; }
  } else if (ts.isCallExpression(node)) {
    const names = []; let expression = node.expression;
    while (ts.isPropertyAccessExpression(expression)) { names.unshift(expression.name.text); expression = expression.expression; }
    if (ts.isIdentifier(expression)) { names.unshift(expression.text); callee = names.join('.'); kind = 'call'; condition = node; }
    else if (expression.kind === ts.SyntaxKind.ThisKeyword && names.length) { callee = ['this', ...names].join('.'); kind = 'member-call'; condition = node; }
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const names = []; let expression = node.left;
    while (ts.isPropertyAccessExpression(expression)) { names.unshift(expression.name.text); expression = expression.expression; }
    if (expression.kind === ts.SyntaxKind.ThisKeyword && names.length) { kind = 'assignment'; target = ['this', ...names].join('.'); condition = node; }
  }
  return kind ? { kind, condition, callee, ...(target ? { target } : {}) } : null;
}

function parseSource(record, tick, qualifyComponent) {
  const text = record?.content ?? ''; let file;
  try { file = ts.createSourceFile(record?.origin.path ?? 'absent.ts', text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS); }
  catch { return null; }
  if (file.parseDiagnostics.length) return null;
  const classes = qualifyComponent && record ? discoverAngularComponents(record, tick).classes : [];
  const point = offset => { const value = file.getLineAndCharacterOfPosition(offset); return { line: value.line + 1, column: value.character + 1 }; };
  const classContexts = new Map(classes.map(item => [JSON.stringify([item.classOrigin.start, item.classOrigin.end]), item]));
  const tokens = []; const pending = [file]; let count = 0;
  while (pending.length) {
    tick(); if (++count > RULE_SOURCE_LIMITS.maxNodesPerFile) throw new RuleSourceError('RULE_SOURCE_LIMIT', 'Source token tree exceeds 250000 nodes.');
    const node = pending.pop(); const children = node.getChildren(file);
    if (children.length) for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
    else if (node.kind >= ts.SyntaxKind.FirstToken && node.kind <= ts.SyntaxKind.LastToken && node.kind !== ts.SyntaxKind.EndOfFileToken) tokens.push({ start: node.getStart(file), end: node.end, value: node.getText(file) });
  }
  const lower = offset => { let low = 0; let high = tokens.length; while (low < high) { tick(); const middle = (low + high) >>> 1; if (tokens[middle].start < offset) low = middle + 1; else high = middle; } return low; };
  const nodes = []; const queue = [file]; count = 0;
  while (queue.length) {
    tick(); if (++count > RULE_SOURCE_LIMITS.maxNodesPerFile) throw new RuleSourceError('RULE_SOURCE_LIMIT', 'Source AST exceeds 250000 nodes.');
    const node = queue.pop(); ts.forEachChild(node, child => { queue.push(child); }); const value = shape(node); if (!value) continue;
    const start = node.getStart(file); const end = node.end; const included = [];
    for (let index = lower(start); index < tokens.length && tokens[index].end <= end; index++) { tick(); included.push(tokens[index]); }
    const identifiers = new Set(); const parts = [value.condition];
    while (parts.length) { tick(); const part = parts.pop(); if (ts.isIdentifier(part)) identifiers.add(part.text); ts.forEachChild(part, child => { parts.push(child); }); }
    let within = null; let withinLine = null; const scope = []; let nearestClass = null;
    for (let parent = node.parent; parent; parent = parent.parent) {
      tick(); if (parent.name && ts.isIdentifier(parent.name)) scope.unshift(parent.name.text);
      if (!nearestClass && (ts.isClassDeclaration(parent) || ts.isClassExpression(parent))) nearestClass = parent;
      if (withinLine === null && ts.isFunctionLike(parent)) { within = parent.name && ts.isIdentifier(parent.name) ? parent.name.text : null; withinLine = within ? file.getLineAndCharacterOfPosition(parent.name.getStart(file)).line + 1 : -1; }
    }
    const first = file.getLineAndCharacterOfPosition(start); const last = file.getLineAndCharacterOfPosition(end - 1); const exclusive = file.getLineAndCharacterOfPosition(end);
    let angularComponentContext;
    if (qualifyComponent) {
      const relation = nearestClass ? classContexts.get(JSON.stringify([point(nearestClass.getStart(file)), point(nearestClass.end)])) : null;
      const component = relation?.component?.decorator ? relation.component : null;
      const unavailable = nearestClass && (!relation || ['ambiguous-component-decorator', 'named-component-class-unavailable'].includes(relation.reason));
      angularComponentContext = { status: component ? 'included' : unavailable ? 'unavailable' : 'not-component',
        reason: component ? 'bound-component-decorator' : unavailable ? relation?.reason ?? 'class-context-unavailable' : nearestClass ? 'nearest-class-not-bound-component' : 'not-in-class', component };
    }
    nodes.push({ kind: value.kind, callee: value.callee, ...(value.target ? { target: value.target } : {}), identifiers: [...identifiers].sort(),
      ...(qualifyComponent ? { angularComponentContext } : {}),
      within, withinLine: withinLine === -1 ? null : withinLine, startLine: first.line + 1, endLine: last.line + 1,
      origin: record ? { ...record.origin, start: { line: first.line + 1, column: first.character + 1 }, end: { line: exclusive.line + 1, column: exclusive.character + 1 } } : null,
      included, fingerprint: JSON.stringify([scope, included.map(token => token.value), ...(qualifyComponent ? [angularComponentContext.status] : [])]) });
  }
  return { file, nodes };
}

export function observePinnedSyntax(change, evidence, tick, qualifyComponent = false) {
  if (!eligible(change)) return { available: false, reason: 'not-applicable', observations: [] };
  const sources = ['old', 'new'].map(side => evidence.find(item => item.type === 'typescript-rule-source' && item.changeId === change.id && item.side === side));
  if (sources.some((source, index) => !source && change[index === 0 ? 'oldPath' : 'newPath'] !== null)) return { available: false, reason: 'source-unavailable', observations: [] };
  if (sources.some(source => /[\u2028\u2029]|\r(?!\n)/u.test(source?.content ?? ''))) return { available: false, reason: 'unsupported-line-separators', observations: [] };
  const sourceLines = sources.map(source => source?.content.split('\n') ?? []);
  const parsed = sources.map(source => parseSource(source, tick, qualifyComponent));
  if (parsed.some(item => item === null)) return { available: false, reason: 'parse-unavailable', observations: [] };
  const observations = [];
  for (const patchId of change.evidenceIds) {
    const patch = evidence.find(item => item.id === patchId); const hunks = []; let hunk;
    for (const line of patch.content.split('\n')) {
      tick(); const coordinates = /^@@ -(\d+)(?:,\d+)? \+(\d+)/u.exec(line);
      if (coordinates) { hunk = { oldStart: Number(coordinates[1]), newStart: Number(coordinates[2]), old: [], new: [], removed: new Set(), added: new Set() }; hunks.push(hunk); }
      else if (hunk && [' ', '-', '+'].includes(line[0])) for (const [index, side] of ['old', 'new'].entries()) if (line[0] !== (side === 'old' ? '+' : '-')) {
        const number = hunk[`${side}Start`] + hunk[side].length;
        check(sourceLines[index][number - 1] === line.slice(1), 'Patch lines disagree with pinned rule sources.');
        if (line[0] === (side === 'old' ? '-' : '+')) hunk[side === 'old' ? 'removed' : 'added'].add(number);
        hunk[side].push(line.slice(1));
      }
    }
    for (const [hunkIndex, item] of hunks.entries()) {
      const candidates = parsed.map((source, index) => {
        const side = index === 0 ? 'old' : 'new'; const edited = item[side === 'old' ? 'removed' : 'added'];
        return source.nodes.filter(node => { tick(); return (node.startLine <= item[`${side}Start`] + item[side].length - 1 && node.endLine >= item[`${side}Start`]) ||
          (node.withinLine !== null && node.withinLine >= item[`${side}Start`] && node.withinLine < item[`${side}Start`] + item[side].length); }).map(node => {
          const touched = edited.has(node.withinLine) || node.included.some(token => {
            tick(); const first = source.file.getLineAndCharacterOfPosition(token.start).line + 1; const last = source.file.getLineAndCharacterOfPosition(token.end - 1).line + 1;
            for (let line = first; line <= last; line++) { tick(); if (edited.has(line)) return true; } return false;
          }); return { node, touched };
        });
      });
      for (const [index, side] of ['removed', 'added'].entries()) {
        const counts = new Map(); const key = node => node.kind + node.fingerprint;
        for (const { node } of candidates[1 - index]) { tick(); counts.set(key(node), (counts.get(key(node)) ?? 0) + 1); }
        for (const { node, touched } of candidates[index].sort((a, b) => Number(a.touched) - Number(b.touched))) {
          tick(); const count = counts.get(key(node)) ?? 0; if (count) { counts.set(key(node), count - 1); continue; }
          if (!touched) continue;
          const { included, fingerprint, ...observation } = node;
          observations.push({ ...observation, side, evidenceId: patch.id, sourceEvidenceId: sources[index].id, hunkIndex });
        }
      }
    }
  }
  return { available: true, reason: 'parsed-pinned-sources', observations };
}

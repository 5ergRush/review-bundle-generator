import ts from 'typescript';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { readAngularTemplateSources } from './git.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const key = value => JSON.stringify([value.commit, value.path]);
const fullRange = content => { const lines = content.split(/\r\n|[\r\n\u2028\u2029]/u); return { start: { line: 1, column: 1 }, end: { line: lines.length, column: lines.at(-1).length + 1 } }; };
export class AngularContextError extends Error {
  constructor(code, message) { super(message); this.name = 'AngularContextError'; this.code = code; }
}
const check = (ok, message, code = 'INVALID_ANGULAR_CONTEXT') => { if (!ok) throw new AngularContextError(code, message); };
const limits = Object.freeze({ maxExternalSources: 10, maxFileBytes: 32 * 1024, maxBytes: 128 * 1024, maxAnchors: 10000, maxNodesPerFile: 250000, maxOperations: 5_000_000 });

function parseSource(source, tick) {
  const path = '/review-project/' + source.origin.path;
  const file = ts.createSourceFile(path, source.content, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length) return null;
  const host = { getSourceFile: name => name === path ? file : undefined, getDefaultLibFileName: () => '/absent.d.ts', writeFile() {}, getCurrentDirectory: () => '/review-project/',
    getDirectories: () => [], fileExists: name => name === path, readFile: name => name === path ? source.content : undefined, getCanonicalFileName: name => name, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n' };
  const program = ts.createProgram([path], { noLib: true, noResolve: true, target: ts.ScriptTarget.ESNext, experimentalDecorators: true }, host);
  const classes = []; const pending = [file]; let nodes = 0;
  while (pending.length) {
    tick(); check(++nodes <= limits.maxNodesPerFile, 'Angular source AST exceeds node budget.', 'ANGULAR_CONTEXT_LIMIT');
    const node = pending.pop(); if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) classes.push(node);
    ts.forEachChild(node, child => { pending.push(child); });
  }
  return { file, classes, checker: program.getTypeChecker() };
}
function origin(source, file, node) {
  const start = file.getLineAndCharacterOfPosition(node.getStart(file)); const end = file.getLineAndCharacterOfPosition(node.end);
  return { ...source.origin, start: { line: start.line + 1, column: start.character + 1 }, end: { line: end.line + 1, column: end.character + 1 } };
}
function angularImport(expression, checker, source, file, importedName) {
  const namespace = ts.isPropertyAccessExpression(expression) && expression.name.text === importedName && ts.isIdentifier(expression.expression);
  const target = namespace ? expression.expression : ts.isIdentifier(expression) ? expression : null;
  const declarations = target && checker.getSymbolAtLocation(target)?.declarations;
  if (!declarations || declarations.length !== 1) return null;
  const declaration = declarations[0]; let clause; let imported;
  if (namespace && ts.isNamespaceImport(declaration)) { clause = declaration.parent; imported = importedName; }
  else if (!namespace && ts.isImportSpecifier(declaration) && !declaration.isTypeOnly) { clause = declaration.parent.parent; imported = (declaration.propertyName ?? declaration.name).text; }
  const statement = clause?.parent;
  if (imported !== importedName || clause.isTypeOnly || !ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== '@angular/core') return null;
  return { localName: target.text, kind: namespace ? 'namespace-import' : 'named-import', origin: origin(source, file, declaration) };
}
function templateFor(source, parsed, anchor, tick) {
  if (!parsed) return { reason: 'parse-unavailable' };
  const { file } = parsed;
  const start = file.getPositionOfLineAndCharacter(anchor.origin.start.line - 1, anchor.origin.start.column - 1);
  const end = file.getPositionOfLineAndCharacter(anchor.origin.end.line - 1, anchor.origin.end.column - 1);
  const candidates = parsed.classes.filter(node => { tick(); return node.getStart(file) <= start && node.end >= end; }).sort((a, b) => a.end - a.getStart(file) - (b.end - b.getStart(file)));
  const owner = candidates[0];
  return relationForOwner(source, parsed, owner, tick);
}
function relationForOwner(source, parsed, owner, tick) {
  const { file, checker } = parsed;
  if (!owner || !ts.isClassDeclaration(owner) || !owner.name) return { reason: 'named-component-class-unavailable' };
  const component = { name: owner.name.text, origin: origin(source, file, owner) };
  const decorators = (ts.getDecorators(owner) ?? []).flatMap(decorator => {
    tick(); if (!ts.isCallExpression(decorator.expression)) return [];
    const binding = angularImport(decorator.expression.expression, checker, source, file, 'Component');
    return binding ? [{ decorator, binding }] : [];
  });
  if (decorators.length !== 1) return { component, reason: decorators.length ? 'ambiguous-component-decorator' : 'component-import-binding-unavailable' };
  const { decorator, binding } = decorators[0]; component.decorator = { origin: origin(source, file, decorator), binding };
  const args = decorator.expression.arguments;
  if (args.length !== 1 || !ts.isObjectLiteralExpression(args[0])) return { component, reason: 'unsupported-component-metadata' };
  const properties = new Map();
  for (const property of args[0].properties) {
    tick(); if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) return { component, reason: 'unsupported-component-metadata' };
    const name = property.name.text; if (properties.has(name)) return { component, reason: 'ambiguous-component-metadata' }; properties.set(name, property.initializer);
  }
  if (properties.has('template') && properties.has('templateUrl')) return { component, reason: 'conflicting-template-metadata' };
  const kind = properties.has('template') ? 'inline' : properties.has('templateUrl') ? 'external' : null;
  if (!kind) return { component, reason: 'template-metadata-unavailable' };
  const value = properties.get(kind === 'inline' ? 'template' : 'templateUrl');
  if (!(ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))) return { component, reason: 'dynamic-template-metadata' };
  const template = { kind, metadataOrigin: origin(source, file, value), value: value.text };
  if (kind === 'inline') return { component, template };
  const url = value.text; const path = posix.normalize(posix.join(posix.dirname(source.origin.path), url));
  if (!url || url.length > 4096 || /[\\\0\r\n:%?#]/u.test(url) || url.startsWith('/') || path.startsWith('../') || path === '..' || path === '.' || path.startsWith('/')) return { component, reason: 'unsupported-template-url' };
  template.path = path; template.commit = source.origin.commit; return { component, template };
}

function changeDetectionForOwner(source, parsed, owner, relation, tick) {
  const result = (status, reason, strategy = null, metadataOrigin = null, binding = null) => ({ status, reason, strategy, metadataOrigin, binding });
  if (!relation.component?.decorator) return result('unavailable', 'component-not-qualified');
  const { file, checker } = parsed;
  const decorator = (ts.getDecorators(owner) ?? []).find(item => { tick(); return ts.isCallExpression(item.expression) && angularImport(item.expression.expression, checker, source, file, 'Component'); });
  const args = decorator.expression.arguments;
  if (args.length !== 1 || !ts.isObjectLiteralExpression(args[0])) return result('unavailable', 'nonliteral-component-metadata');
  const properties = new Map();
  for (const property of args[0].properties) {
    tick(); if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) return result('unavailable', 'unsupported-component-metadata-properties');
    const name = property.name.text;
    if (properties.has(name)) return result('unavailable', 'ambiguous-component-metadata-properties');
    properties.set(name, property.initializer);
  }
  if (!properties.has('changeDetection')) return result('not-matched', 'no-explicit-change-detection');
  const value = properties.get('changeDetection'), metadataOrigin = origin(source, file, value);
  if (!ts.isPropertyAccessExpression(value)) return result('unavailable', 'nonliteral-change-detection-reference', null, metadataOrigin);
  const binding = angularImport(value.expression, checker, source, file, 'ChangeDetectionStrategy');
  if (!binding) return result('unavailable', 'change-detection-import-binding-unavailable', null, metadataOrigin);
  if (!['OnPush', 'Default'].includes(value.name.text)) return result('unavailable', 'unsupported-change-detection-member', null, metadataOrigin, binding);
  return result(value.name.text === 'OnPush' ? 'included' : 'not-matched', 'bound-change-detection-strategy', value.name.text, metadataOrigin, binding);
}

// Internal shared ownership parser for an explicitly configured candidate source set.
export function discoverAngularComponents(source, tick, includeChangeDetection = false) {
  const parsed = parseSource(source, tick);
  if (!parsed) return { status: 'parse-unavailable', classes: [] };
  return { status: 'parsed', classes: [...parsed.classes].sort((a, b) => a.getStart(parsed.file) - b.getStart(parsed.file)).map(owner => {
    tick(); const relation = relationForOwner(source, parsed, owner, tick);
    return { classOrigin: origin(source, parsed.file, owner), ...relation,
      ...(includeChangeDetection ? { changeDetectionContext: changeDetectionForOwner(source, parsed, owner, relation, tick) } : {}) };
  }) };
}

function plan(bundle) {
  const decisions = []; const requests = new Map(); const parsed = new Map(); let operations = 0; let anchors = 0;
  const tick = () => check(++operations <= limits.maxOperations, 'Angular context exceeds operation budget.', 'ANGULAR_CONTEXT_LIMIT');
  const sources = new Map(bundle.evidence.filter(item => item.type === 'typescript-rule-source').map(item => [item.id, item]));
  for (const selection of bundle.ruleSelection.decisions) {
    if (selection.status !== 'matched') { decisions.push({ ruleId: selection.ruleId, anchor: null, component: null, template: null, status: 'omitted', reason: 'rule-not-selected' }); continue; }
    const observations = new Map();
    for (const match of selection.matches) for (const observation of (match.syntaxMatches ?? []).flat()) {
      tick(); const anchor = { changeId: match.changeId, side: observation.side === 'removed' ? 'old' : 'new', evidenceId: observation.evidenceId,
        sourceEvidenceId: observation.sourceEvidenceId, origin: observation.origin };
      observations.set(JSON.stringify(anchor), anchor);
    }
    if (!observations.size) { decisions.push({ ruleId: selection.ruleId, anchor: null, component: null, template: null, status: 'omitted', reason: 'syntax-anchor-required' }); continue; }
    for (const anchor of [...observations.values()].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)))) {
      tick(); check(++anchors <= limits.maxAnchors, 'More than 10000 Angular syntax anchors.', 'ANGULAR_CONTEXT_LIMIT');
      const source = sources.get(anchor.sourceEvidenceId); check(source && anchor.origin, 'Pinned syntax source required.');
      if (!parsed.has(source.id)) parsed.set(source.id, parseSource(source, tick));
      const relation = templateFor(source, parsed.get(source.id), anchor, tick);
      decisions.push({ ruleId: selection.ruleId, anchor, component: relation.component ?? null, template: relation.template ?? null,
        status: relation.template ? 'included' : 'omitted', reason: relation.template ? 'explicit-component-template-metadata' : relation.reason });
      if (relation.template?.kind === 'external') requests.set(key(relation.template), { commit: relation.template.commit, path: relation.template.path });
    }
  }
  const ordered = [...requests.values()].sort((a, b) => compare(key(a), key(b)));
  check(ordered.length <= limits.maxExternalSources, 'More than 10 external template sources.', 'ANGULAR_CONTEXT_LIMIT');
  return { decisions, requests: ordered };
}

export function compileAngularTemplateContext(bundle, evidence) {
  check(Array.isArray(evidence), 'Template evidence must be an array.');
  const planned = plan(bundle); const expected = new Set(planned.requests.map(key)); const records = new Map(); let bytes = 0;
  const changedObjects = new Map();
  for (const change of bundle.changes) for (const side of ['old', 'new']) if (change[`${side}Path`] !== null) changedObjects.set(key({
    commit: bundle.provenance.revisions[side === 'old' ? 'effectiveBaseCommit' : 'headCommit'], path: change[`${side}Path`] }), { object: change[`${side}Object`], kind: change[`${side}Kind`] });
  check(evidence.length <= limits.maxExternalSources, 'Too many template sources.', 'ANGULAR_CONTEXT_LIMIT');
  for (const record of evidence) {
    check(record && Object.keys(record).sort().join(',') === 'content,id,origin,type' && record.type === 'angular-template-source' && typeof record.content === 'string', 'Invalid template source fields.');
    const o = record.origin;
    check(o && Object.keys(o).sort().join(',') === 'commit,end,object,path,start' && expected.has(key(o)) && !records.has(key(o)) && typeof o.object === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(o.object) &&
      JSON.stringify({ start: o.start, end: o.end }) === JSON.stringify(fullRange(record.content)) && Buffer.from(record.content).toString('utf8') === record.content, 'Invalid template source provenance.');
    const changed = changedObjects.get(key(o)); check(!changed || (changed.kind === 'file' && changed.object === o.object), 'Template blob disagrees with changed-file metadata.');
    const size = Buffer.byteLength(record.content); bytes += size;
    check(size <= limits.maxFileBytes && bytes <= limits.maxBytes, 'Template source bytes exceed budget.', 'ANGULAR_CONTEXT_LIMIT');
    const { id, ...payload } = record;
    check(id === `evidence:${hash(payload)}` && createHash(o.object.length === 40 ? 'sha1' : 'sha256').update(`blob ${size}\0`).update(record.content).digest('hex') === o.object, 'Template bytes/ID disagree with Git blob.');
    records.set(key(o), record);
  }
  check(records.size === expected.size, 'Complete requested external template sources required.');
  for (const decision of planned.decisions) if (decision.template?.kind === 'external') decision.template.evidenceId = records.get(key(decision.template)).id;
  return { schemaVersion: 'angular-template-context/v1', policy: { basis: 'selected-rule-syntax-in-component-class-with-bound-angular-core-import',
    compilerVersion: ts.version, templateSemantics: 'not-analyzed', limits }, decisions: planned.decisions,
    externalSources: planned.requests.map(request => ({ ...request, evidenceId: records.get(key(request)).id })) };
}

export async function expandAngularTemplateContext(repo, bundle) {
  const planned = plan(bundle); const sources = planned.requests.length ? await readAngularTemplateSources(repo, planned.requests) : [];
  const evidence = sources.map(source => {
    const payload = { type: 'angular-template-source', origin: { commit: source.commit, path: source.path, object: source.object, ...fullRange(source.content) }, content: source.content };
    return { id: `evidence:${hash(payload)}`, ...payload };
  });
  return { evidence, angularTemplateContext: compileAngularTemplateContext(bundle, evidence) };
}

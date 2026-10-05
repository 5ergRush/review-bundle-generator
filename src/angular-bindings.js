import ts from 'typescript';
import * as ng from '@angular/compiler';
import { AngularContextError } from './angular-context.js';

const limits = Object.freeze({ maxTemplates: 64, maxFileBytes: 32768, maxBytes: 131072, maxNodes: 20000, maxDepth: 128, maxOperations: 500000 });
const check = (ok, message) => { if (!ok) throw new AngularContextError('ANGULAR_BINDING_LIMIT', message); };
const ignored = new Set(['sourceSpan', 'nameSpan', 'keySpan', 'valueSpan', 'handlerSpan', 'argumentSpan', 'span', 'startSourceSpan', 'endSourceSpan', 'i18n', 'errors']);
function children(node) {
  return Object.entries(node).filter(([key]) => !ignored.has(key)).flatMap(([, value]) =>
    (Array.isArray(value) ? value : [value]).filter(item => item && typeof item === 'object' &&
      (item instanceof ng.AST || typeof item.visit === 'function')));
}
function walk(roots, visit, tick) {
  const pending = roots.map(node => ({ node, parent: null, depth: 0 })); let count = 0;
  while (pending.length) {
    tick(); const item = pending.pop(); check(++count <= limits.maxNodes && item.depth <= limits.maxDepth, 'Template AST exceeds node/depth budget.');
    visit(item.node, item.parent);
    for (const child of children(item.node).reverse()) pending.push({ node: child, parent: item.node, depth: item.depth + 1 });
  }
}
function coordinates(content) {
  const starts = [0]; const breaks = /\r\n|[\r\n\u2028\u2029]/gu; let match;
  while ((match = breaks.exec(content))) starts.push(match.index + match[0].length);
  const point = offset => {
    let low = 0, high = starts.length;
    while (low + 1 < high) { const mid = (low + high) >> 1; if (starts[mid] <= offset) low = mid; else high = mid; }
    return { line: low + 1, column: offset - starts[low] + 1 };
  };
  return (start, end) => ({ startOffset: start, endOffset: end, start: point(start), end: point(end) });
}
function sourceRange(file, node) {
  const start = file.getLineAndCharacterOfPosition(node.getStart(file)); const end = file.getLineAndCharacterOfPosition(node.end);
  return { start: { line: start.line + 1, column: start.character + 1 }, end: { line: end.line + 1, column: end.character + 1 } };
}
function componentMembers(source, component, tick) {
  const file = ts.createSourceFile(source.origin.path, source.content, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const pending = [file]; let owner;
  while (pending.length) {
    tick(); const node = pending.pop();
    if (ts.isClassDeclaration(node) && node.name?.text === component.name && JSON.stringify(sourceRange(file, node)) === JSON.stringify({ start: component.origin.start, end: component.origin.end })) owner = node;
    ts.forEachChild(node, child => { pending.push(child); });
  }
  if (!owner) throw new AngularContextError('INVALID_ANGULAR_CONTEXT', 'Component source owner unavailable.');
  const members = new Map();
  const add = (node, kind) => {
    if (!(ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name)) || node.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword)) return;
    const name = node.name.text; if (!members.has(name)) members.set(name, []);
    members.get(name).push({ name, kind, evidenceId: source.id, origin: { ...source.origin, ...sourceRange(file, node) } });
  };
  for (const member of owner.members) {
    tick();
    if (ts.isPropertyDeclaration(member) || ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) add(member, ts.SyntaxKind[member.kind]);
    if (ts.isConstructorDeclaration(member)) for (const parameter of member.parameters) if (ts.isParameterPropertyDeclaration(parameter, member)) add(parameter, 'ParameterProperty');
  }
  const decorator = (ts.getDecorators(owner) ?? []).find(d => JSON.stringify(sourceRange(file, d)) === JSON.stringify({ start: component.decorator.origin.start, end: component.decorator.origin.end }));
  const customInterpolation = decorator?.expression.arguments?.[0]?.properties?.some(p => p.name?.text === 'interpolation');
  return { members, customInterpolation };
}
function parseBindings(content, url, tick) {
  let parsed;
  try { parsed = ng.parseTemplate(content, url, { preserveWhitespaces: true, preserveLineEndings: true }); }
  catch { throw new AngularContextError('ANGULAR_BINDING_PARSE_FAILURE', 'Angular parser could not complete; no partial bundle returned.'); }
  const range = coordinates(content);
  if (parsed.errors?.length) return { status: 'omitted', reason: 'template-parse-errors', diagnostics: parsed.errors.map(error => ({ message: error.msg, range: range(error.span.start.offset, error.span.end.offset) })), bindings: [] };
  // Check bounds before Angular's recursive scope binder traverses the AST.
  let unsupportedNode = false;
  walk(parsed.nodes, node => { if (node instanceof ng.TmplAstDeferredBlock || node instanceof ng.TmplAstIcu) unsupportedNode = true; }, tick);
  if (unsupportedNode) return { status: 'omitted', reason: 'deferred-or-icu-template-unsupported', diagnostics: [], bindings: [] };
  let bound;
  try { bound = new ng.R3TargetBinder(new ng.SelectorMatcher()).bind({ template: parsed.nodes }); }
  catch { throw new AngularContextError('ANGULAR_BINDING_PARSE_FAILURE', 'Angular scope binder could not complete; no partial bundle returned.'); }
  const bindings = [];
  walk(parsed.nodes, (node, parent) => {
    if (!(node instanceof ng.ASTWithSource)) return;
    const kind = parent instanceof ng.TmplAstBoundEvent ? 'event' : parent instanceof ng.TmplAstBoundAttribute ? 'property' : parent instanceof ng.TmplAstBoundText ? 'interpolation' : 'control-flow';
    const unsupportedScope = parent instanceof ng.TmplAstForLoopBlock && parent.trackBy === node;
    const originalSpan = kind === 'interpolation' ? parent.sourceSpan : kind === 'event' ? parent.handlerSpan : kind === 'property' ? parent.valueSpan : null;
    const start = originalSpan?.start.offset ?? node.sourceSpan.start, end = originalSpan?.end.offset ?? node.sourceSpan.end;
    const binding = { kind, name: parent?.name ?? null, range: range(start, end), status: 'included', reason: 'parsed-expression', references: [], pipes: [] };
    // Angular decodes HTML entities before expression parsing. Its absolute expression
    // offsets then describe transformed text, so never present those as raw-file ranges.
    if (content.slice(node.sourceSpan.start, node.sourceSpan.end) !== node.source) {
      binding.status = 'omitted'; binding.reason = 'expression-source-transformation'; bindings.push(binding); return;
    }
    walk([node.ast], (ast, astParent) => {
      if (ast instanceof ng.BindingPipe) binding.pipes.push({ name: ast.name, range: range(ast.nameSpan.start, ast.nameSpan.end), resolution: 'not-resolved' });
      if (!(ast instanceof ng.PropertyRead || ast instanceof ng.SafePropertyRead || ast instanceof ng.PropertyWrite) || !(ast.receiver instanceof ng.ImplicitReceiver)) return;
      const explicitThis = ast.receiver instanceof ng.ThisReceiver;
      const local = explicitThis ? null : bound.getExpressionTarget(ast);
      const name = ast.name;
      const classification = unsupportedScope ? 'unresolved' : local ? 'template-local' : !explicitThis && kind === 'event' && name === '$event' ? 'event-local' : !explicitThis && ['undefined', '$any'].includes(name) ? 'global' : 'component-candidate';
      binding.references.push({ name, access: ast instanceof ng.PropertyWrite ? 'write' : (astParent instanceof ng.Call || astParent instanceof ng.SafeCall) && astParent.receiver === ast ? 'call' : 'read',
        receiver: explicitThis ? 'explicit-this' : 'implicit', range: range(ast.nameSpan.start, ast.nameSpan.end), classification,
        declaration: local ? { name: local.name, range: range(local.sourceSpan.start.offset, local.sourceSpan.end.offset) } : null,
        reason: unsupportedScope ? 'for-track-scope-unavailable' : null });
    }, tick);
    binding.references.sort((a, b) => a.range.startOffset - b.range.startOffset); binding.pipes.sort((a, b) => a.range.startOffset - b.range.startOffset);
    bindings.push(binding);
  }, tick);
  bindings.sort((a, b) => a.range.startOffset - b.range.startOffset);
  return { status: 'included', reason: 'parsed-template-static-relationships', diagnostics: [], bindings };
}

// Callers validate ownership and evidence first. No filesystem or analyzed-repo code runs here.
export function compileAngularTemplateBindings(bundle) {
  const evidence = new Map(bundle.evidence.map(item => [item.id, item]));
  const templates = new Map(); const owners = new Map(); const decisions = []; let operations = 0, bytes = 0;
  const tick = () => check(++operations <= limits.maxOperations, 'Angular bindings exceed operation budget.');
  for (const decision of bundle.angularTemplateContext.decisions) {
    tick(); const result = { ruleId: decision.ruleId, anchor: decision.anchor, component: decision.component, template: decision.template, status: 'omitted', reason: decision.reason, diagnostics: [], bindings: [] };
    decisions.push(result); if (decision.status !== 'included') continue;
    const source = evidence.get(decision.anchor.sourceEvidenceId);
    const ownerKey = JSON.stringify([source.id, decision.component.origin]);
    if (!owners.has(ownerKey)) owners.set(ownerKey, componentMembers(source, decision.component, tick));
    const { members, customInterpolation } = owners.get(ownerKey);
    if (customInterpolation) { result.reason = 'custom-interpolation-unsupported'; continue; }
    const template = decision.template;
    const templateKey = template.kind === 'external' ? template.evidenceId : JSON.stringify([source.id, template.metadataOrigin]);
    if (!templates.has(templateKey)) {
      const content = template.kind === 'external' ? evidence.get(template.evidenceId).content : template.value;
      const size = Buffer.byteLength(content); bytes += size;
      check(templates.size < limits.maxTemplates && size <= limits.maxFileBytes && bytes <= limits.maxBytes, 'Parsed template count/bytes exceed budget.');
      templates.set(templateKey, parseBindings(content, template.kind === 'external' ? template.path : source.origin.path + '#inline', tick));
    }
    Object.assign(result, structuredClone(templates.get(templateKey)));
    result.coordinateSpace = template.kind === 'external' ? 'external-template-utf16' : 'decoded-inline-template-utf16';
    for (const binding of result.bindings) for (const reference of binding.references) {
      tick(); reference.member = null;
      if (reference.classification !== 'component-candidate') continue;
      const candidates = members.get(reference.name) ?? [];
      reference.classification = candidates.length === 1 ? 'component-member' : 'unresolved';
      reference.member = candidates.length === 1 ? candidates[0] : null;
      reference.reason = candidates.length === 1 ? 'declared-instance-member' : candidates.length ? 'ambiguous-instance-member' : 'instance-member-unavailable';
    }
  }
  return { schemaVersion: 'angular-template-bindings/v1', policy: { compilerVersion: ng.VERSION.full, basis: 'angular-parser-and-lexical-scope-with-declared-instance-members',
    directiveMatching: 'not-run', typeChecking: 'not-run', limits }, decisions };
}

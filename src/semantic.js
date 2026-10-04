import ts from 'typescript';
import { createHash } from 'node:crypto';
import { readTypeScriptSources } from './git.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const root = '/review-project/';
export class SemanticError extends Error {
  constructor(code, message) { super(message); this.name = 'SemanticError'; this.code = code; }
}
const fail = message => { throw new SemanticError('INVALID_CONTEXT_REQUEST', message); };

function requests(input) {
  if (!Array.isArray(input) || input.length > 50) fail('contextRequests must be an array of at most 50 requests.');
  const seen = new Set();
  return input.map(item => {
    if (!item || Object.keys(item).sort().join(',') !== 'kind,targetId' || item.kind !== 'direct-callers' ||
        typeof item.targetId !== 'string' || !/^declaration:[a-f0-9]{64}$/u.test(item.targetId) || seen.has(item.targetId)) {
      fail('Expected unique {kind: "direct-callers", targetId: "declaration:<sha256>"} requests.');
    }
    seen.add(item.targetId); return { kind: item.kind, targetId: item.targetId };
  }).sort((a, b) => a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0);
}

function changedLines(content, side) {
  const lines = new Set(); let old = 0; let next = 0; let active = false;
  for (const line of content.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
    if (hunk) { old = Number(hunk[1]); next = Number(hunk[2]); active = true; continue; }
    if (!active) continue;
    if (line.startsWith('-')) { if (side === 'old') lines.add(old); old++; }
    else if (line.startsWith('+')) { if (side === 'new') lines.add(next); next++; }
    else if (line.startsWith(' ')) { old++; next++; }
    else if (!line.startsWith('\\')) active = false;
    if (lines.size > 10_000) throw new SemanticError('SEMANTIC_LIMIT', 'More than 10000 changed lines in a TypeScript file.');
  }
  return lines;
}

const supported = node => (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ||
  ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ||
  ts.isEnumDeclaration(node) || ts.isVariableDeclaration(node)) && node.name && ts.isIdentifier(node.name);

function intersects(lines, start, end) {
  let low = 0; let high = lines.length;
  while (low < high) { const middle = (low + high) >>> 1; if (lines[middle] < start) low = middle + 1; else high = middle; }
  return low < lines.length && lines[low] <= end;
}

function analyze(revision, side, bundle) {
  const files = new Map(revision.sources.map(source => [root + source.path, source]));
  const options = { noLib: true, noEmit: true, target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.Preserve };
  const host = {
    getSourceFile: (path, version) => files.has(path) ? ts.createSourceFile(path, files.get(path).content, version, true) : undefined,
    getDefaultLibFileName: () => '', writeFile: () => {}, getCurrentDirectory: () => root,
    getDirectories: () => [], fileExists: path => files.has(path), readFile: path => files.get(path)?.content,
    directoryExists: path => [...files.keys()].some(file => file.startsWith(path.replace(/\/$/u, '') + '/')),
    getCanonicalFileName: path => path, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
  };
  const program = ts.createProgram([...files.keys()], options, host);
  const checker = program.getTypeChecker();
  const declarations = []; const candidates = []; const calls = []; const unresolvedImports = []; const diagnostics = [];
  let nodes = 0; let unresolvedCalls = 0;
  const canonical = symbol => symbol && (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
  const origin = (source, node) => {
    const file = files.get(source.fileName);
    const start = source.getLineAndCharacterOfPosition(node.getStart(source));
    const end = source.getLineAndCharacterOfPosition(node.end);
    return { commit: revision.commit, path: file.path, object: file.object,
      start: { line: start.line + 1, column: start.character + 1 }, end: { line: end.line + 1, column: end.character + 1 } };
  };
  for (const source of program.getSourceFiles()) {
    const file = files.get(source.fileName);
    const change = bundle.changes.find(change => change[side === 'old' ? 'oldPath' : 'newPath'] === file.path);
    const diff = change && bundle.evidence.find(item => item.id === change.evidenceIds[0]);
    const changed = diff ? [...changedLines(diff.content, side)].sort((a, b) => a - b) : [];
    for (const diagnostic of source.parseDiagnostics) diagnostics.push({ path: file.path, code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'), offset: diagnostic.start ?? 0 });
    const visit = node => {
      if (++nodes > 250_000) throw new SemanticError('SEMANTIC_LIMIT', 'AST exceeds 250000 nodes per revision.');
      if (supported(node) && change) {
        const location = origin(source, node);
        const names = [node.name.text]; let eligible = true;
        for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
          if (parent.name && ts.isIdentifier(parent.name)) names.unshift(parent.name.text);
          if (ts.isModuleDeclaration(parent) && !ts.isIdentifier(parent.name)) eligible = false;
          if (ts.isFunctionLike(parent) && !(parent.name && ts.isIdentifier(parent.name))) eligible = false;
          if (ts.isBlock(parent) && !ts.isFunctionLike(parent.parent)) eligible = false;
        }
        const value = { side, name: node.name.text, kind: ts.SyntaxKind[node.kind], origin: location,
          qualifiedName: names.join('.'), changeId: change.id, evidenceIds: change.evidenceIds };
        const candidate = { record: { id: `declaration:${hash(value)}`, ...value },
          symbol: canonical(checker.getSymbolAtLocation(node.name)), eligible };
        if (candidates.length >= 10000) throw new SemanticError('SEMANTIC_LIMIT', 'More than 10000 counterpart candidates per revision.');
        candidates.push(candidate);
        if (intersects(changed, location.start.line, location.end.line)) declarations.push(candidate);
      }
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        if (!ts.resolveModuleName(specifier, source.fileName, options, host).resolvedModule) unresolvedImports.push({ path: file.path, specifier });
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        if (calls.length + unresolvedCalls >= 10_000) throw new SemanticError('SEMANTIC_LIMIT', 'More than 10000 call sites per revision.');
        const symbol = canonical(checker.getSymbolAtLocation(node.expression));
        if (!symbol || !symbol.declarations?.some(declaration => files.has(declaration.getSourceFile().fileName))) unresolvedCalls++;
        else calls.push({ symbol, node, source });
      }
      ts.forEachChild(node, visit);
    };
    try { visit(source); }
    catch (error) {
      if (error instanceof RangeError) throw new SemanticError('SEMANTIC_LIMIT', 'TypeScript source exceeds safe traversal depth.');
      throw error;
    }
  }
  return { declarations, candidates, calls, origin, sourcePaths: new Set(revision.sources.map(source => source.path)), summary: { side, commit: revision.commit, sourceFiles: files.size,
    astNodes: nodes, resolvedCallSites: calls.length, unresolvedCallSites: unresolvedCalls, unresolvedImports, parseDiagnostics: diagnostics } };
}

// Matching is structural provenance, not a claim of semantic equivalence.
function linkCounterparts(analyses, bundle) {
  const [old, next] = analyses;
  const key = record => JSON.stringify([record.changeId, record.kind, record.qualifiedName]);
  const group = candidates => {
    const result = new Map();
    for (const candidate of candidates) { const id = key(candidate.record); if (!result.has(id)) result.set(id, []); result.get(id).push(candidate); }
    return result;
  };
  const oldGroups = group(old.candidates); const newGroups = group(next.candidates);
  const badOld = new Set(old.summary.parseDiagnostics.map(item => item.path));
  const badNew = new Set(next.summary.parseDiagnostics.map(item => item.path));
  const decisions = [];
  const changes = new Map(bundle.changes.map(change => [change.id, change]));
  const indexedNew = new Map(next.declarations.map(item => [item.record.id, item]));
  for (const changed of old.declarations) {
    const record = changed.record; const candidates = newGroups.get(key(record)) ?? [];
    let status; let newTargetId = null;
    if (changes.get(record.changeId)?.newPath !== null && !next.sourcePaths.has(changes.get(record.changeId)?.newPath)) status = 'source-unavailable';
    else if (badOld.has(record.origin.path) || badNew.has(changes.get(record.changeId)?.newPath)) status = 'parse-unavailable';
    else if (!changed.eligible || candidates.some(candidate => !candidate.eligible)) status = 'unsupported-scope';
    else if ((oldGroups.get(key(record))?.length ?? 0) !== 1 || candidates.length > 1) status = 'ambiguous';
    else if (!candidates.length) status = 'missing';
    else {
      const candidate = candidates[0];
      const indexed = indexedNew.get(candidate.record.id);
      if (indexed) { status = 'already-indexed'; newTargetId = indexed.record.id; }
      else {
        const { id, ...payload } = candidate.record;
        const value = { ...payload, basis: 'structural-counterpart', counterpartOf: record.id };
        const counterpart = { ...candidate, record: { id: `declaration:${hash(value)}`, ...value } };
        next.declarations.push(counterpart); indexedNew.set(candidate.record.id, counterpart); status = 'matched'; newTargetId = counterpart.record.id;
      }
    }
    decisions.push({ oldTargetId: record.id, status, newTargetId });
  }
  return decisions.sort((a, b) => a.oldTargetId < b.oldTargetId ? -1 : a.oldTargetId > b.oldTargetId ? 1 : 0);
}

export async function expandTypeScriptContext(repo, bundle, input = []) {
  const requested = requests(input);
  const revisions = await readTypeScriptSources(repo, [bundle.provenance.revisions.effectiveBaseCommit, bundle.provenance.revisions.headCommit]);
  const analyses = revisions.map((revision, index) => analyze(revision, index === 0 ? 'old' : 'new', bundle));
  const counterparts = linkCounterparts(analyses, bundle);
  const declarations = analyses.flatMap(item => item.declarations.map(declaration => declaration.record));
  for (const request of requested) if (!declarations.some(item => item.id === request.targetId)) fail('Unknown or stale targetId; regenerate semantic declarations using pinned revisions.');
  const evidence = []; const decisions = []; let bytes = 0;
  for (const request of requested) {
    const analysis = analyses.find(item => item.declarations.some(declaration => declaration.record.id === request.targetId));
    const target = analysis.declarations.find(item => item.record.id === request.targetId);
    const matches = [];
    for (const call of analysis.calls.filter(call => target.symbol && (call.symbol === target.symbol ||
      call.symbol.declarations?.some(node => target.symbol.declarations?.includes(node))))) {
      let snippet = call.node;
      for (let ancestor = call.node.parent; ancestor && !ts.isSourceFile(ancestor); ancestor = ancestor.parent) {
        snippet = ancestor;
        if (ts.isFunctionLike(ancestor) || ts.isStatement(ancestor)) break;
      }
      const content = snippet.getText(call.source);
      const record = { type: 'typescript-source', origin: analysis.origin(call.source, snippet), content };
      const id = `evidence:${hash(record)}`;
      let reason = null;
      if (!evidence.some(item => item.id === id)) {
        const size = Buffer.byteLength(JSON.stringify({ id, ...record }));
        if (record.origin.end.line - record.origin.start.line + 1 > 80) reason = 'snippet-line-limit';
        else if (evidence.length >= 10) reason = 'snippet-count-limit';
        else if (bytes + size > 64 * 1024) reason = 'context-byte-limit';
        else { evidence.push({ id, ...record }); bytes += size; }
      }
      matches.push({ origin: analysis.origin(call.source, call.node), evidenceId: reason ? null : id, omission: reason });
    }
    decisions.push({ ...request, status: matches.some(item => item.omission) ? 'partial' : 'complete-static-matches', matches });
  }
  return {
    semanticAnalysis: { schemaVersion: 'typescript-analysis/v2', compilerVersion: ts.version,
      policy: { sources: 'committed-regular-typescript-files', configuration: 'fixed-esnext-bundler-noLib',
        maxFilesPerRevision: 1000, maxUniqueSourceBytes: 8 * 1024 * 1024, maxFileBytes: 512 * 1024,
        maxAstNodesPerRevision: 250_000, maxCallSitesPerRevision: 10_000, maxCounterpartCandidatesPerRevision: 10000,
        counterparts: 'unique-same-change-kind-qualified-name', counterpartMeaning: 'structural-not-semantic-equivalence' },
      revisions: analyses.map(item => item.summary), declarations, counterparts },
    contextExpansion: { schemaVersion: 'caller-context/v1', policy: { maxRequests: 50, maxSnippets: 10, maxLinesPerSnippet: 80, maxBytes: 64 * 1024 },
      decisions, serializedEvidenceBytes: bytes }, evidence,
  };
}

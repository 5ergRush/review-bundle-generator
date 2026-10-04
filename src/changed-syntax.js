import ts from 'typescript';
import { posix } from 'node:path';

export const SYNTAX_COMPILER_VERSION = ts.version;

// Bounded syntactic observations from patch context. No source execution or I/O.
export function observeChangedSyntax(change, evidence, tick, contextual = false) {
  if (![change.oldPath, change.newPath].filter(Boolean).every(path => posix.extname(path) === '.ts') || change.coverage !== 'text-diff') return { available: false, observations: [] };
  const patches = change.evidenceIds.map(id => evidence.find(item => item.id === id));
  if (patches.some(item => !item || item.type !== 'git-patch')) return { available: false, observations: [] };
  const observations = []; let available = true;
  for (const patch of patches) {
    const hunks = []; let hunk;
    for (const line of patch.content.split('\n')) {
      tick();
      if (line.startsWith('@@ ')) { const coordinates = /^@@ -(\d+)(?:,\d+)? \+(\d+)/u.exec(line); hunk = { oldStart: Number(coordinates?.[1]), newStart: Number(coordinates?.[2]), old: [], new: [], removed: new Set(), added: new Set() }; hunks.push(hunk); }
      else if (hunk && [' ', '+', '-'].includes(line[0])) {
        if (line[0] !== '+') { if (line[0] === '-') hunk.removed.add(hunk.old.length); hunk.old.push(line.slice(1)); }
        if (line[0] !== '-') { if (line[0] === '+') hunk.added.add(hunk.new.length); hunk.new.push(line.slice(1)); }
      }
    }
    for (let index = 0; index < hunks.length; index++) {
      const item = hunks[index]; const parsed = {};
      for (const side of ['old', 'new']) {
        const text = item[side].join('\n');
        if (Buffer.byteLength(text) > 128 * 1024) { available = false; break; }
        let file;
        try { file = ts.createSourceFile('patch.ts', text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS); } catch { available = false; break; }
        if (file.parseDiagnostics.length) { available = false; break; }
        const tokens = []; const lexical = [file]; let lexicalNodes = 0;
        while (lexical.length) {
          tick(); if (++lexicalNodes > 25000) { available = false; break; }
          const tokenNode = lexical.pop(); const children = tokenNode.getChildren(file);
          if (children.length) { for (let i = children.length - 1; i >= 0; i--) lexical.push(children[i]); }
          else if (tokenNode.kind >= ts.SyntaxKind.FirstToken && tokenNode.kind <= ts.SyntaxKind.LastToken && tokenNode.kind !== ts.SyntaxKind.EndOfFileToken) {
            tokens.push({ start: tokenNode.getStart(file), end: tokenNode.end, value: tokenNode.getText(file) });
          }
        }
        if (lexicalNodes > 25000) break;
        const nodes = []; const queue = [file]; let count = 0;
        while (queue.length) {
          tick(); if (++count > 25000) { available = false; break; }
          const node = queue.pop();
          const children = []; ts.forEachChild(node, child => { children.push(child); }); queue.push(...children);
          let kind; let condition; let callee = null; let target = null;
          if (ts.isIfStatement(node) && !node.elseStatement) {
            const body = ts.isBlock(node.thenStatement) ? node.thenStatement.statements : [node.thenStatement];
            if (body.length === 1 && ts.isThrowStatement(body[0])) { kind = 'throw-guard'; condition = node.expression; }
          } else if (ts.isCallExpression(node)) {
            const names = []; let expression = node.expression;
            while (ts.isPropertyAccessExpression(expression)) { names.unshift(expression.name.text); expression = expression.expression; }
            if (ts.isIdentifier(expression)) { names.unshift(expression.text); callee = names.join('.'); kind = 'call'; condition = node; }
            else if (contextual && expression.kind === ts.SyntaxKind.ThisKeyword && names.length) { callee = ['this', ...names].join('.'); kind = 'member-call'; condition = node; }
          }
          if (contextual && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            const names = []; let expression = node.left;
            while (ts.isPropertyAccessExpression(expression)) { names.unshift(expression.name.text); expression = expression.expression; }
            if (expression.kind === ts.SyntaxKind.ThisKeyword && names.length) { kind = 'assignment'; target = ['this', ...names].join('.'); condition = node; }
          }
          if (!kind) continue;
          let within = null; let withinPosition = null;
          if (contextual) for (let parent = node.parent; parent; parent = parent.parent) {
            if (ts.isFunctionLike(parent)) { within = parent.name && ts.isIdentifier(parent.name) ? parent.name.text : null; withinPosition = within ? parent.name.getStart(file) : null; break; }
          }
          const identifiers = new Set(); const pending = [condition];
          while (pending.length) { tick(); const part = pending.pop(); if (ts.isIdentifier(part)) identifiers.add(part.text); ts.forEachChild(part, child => { pending.push(child); }); }
          const start = node.getStart(file); const end = node.end;
          // Tokens exclude comments/trivia; tokens are compared across revisions,
          // and a qualifying token must occupy an actual edited line.
          const included = tokens.filter(t => { tick(); return t.start >= start && t.end <= end; });
          const edited = item[side === 'old' ? 'removed' : 'added'];
          let touched = included.some(t => {
            const first = file.getLineAndCharacterOfPosition(t.start).line; const last = file.getLineAndCharacterOfPosition(t.end - 1).line;
            for (let line = first; line <= last; line++) { tick(); if (edited.has(line)) return true; } return false;
          });
          if (contextual && withinPosition !== null && edited.has(file.getLineAndCharacterOfPosition(withinPosition).line)) touched = true;
          const startLine = file.getLineAndCharacterOfPosition(start).line + item[side === 'old' ? 'oldStart' : 'newStart'];
          const endLine = file.getLineAndCharacterOfPosition(end - 1).line + item[side === 'old' ? 'oldStart' : 'newStart'];
          nodes.push({ ...(contextual ? { within, withinLine: withinPosition === null ? null : file.getLineAndCharacterOfPosition(withinPosition).line + item[side === 'old' ? 'oldStart' : 'newStart'], ...(target ? { target } : {}) } : {}), startLine, endLine, kind, identifiers: [...identifiers].sort(), callee, fingerprint: JSON.stringify(included.map(t => t.value)), touched });
        }
        if (count > 25000) break;
        parsed[side] = nodes;
      }
      if (!parsed.old || !parsed.new) continue;
      for (const side of ['old', 'new']) {
        const oppositeCounts = new Map();
        for (const node of parsed[side === 'old' ? 'new' : 'old']) { tick(); const key = node.kind + (contextual ? JSON.stringify(node.within) : '') + node.fingerprint; oppositeCounts.set(key, (oppositeCounts.get(key) ?? 0) + 1); }
        // Pair unchanged observations first, then account for duplicate removals.
        for (const node of [...parsed[side]].sort((a, b) => Number(a.touched) - Number(b.touched))) {
          tick(); const key = node.kind + (contextual ? JSON.stringify(node.within) : '') + node.fingerprint; const count = oppositeCounts.get(key) ?? 0;
          if (count) { oppositeCounts.set(key, count - 1); continue; }
          if (node.touched) observations.push({ ...(contextual ? { within: node.within, withinLine: node.withinLine, ...(node.target ? { target: node.target } : {}) } : {}), kind: node.kind, identifiers: node.identifiers, callee: node.callee,
            side: side === 'old' ? 'removed' : 'added', evidenceId: patch.id, hunkIndex: index, startLine: node.startLine, endLine: node.endLine });
        }
      }
    }
  }
  return { available, observations };
}

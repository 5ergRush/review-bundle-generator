import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { ingestGitDiff } from './git.js';

const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const DEFAULT_BUNDLE_BYTES = 16 * 1024 * 1024;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const oid = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value);

export class BundleError extends Error {
  constructor(code, message) { super(message); this.name = 'BundleError'; this.code = code; }
}

function requireCondition(condition, message) {
  if (!condition) throw new BundleError('INVALID_SNAPSHOT', message);
}

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function path(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0') &&
    !value.startsWith('/') && !value.split('/').some(part => part === '..' || part === '.' || !part);
}
function kind(mode) { return mode === '000000' ? null : mode === '160000' ? 'gitlink' : mode === '120000' ? 'symlink' : 'file'; }

function normalizeSnapshot(input) {
  requireCondition(object(input) && input.schemaVersion === 'git-ingestion/v1', 'Expected git-ingestion/v1 snapshot.');
  const { tool, revisions: r, policy: p, changes, patch, limitations } = input;
  requireCondition(object(tool) && typeof tool.gitVersion === 'string' && /^git version \d+\.\d+/u.test(tool.gitVersion) && tool.gitVersion.length < 200, 'Missing Git version.');
  requireCondition(object(r) && [r.requestedBaseCommit, r.effectiveBaseCommit, r.headCommit].every(oid) &&
    ['direct', 'merge-base'].includes(r.comparison), 'Invalid revision provenance.');
  requireCondition(r.comparison !== 'direct' || r.requestedBaseCommit === r.effectiveBaseCommit, 'Direct comparison has inconsistent base commits.');
  requireCondition([r.requestedBaseCommit, r.effectiveBaseCommit].every(value => value.length === r.headCommit.length), 'Mixed Git object formats.');
  requireCondition(object(p) && p.committedChangesOnly === true && p.repositoryConfigIsolated === true &&
    p.attributesCommit === r.headCommit && p.diffAlgorithm === 'myers' && p.contextLines === 3 &&
    p.renameSimilarityPercent === 50 && p.renameCandidateLimit === 1000 &&
    Number.isSafeInteger(p.maxBytes) && p.maxBytes > 0 && p.maxBytes <= MAX_INPUT_BYTES, 'Unsupported ingestion policy.');
  requireCondition(typeof patch === 'string' && Buffer.byteLength(patch) <= p.maxBytes, 'Invalid or oversized patch.');
  requireCondition(Array.isArray(changes) && changes.length <= 10000, 'Invalid change list or more than 10000 changes.');
  requireCondition(Array.isArray(limitations) && limitations.length <= 100 &&
    limitations.every(x => typeof x === 'string' && x.length <= 1000), 'Invalid limitations.');
  const seen = new Set();
  const normalized = changes.map(c => {
    requireCondition(object(c) && ['A', 'M', 'D', 'R', 'T'].includes(c.status), 'Unsupported change status.');
    requireCondition(c.oldPath === null || path(c.oldPath), 'Invalid old path.');
    requireCondition(c.newPath === null || path(c.newPath), 'Invalid new path.');
    requireCondition((c.status === 'A' ? c.oldPath === null && path(c.newPath) :
      c.status === 'D' ? c.newPath === null && path(c.oldPath) : path(c.oldPath) && path(c.newPath)), 'Paths do not match status.');
    requireCondition(c.status === 'R' ? c.oldPath !== c.newPath && Number.isInteger(c.similarity) && c.similarity >= 0 && c.similarity <= 100 :
      c.similarity === null && (['A', 'D'].includes(c.status) || c.oldPath === c.newPath), 'Invalid rename metadata.');
    for (const side of ['old', 'new']) {
      const mode = c[`${side}Mode`], blob = c[`${side}Object`];
      requireCondition(['000000', '100644', '100755', '120000', '160000'].includes(mode), 'Invalid entry mode.');
      requireCondition(c[`${side}Kind`] === kind(mode), 'Entry kind does not match mode.');
      requireCondition(mode === '000000' ? blob === null && c[`${side}Path`] === null : oid(blob) && blob.length === r.headCommit.length && path(c[`${side}Path`]), 'Invalid object provenance.');
    }
    requireCondition(c.status === 'A' ? c.oldMode === '000000' : c.oldMode !== '000000', 'Invalid old entry.');
    requireCondition(c.status === 'D' ? c.newMode === '000000' : c.newMode !== '000000', 'Invalid new entry.');
    const key = c.newPath ?? c.oldPath;
    requireCondition(!seen.has(key), 'Duplicate change path.'); seen.add(key);
    return { status: c.status, similarity: c.similarity, oldPath: c.oldPath, newPath: c.newPath,
      oldMode: c.oldMode, newMode: c.newMode, oldObject: c.oldObject, newObject: c.newObject,
      oldKind: c.oldKind, newKind: c.newKind };
  }).sort((a, b) => compare(a.newPath ?? a.oldPath, b.newPath ?? b.oldPath));
  return { tool: { gitVersion: tool.gitVersion }, revisions: {
    requestedBaseCommit: r.requestedBaseCommit, effectiveBaseCommit: r.effectiveBaseCommit,
    headCommit: r.headCommit, comparison: r.comparison }, policy: {
    renameSimilarityPercent: p.renameSimilarityPercent, renameCandidateLimit: p.renameCandidateLimit,
    contextLines: p.contextLines, attributesCommit: p.attributesCommit,
    repositoryConfigIsolated: true, diffAlgorithm: p.diffAlgorithm, maxBytes: p.maxBytes, committedChangesOnly: true },
  changes: normalized, patch, limitations: [...new Set(limitations)].sort(compare) };
}

// Git core.quotePath=true uses C escapes and octal UTF-8 bytes in diff headers.
function quotePath(value) {
  const bytes = Buffer.from(value);
  if (!bytes.some(b => b < 32 || b >= 127 || b === 34 || b === 92)) return value;
  const escapes = new Map([[7, '\\a'], [8, '\\b'], [9, '\\t'], [10, '\\n'], [11, '\\v'],
    [12, '\\f'], [13, '\\r'], [34, '\\"'], [92, '\\\\']]);
  return '"' + [...bytes].map(b => escapes.get(b) ?? (b < 32 || b >= 127 ? `\\${b.toString(8).padStart(3, '0')}` : String.fromCharCode(b))).join('') + '"';
}

function header(c) {
  return `diff --git ${quotePath(`a/${c.oldPath ?? c.newPath}`)} ${quotePath(`b/${c.newPath ?? c.oldPath}`)}`;
}

function splitPatches(snapshot) {
  const byHeader = new Map(snapshot.changes.map(c => [header(c), c]));
  const result = new Map();
  const starts = [...snapshot.patch.matchAll(/^diff --git .*$/gm)];
  requireCondition(snapshot.patch === '' ? snapshot.changes.length === 0 : starts[0]?.index === 0, 'Patch has missing headers or unmatched changes.');
  for (let i = 0; i < starts.length; i++) {
    const c = byHeader.get(starts[i][0]);
    requireCondition(c, 'Patch header does not match change provenance.');
    const key = c.newPath ?? c.oldPath;
    const section = snapshot.patch.slice(starts[i].index, starts[i + 1]?.index ?? snapshot.patch.length);
    // Type changes may have a deletion and addition section for the same path.
    const sections = result.get(key) ?? [];
    requireCondition(sections.length === 0 || c.status === 'T', 'Duplicate patch section.');
    sections.push(section); result.set(key, sections);
  }
  requireCondition(result.size === snapshot.changes.length, 'Patch is missing evidence for a changed file.');
  return result;
}

function parseSection(section) {
  const lines = section.split('\n');
  const hunks = [];
  let current = null, consumedOld = 0, consumedNew = 0, addedLines = 0, removedLines = 0;
  let binary = false;
  const finish = () => {
    if (current) requireCondition(consumedOld === current.old.lines && consumedNew === current.new.lines, 'Hunk counts do not match patch content.');
  };
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith('@@ ')) {
      finish();
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:[\s\S]*)$/u.exec(line);
      requireCondition(match, 'Malformed hunk header.');
      const numbers = [Number(match[1]), Number(match[2] ?? 1), Number(match[3]), Number(match[4] ?? 1)];
      requireCondition(numbers.every(Number.isSafeInteger), 'Hunk range exceeds safe integers.');
      current = { old: { start: numbers[0], lines: numbers[1] }, new: { start: numbers[2], lines: numbers[3] } };
      requireCondition((current.old.lines === 0 || current.old.start > 0) && (current.new.lines === 0 || current.new.start > 0), 'Invalid hunk coordinates.');
      hunks.push(current); consumedOld = 0; consumedNew = 0;
    } else if (current) {
      if (line === '\\ No newline at end of file') continue;
      if (line === '' && index === lines.length - 1) continue;
      requireCondition([' ', '+', '-'].includes(line[0]), 'Malformed hunk content.');
      if (line[0] === ' ' || line[0] === '-') consumedOld++;
      if (line[0] === ' ' || line[0] === '+') consumedNew++;
      if (line[0] === '+') addedLines++;
      if (line[0] === '-') removedLines++;
      requireCondition(consumedOld <= current.old.lines && consumedNew <= current.new.lines, 'Hunk contains excess lines.');
    } else if (line.startsWith('Binary files ') && line.endsWith(' differ')) binary = true;
  }
  finish();
  return { hunks, addedLines, removedLines, binary };
}

const languageHints = new Map([['.ts', 'typescript'], ['.tsx', 'typescript'], ['.js', 'javascript'],
  ['.jsx', 'javascript'], ['.mjs', 'javascript'], ['.html', 'html'], ['.scss', 'scss'],
  ['.css', 'css'], ['.json', 'json'], ['.vue', 'vue'], ['.yml', 'yaml'], ['.yaml', 'yaml']]);

/** Compile bounded, deterministic facts and evidence; this performs no AI calls. */
export function compileReviewBundle(input, options = {}) {
  if (!object(options) || Object.keys(options).some(key => key !== 'maxBundleBytes')) {
    throw new BundleError('INVALID_INPUT', 'Expected options with optional maxBundleBytes.');
  }
  const maxBundleBytes = options.maxBundleBytes ?? DEFAULT_BUNDLE_BYTES;
  if (!Number.isSafeInteger(maxBundleBytes) || maxBundleBytes < 1 || maxBundleBytes > MAX_INPUT_BYTES) {
    throw new BundleError('INVALID_INPUT', `maxBundleBytes must be from 1 to ${MAX_INPUT_BYTES}.`);
  }
  const snapshot = normalizeSnapshot(input);
  const sections = splitPatches(snapshot);
  const changes = [], evidence = [], facts = [];
  let addedLines = 0, removedLines = 0, binaryFiles = 0, specialEntries = 0;
  for (const change of snapshot.changes) {
    const changeId = `change:${hash(change)}`;
    const patches = sections.get(change.newPath ?? change.oldPath);
    const analysis = patches.map(parseSection);
    const binary = analysis.some(a => a.binary);
    const special = [change.oldKind, change.newKind].some(k => ['symlink', 'gitlink'].includes(k));
    const hunks = analysis.flatMap(a => a.hunks);
    const added = analysis.reduce((sum, a) => sum + a.addedLines, 0);
    const removed = analysis.reduce((sum, a) => sum + a.removedLines, 0);
    const content = patches.join('');
    const origin = { old: change.oldPath === null ? null : { commit: snapshot.revisions.effectiveBaseCommit, path: change.oldPath, object: change.oldObject },
      new: change.newPath === null ? null : { commit: snapshot.revisions.headCommit, path: change.newPath, object: change.newObject } };
    const record = { type: 'git-patch', changeId, origin, content, hunks };
    const evidenceId = `evidence:${hash(record)}`;
    evidence.push({ id: evidenceId, ...record });
    const coverage = binary ? 'binary-omitted' : special ? 'special-entry' : hunks.length ? 'text-diff' : 'metadata-only';
    changes.push({ id: changeId, ...change, evidenceIds: [evidenceId], coverage });
    const addFact = (type, value) => {
      const fact = { type, changeId, evidenceIds: [evidenceId], value };
      facts.push({ id: `fact:${hash(fact)}`, ...fact });
    };
    addFact('file-change', { status: change.status, oldPath: change.oldPath, newPath: change.newPath,
      oldKind: change.oldKind, newKind: change.newKind, modeChanged: change.oldMode !== change.newMode });
    if (!binary && !special) {
      addFact('text-change', { addedLines: added, removedLines: removed, hunkCount: hunks.length });
      addedLines += added; removedLines += removed;
    }
    const extension = posix.extname(change.newPath ?? change.oldPath).toLowerCase();
    addFact('path-hint', { extension, language: languageHints.get(extension) ?? null, basis: 'filename-only' });
    if (binary) binaryFiles++;
    if (special) specialEntries++;
  }
  const payload = {
    schemaVersion: 'review-bundle/v1',
    provenance: { ingestionSchemaVersion: 'git-ingestion/v1', tool: snapshot.tool,
      revisions: snapshot.revisions, policy: snapshot.policy },
    summary: { changedFiles: changes.length, addedLines, removedLines, binaryFiles, specialEntries,
      textCountsExcludeBinaryAndSpecialEntries: true },
    changes, evidence, facts,
    coverage: { status: 'partial', stages: { gitDiff: 'complete', deterministicFacts: 'complete',
      semanticAnalysis: 'not-run', ruleSelection: 'not-run', contextExpansion: 'not-run' },
    limitations: [...new Set([...snapshot.limitations,
      'Facts describe Git changes; they are not defect findings or semantic correctness claims.',
      'Language hints come only from filenames.',
      'Semantic analysis, rule selection and adaptive context have not run.'])].sort(compare) },
  };
  const bundle = { id: `bundle:${hash(payload)}`, ...payload };
  if (Buffer.byteLength(JSON.stringify(bundle)) > maxBundleBytes) {
    throw new BundleError('BUNDLE_LIMIT', `Serialized bundle exceeds maxBundleBytes (${maxBundleBytes}); no partial bundle returned.`);
  }
  return bundle;
}

export async function createReviewBundle(options) {
  if (!object(options)) throw new BundleError('INVALID_INPUT', 'An options object is required.');
  const { maxBundleBytes, ...gitOptions } = options;
  return compileReviewBundle(await ingestGitDiff(gitOptions), { maxBundleBytes });
}

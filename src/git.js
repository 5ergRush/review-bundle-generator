import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { devNull, tmpdir } from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const run = promisify(execFile);
const decoder = new TextDecoder('utf-8', { fatal: true });
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const MAX_ALLOWED_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export class IngestionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IngestionError';
    this.code = code;
  }
}

function positiveInteger(value, name, ceiling) {
  if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) {
    throw new IngestionError('INVALID_INPUT', `${name} must be an integer from 1 to ${ceiling}.`);
  }
  return value;
}

function revision(value, name) {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.startsWith('-') || /[\x00-\x1f\x7f]/u.test(value)) {
    throw new IngestionError('INVALID_INPUT', `${name} must be a nonempty Git revision without control characters or a leading dash.`);
  }
  return value;
}

function decode(bytes, label) {
  try { return decoder.decode(bytes); }
  catch { throw new IngestionError('UNSUPPORTED_ENCODING', `${label} is not valid UTF-8; ingestion stopped without replacement characters.`); }
}

// Repository-local hooks, external diff drivers and textconv are never executed.
// Remove inherited Git location/config variables so the supplied checkout wins.
function gitEnvironment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull,
    GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1',
    GIT_ATTR_NOSYSTEM: '1', LC_ALL: 'C' };
}

async function git(cwd, args, limits, errorCode = 'GIT_FAILED', attributeSource) {
  try {
    const result = await run('git', [...(attributeSource ? [`--attr-source=${attributeSource}`] : []),
      '-c', `core.attributesFile=${devNull}`, '-c', 'core.quotePath=true', '-c', 'color.ui=false',
      '-c', 'diff.algorithm=myers', '-c', 'diff.indentHeuristic=false', ...args], {
      cwd, env: gitEnvironment(), encoding: 'buffer', maxBuffer: limits.maxBytes,
      timeout: limits.timeoutMs, windowsHide: true,
    });
    return result.stdout;
  } catch (error) {
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw new IngestionError('OUTPUT_LIMIT', `Git output exceeds maxBytes (${limits.maxBytes}); no partial result returned.`);
    }
    if (error.killed || error.signal) {
      throw new IngestionError('TIMEOUT', `Git command did not complete within timeoutMs (${limits.timeoutMs}).`);
    }
    if (error.code === 'ENOENT') {
      throw new IngestionError('GIT_UNAVAILABLE', 'Git executable or repository directory is unavailable.');
    }
    // Git stderr can echo arbitrary private paths or revision strings; keep errors bounded and stable.
    throw new IngestionError(errorCode, 'Git could not read the requested repository or commit range.');
  }
}

// Isolate diff behavior from checkout configuration, info/attributes, replace refs,
// and dirty .gitattributes. Reuse objects read-only through Git alternates.
async function isolatedObjects(source, limits, operation) {
  const objectFormat = decode(await git(source, ['rev-parse', '--show-object-format'], limits), 'Object format').trim();
  if (!['sha1', 'sha256'].includes(objectFormat)) throw new IngestionError('GIT_FAILED', 'Unsupported Git object format.');
  const objectDirectory = decode(await git(source, ['rev-parse', '--path-format=absolute', '--git-path', 'objects'], limits), 'Object directory').replace(/\r?\n$/u, '');
  if (/[\r\n]/u.test(objectDirectory)) throw new IngestionError('INVALID_REPOSITORY', 'Repository object directory must not contain newlines.');
  const shallowPath = decode(await git(source, ['rev-parse', '--path-format=absolute', '--git-path', 'shallow'], limits), 'Shallow path').replace(/\r?\n$/u, '');
  const temporary = await mkdtemp(join(tmpdir(), 'review-git-'));
  try {
    await git(temporary, ['init', '--bare', '--quiet', '--template=', `--object-format=${objectFormat}`], limits);
    await mkdir(join(temporary, 'objects', 'info'), { recursive: true });
    // Forward slashes are valid on Windows and avoid Git alternates backslash ambiguity.
    await writeFile(join(temporary, 'objects', 'info', 'alternates'), `${objectDirectory.replaceAll('\\', '/')}\n`);
    try { await writeFile(join(temporary, 'shallow'), await readFile(shallowPath)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return await operation(temporary);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

async function commit(cwd, ref, limits) {
  const value = decode(await git(cwd, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], limits, 'INVALID_REVISION'), 'Commit ID').trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value)) {
    throw new IngestionError('GIT_FAILED', 'Git returned an invalid commit ID.');
  }
  return value;
}

function entryKind(mode) {
  return mode === '000000' ? null : mode === '160000' ? 'gitlink' : mode === '120000' ? 'symlink' : 'file';
}

function parseChanges(raw) {
  const fields = decode(raw, 'Changed paths').split('\0');
  if (fields.pop() !== '') throw new IngestionError('GIT_FAILED', 'Malformed Git change metadata.');
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const header = fields[index++];
    const match = /^:([0-7]{6}) ([0-7]{6}) ([a-f0-9]{40}|[a-f0-9]{64}) ([a-f0-9]{40}|[a-f0-9]{64}) ([AMDRT])(\d*)$/u.exec(header);
    if (!match) throw new IngestionError('GIT_FAILED', 'Unsupported or malformed Git change metadata.');
    const [, oldMode, newMode, oldObject, newObject, status, score] = match;
    const path = fields[index++];
    const nextPath = status === 'R' ? fields[index++] : path;
    if (!path || !nextPath) throw new IngestionError('GIT_FAILED', 'Missing path in Git change metadata.');
    changes.push({ status, similarity: score ? Number(score) : null,
      oldPath: status === 'A' ? null : path, newPath: status === 'D' ? null : nextPath,
      oldMode, newMode, oldObject: /^0+$/u.test(oldObject) ? null : oldObject,
      newObject: /^0+$/u.test(newObject) ? null : newObject,
      oldKind: entryKind(oldMode), newKind: entryKind(newMode),
    });
  }
  // Locale-independent ordering makes serializations stable across machines.
  return changes.sort((a, b) => {
    const left = a.newPath ?? a.oldPath;
    const right = b.newPath ?? b.oldPath;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/**
 * Read committed changes only. Working-tree/index changes are excluded.
 * maxBytes bounds each Git output and their aggregate raw + patch bytes.
 * This is an ingestion snapshot, not a compiled reviewer bundle.
 */
export async function ingestGitDiff(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new IngestionError('INVALID_INPUT', 'An options object is required.');
  }
  const { repo, base, head = 'HEAD', comparison = 'merge-base',
    maxBytes = DEFAULT_MAX_BYTES, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  if (typeof repo !== 'string' || !repo || repo.includes('\0')) {
    throw new IngestionError('INVALID_INPUT', 'repo must be a nonempty local directory path.');
  }
  revision(base, 'base'); revision(head, 'head');
  if (!['direct', 'merge-base'].includes(comparison)) {
    throw new IngestionError('INVALID_INPUT', 'comparison must be direct or merge-base.');
  }
  const limits = { maxBytes: positiveInteger(maxBytes, 'maxBytes', MAX_ALLOWED_BYTES),
    timeoutMs: positiveInteger(timeoutMs, 'timeoutMs', 300_000) };
  const gitVersion = decode(await git(resolve(repo), ['--version'], limits), 'Git version').trim();
  const version = /^git version (\d+)\.(\d+)/u.exec(gitVersion);
  if (!version || Number(version[1]) < 2 || (Number(version[1]) === 2 && Number(version[2]) < 43)) {
    throw new IngestionError('UNSUPPORTED_GIT_VERSION', 'Git 2.43 or newer is required for pinned attribute handling.');
  }
  const repositoryRoot = decode(await git(resolve(repo), ['rev-parse', '--show-toplevel'], limits, 'INVALID_REPOSITORY'), 'Repository root').replace(/\r?\n$/u, '');
  const requestedBaseCommit = await commit(repositoryRoot, base, limits);
  const headCommit = await commit(repositoryRoot, head, limits);
  return isolatedObjects(repositoryRoot, limits, async (snapshotRepo) => {
    let effectiveBaseCommit = requestedBaseCommit;
    if (comparison === 'merge-base') {
      const bases = decode(await git(snapshotRepo, ['merge-base', '--all', requestedBaseCommit, headCommit], limits, 'NO_MERGE_BASE'), 'Merge base').trim().split('\n');
      if (bases.length !== 1 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(bases[0])) {
        throw new IngestionError('AMBIGUOUS_MERGE_BASE', 'Expected one merge base; use a direct comparison with an explicit base commit.');
      }
      effectiveBaseCommit = bases[0];
    }
    const diffArgs = ['diff', '--no-ext-diff', '--no-textconv', '--no-color',
      '--find-renames=50%', '-l1000', '--diff-algorithm=myers', '--no-indent-heuristic',
      '--ignore-submodules=none', `-O${devNull}`];
    const raw = await git(snapshotRepo, [...diffArgs, '--raw', '-z', '--no-abbrev', effectiveBaseCommit, headCommit, '--'], limits, 'GIT_FAILED', headCommit);
    const patchBytes = await git(snapshotRepo, [...diffArgs, '--patch', '--unified=3', '--src-prefix=a/', '--dst-prefix=b/',
      effectiveBaseCommit, headCommit, '--'], limits, 'GIT_FAILED', headCommit);
    if (raw.length + patchBytes.length > maxBytes) {
      throw new IngestionError('OUTPUT_LIMIT', `Combined metadata and patch exceed maxBytes (${maxBytes}); no partial result returned.`);
    }
    const changes = raw.length ? parseChanges(raw) : [];
    const patch = decode(patchBytes, 'Patch');
    return {
      schemaVersion: 'git-ingestion/v1',
      tool: { gitVersion },
      revisions: { requestedBaseCommit, effectiveBaseCommit, headCommit, comparison },
      policy: { renameSimilarityPercent: 50, renameCandidateLimit: 1000, contextLines: 3,
        attributesCommit: headCommit, repositoryConfigIsolated: true,
        diffAlgorithm: 'myers', maxBytes, committedChangesOnly: true },
      changes, patch,
      limitations: ['Binary blob contents are not included in patches.',
        'Symlinks and gitlinks are recorded as entries; their targets are not traversed.',
        'Rename detection is heuristic and exhaustive detection is capped at 1000 candidates.',
        'Invalid UTF-8 paths or patch bytes cause an explicit failure.'],
    };
  });
}

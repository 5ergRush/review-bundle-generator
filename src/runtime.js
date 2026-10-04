import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { IngestionError } from './git.js';

export async function checkRuntime() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new IngestionError('UNSUPPORTED_NODE', 'Node 22 or newer is required.');
  let version;
  try {
    const result = await promisify(execFile)('git', ['--version'], { encoding: 'utf8', timeout: 3000, maxBuffer: 4096,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))) });
    version = result.stdout.trim();
  } catch { throw new IngestionError('GIT_UNAVAILABLE', 'Git version could not be checked within the runtime bounds.'); }
  const match = /^git version (\d+)\.(\d+)\.(\d+)(?:[. -].*)?$/u.exec(version);
  if (!match || Number(match[1]) < 2 || (Number(match[1]) === 2 && Number(match[2]) < 43)) {
    throw new IngestionError('UNSUPPORTED_GIT', 'Git 2.43 or newer is required.');
  }
  return { schemaVersion: 'review-runtime/v1', status: 'runtime-ready', nodeVersion: process.version, gitVersion: version,
    requirements: { node: '>=22', git: '>=2.43.0' } };
}

#!/usr/bin/env node
import { ingestGitDiff, IngestionError } from './index.js';

const help = `Usage: review-bundle ingest --repo PATH --base REV [--head REV]
  [--comparison merge-base|direct] [--max-bytes N] [--timeout-ms N]

Writes a git-ingestion/v1 JSON snapshot to stdout; errors go to stderr.
Default head: HEAD. Default comparison: merge-base. Only committed changes.
This command does not yet compile a reviewer bundle or call an AI reviewer.
`;

async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(help); return;
  }
  if (args.shift() !== 'ingest') throw new IngestionError('INVALID_INPUT', 'Expected ingest. Use --help for usage.');
  const names = new Map([['--repo', 'repo'], ['--base', 'base'], ['--head', 'head'],
    ['--comparison', 'comparison'], ['--max-bytes', 'maxBytes'], ['--timeout-ms', 'timeoutMs']]);
  const options = {};
  while (args.length) {
    const flag = args.shift();
    const key = names.get(flag);
    if (!key || Object.hasOwn(options, key)) throw new IngestionError('INVALID_INPUT', `Unknown or duplicate option: ${flag}`);
    const value = args.shift();
    if (!value || value.startsWith('--')) throw new IngestionError('INVALID_INPUT', `Missing value for ${flag}`);
    if (['maxBytes', 'timeoutMs'].includes(key) && !/^[0-9]+$/u.test(value)) {
      throw new IngestionError('INVALID_INPUT', `${flag} requires a positive integer.`);
    }
    options[key] = ['maxBytes', 'timeoutMs'].includes(key) ? Number(value) : value;
  }
  process.stdout.write(`${JSON.stringify(await ingestGitDiff(options), null, 2)}\n`);
}

try { await main(process.argv.slice(2)); }
catch (error) {
  const known = error instanceof IngestionError;
  process.stderr.write(`${JSON.stringify({ error: { code: known ? error.code : 'INTERNAL_ERROR',
    message: known ? error.message : 'Unexpected ingestion failure.' } })}\n`);
  process.exitCode = 1;
}

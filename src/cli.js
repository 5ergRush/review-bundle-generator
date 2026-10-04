#!/usr/bin/env node
import { ingestGitDiff, IngestionError, createReviewBundle, BundleError, RuleError, SemanticError } from './index.js';
import { readRulesFile } from './rules.js';

const help = `Usage: review-bundle ingest|bundle --repo PATH --base REV [--head REV]
  [--comparison merge-base|direct] [--max-bytes N] [--timeout-ms N]
  [--max-bundle-bytes N (bundle only)]
  [--rules PATH (bundle only)]
  [--semantic] [--callers declaration:SHA256 (repeatable, bundle only)]

Writes ingestion/v1, bundle/v1 (without rules), bundle/v2 (with rules), or bundle/v3 (with semantic analysis) JSON.
Default head: HEAD. Default comparison: merge-base. Only committed changes.
The bundle command compiles diff evidence and deterministic facts. No AI calls.
`;

async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(help); return;
  }
  const command = args.shift();
  if (!['ingest', 'bundle'].includes(command)) throw new IngestionError('INVALID_INPUT', 'Expected ingest or bundle. Use --help for usage.');
  const names = new Map([['--repo', 'repo'], ['--base', 'base'], ['--head', 'head'],
    ['--comparison', 'comparison'], ['--max-bytes', 'maxBytes'], ['--timeout-ms', 'timeoutMs'],
    ...(command === 'bundle' ? [['--max-bundle-bytes', 'maxBundleBytes'], ['--rules', 'rulesFile']] : [])]);
  const options = {};
  while (args.length) {
    const flag = args.shift();
    if (command === 'bundle' && flag === '--semantic') {
      if (options.semantic) throw new IngestionError('INVALID_INPUT', 'Duplicate --semantic.');
      options.semantic = true; continue;
    }
    if (command === 'bundle' && flag === '--callers') {
      options.contextRequests ??= [];
      options.contextRequests.push({ kind: 'direct-callers', targetId: args.shift() }); continue;
    }
    const key = names.get(flag);
    if (!key || Object.hasOwn(options, key)) throw new IngestionError('INVALID_INPUT', `Unknown or duplicate option: ${flag}`);
    const value = args.shift();
    if (!value || value.startsWith('--')) throw new IngestionError('INVALID_INPUT', `Missing value for ${flag}`);
    if (['maxBytes', 'timeoutMs', 'maxBundleBytes'].includes(key) && !/^[0-9]+$/u.test(value)) {
      throw new IngestionError('INVALID_INPUT', `${flag} requires a positive integer.`);
    }
    options[key] = ['maxBytes', 'timeoutMs', 'maxBundleBytes'].includes(key) ? Number(value) : value;
  }
  if (options.rulesFile !== undefined) {
    options.rulesYaml = await readRulesFile(options.rulesFile);
    delete options.rulesFile;
  }
  const result = await (command === 'bundle' ? createReviewBundle(options) : ingestGitDiff(options));
  // Bundle budgets include the exact compact JSON emitted below (excluding trailing newline).
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try { await main(process.argv.slice(2)); }
catch (error) {
  const known = error instanceof IngestionError || error instanceof BundleError || error instanceof RuleError || error instanceof SemanticError;
  process.stderr.write(`${JSON.stringify({ error: { code: known ? error.code : 'INTERNAL_ERROR',
    message: known ? error.message : 'Unexpected ingestion failure.' } })}\n`);
  process.exitCode = 1;
}

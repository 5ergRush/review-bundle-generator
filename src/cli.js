#!/usr/bin/env node
import { ingestGitDiff, IngestionError, createReviewBundle, BundleError, RuleError, SemanticError,
  createReviewerRequest, normalizeReviewerResponse, ReviewerError,
  compileEvaluationDataset, evaluateReviewRuns, EvaluationError } from './index.js';
import { readRulesFile } from './rules.js';
import { readJsonFile } from './json-file.js';

const help = `Usage: review-bundle ingest|bundle --repo PATH --base REV [--head REV]
  [--comparison merge-base|direct] [--max-bytes N] [--timeout-ms N]
  [--max-bundle-bytes N (bundle only)]
  [--rules PATH (bundle only)]
  [--semantic] [--callers declaration:SHA256 (repeatable, bundle only)]
review-bundle packet --bundle PATH --reviewer-id ID --reviewer-version VERSION
  [--max-request-bytes N]
review-bundle normalize --request PATH --response PATH
  [--max-response-bytes N] [--max-result-bytes N]
review-bundle dataset --definition PATH [--max-dataset-bytes N]
review-bundle evaluate --dataset PATH --runs PATH
  [--max-input-bytes N] [--max-report-bytes N]

Writes ingestion/v1, bundle/v1 (without rules), bundle/v2 (with rules), or bundle/v3 (with semantic analysis) JSON.
Default head: HEAD. Default comparison: merge-base. Only committed changes.
The bundle command compiles diff evidence and deterministic facts. No AI calls.
Packet and normalize are offline JSON operations. No CLI command invokes a reviewer.
Dataset and evaluate score frozen labels and explicitly adjudicated recorded runs offline.
`;

async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(help); return;
  }
  const command = args.shift();
  if (!['ingest', 'bundle', 'packet', 'normalize', 'dataset', 'evaluate'].includes(command)) throw new IngestionError('INVALID_INPUT', 'Expected ingest, bundle, packet, normalize, dataset or evaluate. Use --help for usage.');
  const names = new Map(command === 'dataset' ? [['--definition', 'definitionFile'], ['--max-dataset-bytes', 'maxDatasetBytes']] :
    command === 'evaluate' ? [['--dataset', 'datasetFile'], ['--runs', 'runsFile'], ['--max-input-bytes', 'maxInputBytes'], ['--max-report-bytes', 'maxReportBytes']] :
    command === 'packet' ? [['--bundle', 'bundleFile'], ['--reviewer-id', 'reviewerId'], ['--reviewer-version', 'reviewerVersion'], ['--max-request-bytes', 'maxRequestBytes']] :
    command === 'normalize' ? [['--request', 'requestFile'], ['--response', 'responseFile'], ['--max-response-bytes', 'maxResponseBytes'], ['--max-result-bytes', 'maxResultBytes']] :
    [['--repo', 'repo'], ['--base', 'base'], ['--head', 'head'],
    ['--comparison', 'comparison'], ['--max-bytes', 'maxBytes'], ['--timeout-ms', 'timeoutMs'],
    ...(command === 'bundle' ? [['--max-bundle-bytes', 'maxBundleBytes'], ['--rules', 'rulesFile']] : [])]);
  const numeric = ['maxBytes', 'timeoutMs', 'maxBundleBytes', 'maxRequestBytes', 'maxResponseBytes', 'maxResultBytes', 'maxDatasetBytes', 'maxInputBytes', 'maxReportBytes'];
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
    if (numeric.includes(key) && !/^[0-9]+$/u.test(value)) {
      throw new IngestionError('INVALID_INPUT', `${flag} requires a positive integer.`);
    }
    options[key] = numeric.includes(key) ? Number(value) : value;
  }
  if (options.rulesFile !== undefined) {
    options.rulesYaml = await readRulesFile(options.rulesFile);
    delete options.rulesFile;
  }
  let result;
  if (command === 'dataset') {
    result = compileEvaluationDataset(await readJsonFile(options.definitionFile, options.maxDatasetBytes ?? 1024 * 1024), { maxDatasetBytes: options.maxDatasetBytes });
  } else if (command === 'evaluate') {
    result = evaluateReviewRuns(await readJsonFile(options.datasetFile), await readJsonFile(options.runsFile, options.maxInputBytes ?? 64 * 1024 * 1024),
      { maxInputBytes: options.maxInputBytes, maxReportBytes: options.maxReportBytes });
  } else if (command === 'packet') {
    result = createReviewerRequest(await readJsonFile(options.bundleFile),
      { id: options.reviewerId, version: options.reviewerVersion }, { maxRequestBytes: options.maxRequestBytes });
  } else if (command === 'normalize') {
    const request = await readJsonFile(options.requestFile);
    const response = await readJsonFile(options.responseFile, options.maxResponseBytes ?? 1024 * 1024);
    result = normalizeReviewerResponse(request, response, { maxResponseBytes: options.maxResponseBytes, maxResultBytes: options.maxResultBytes });
  } else result = await (command === 'bundle' ? createReviewBundle(options) : ingestGitDiff(options));
  // Bundle budgets include the exact compact JSON emitted below (excluding trailing newline).
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try { await main(process.argv.slice(2)); }
catch (error) {
  const known = error instanceof IngestionError || error instanceof BundleError || error instanceof RuleError || error instanceof SemanticError || error instanceof ReviewerError || error instanceof EvaluationError;
  process.stderr.write(`${JSON.stringify({ error: { code: known ? error.code : 'INTERNAL_ERROR',
    message: known ? error.message : 'Unexpected operation failure.' } })}\n`);
  process.exitCode = 1;
}

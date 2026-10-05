#!/usr/bin/env node
import { ingestGitDiff, IngestionError, createReviewBundle, BundleError, RuleError, SemanticError,
  createReviewerRequest, normalizeReviewerResponse, ReviewerError,
  compileEvaluationDataset, evaluateReviewRuns, EvaluationError, normalizeGitLabMergeRequest,
  fetchGitLabMergeRequest, createGitLabReviewBundle, assertGitLabSnapshotCurrent, GitLabError, checkRuntime,
  createRuleContextBundle, RuleContextError, RuleSourceError, auditReviewBundle, AcceptanceError, AngularContextError } from './index.js';
import { readRulesFile } from './rules.js';
import { readJsonFile } from './json-file.js';

const help = `Usage: review-bundle ingest|bundle --repo PATH --base REV [--head REV]
  [--comparison merge-base|direct] [--max-bytes N] [--timeout-ms N]
  [--max-bundle-bytes N (bundle only)]
  [--rules PATH (bundle only)]
  [--rule-source patch|pinned (pinned requires v3/v4 rules)]
  [--angular-templates (bundle only; requires pinned rules)]
  [--angular-bindings (requires --angular-templates)]
  [--angular-owner PATH (repeatable; requires --angular-templates)]
  [--semantic] [--callers declaration:SHA256 (repeatable, bundle only)]
review-bundle packet --bundle PATH --reviewer-id ID --reviewer-version VERSION
  [--max-request-bytes N]
review-bundle normalize --request PATH --response PATH
  [--max-response-bytes N] [--max-result-bytes N]
review-bundle dataset --definition PATH [--max-dataset-bytes N]
review-bundle evaluate --dataset PATH --runs PATH
  [--max-input-bytes N] [--max-report-bytes N]
review-bundle doctor
review-bundle audit --bundle PATH --expectations PATH
  [--max-bundle-bytes N] [--max-expectations-bytes N] [--max-report-bytes N]
review-bundle gitlab-snapshot --instance HTTPS_URL --project-id N --mr-iid N
  [--metadata PATH (offline)] [--timeout-ms N] [--max-response-bytes N]
review-bundle gitlab-bundle --repo PATH --snapshot PATH
  [--rules PATH] [--rule-source patch|pinned] [--angular-templates] [--angular-bindings] [--angular-owner PATH] [--semantic] [--callers declaration:SHA256]
  [--max-bytes N] [--timeout-ms N] [--max-bundle-bytes N] [--max-envelope-bytes N]
review-bundle gitlab-check --snapshot PATH --current PATH
review-bundle rule-context-bundle --repo PATH --base REV [--head REV]
  --rules PATH --context-policy PATH [--max-targets N] [--max-envelope-bytes N]
  [--rule-source patch|pinned] [--angular-templates] [--angular-bindings] [--angular-owner PATH] [--comparison merge-base|direct] [--max-bytes N] [--timeout-ms N] [--max-bundle-bytes N]

Writes ingestion/v1, bundle/v1 (without rules), bundle/v2 (with rules), or bundle/v3 (with semantic analysis) JSON.
Rule-context-bundle writes rule-context-bundle/v1 containing the ordinary .bundle and explicit plan.
Pinned rule-source writes bundle/v4 with complete bounded changed .ts files and selection/v4.
Angular template opt-in writes bundle/v5 with explicit component/template context.
Angular bindings opt-in writes bundle/v6 with parsed static template/member relationships.
Explicit candidate owner paths opt into bundle/v7 with changed-template ownership.
Default head: HEAD. Default comparison: merge-base. Only committed changes.
The bundle command compiles diff evidence and deterministic facts. No AI calls.
Packet and normalize are offline JSON operations. No CLI command invokes a reviewer.
Dataset and evaluate score frozen labels and explicitly adjudicated recorded runs offline.
Audit compares a validated ordinary bundle with supplied exact fact/rule expectations offline.
Audit writes a report; exit 0 passes, exit 2 reports mismatches, exit 1 rejects invalid inputs.
Only gitlab-snapshot without --metadata performs an HTTPS GET, using optional
REVIEW_BUNDLE_GITLAB_TOKEN from the environment. No GitLab writes or Git fetches.
`;

async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(help); return;
  }
  const command = args.shift();
  if (command === 'doctor') {
    if (args.length) throw new IngestionError('INVALID_INPUT', 'Doctor accepts no options.');
    process.stdout.write(`${JSON.stringify(await checkRuntime())}\n`); return;
  }
  if (!['ingest', 'bundle', 'packet', 'normalize', 'dataset', 'evaluate', 'audit', 'gitlab-snapshot', 'gitlab-bundle', 'gitlab-check', 'rule-context-bundle'].includes(command)) throw new IngestionError('INVALID_INPUT', 'Unknown command. Use --help for usage.');
  const bundleCommand = ['bundle', 'gitlab-bundle'].includes(command);
  const names = new Map(command === 'gitlab-snapshot' ? [['--instance', 'instanceUrl'], ['--project-id', 'projectId'], ['--mr-iid', 'mergeRequestIid'], ['--metadata', 'metadataFile'], ['--timeout-ms', 'timeoutMs'], ['--max-response-bytes', 'maxResponseBytes']] :
    command === 'gitlab-check' ? [['--snapshot', 'snapshotFile'], ['--current', 'currentFile']] :
    command === 'gitlab-bundle' ? [['--repo', 'repo'], ['--snapshot', 'snapshotFile'], ['--rules', 'rulesFile'], ['--rule-source', 'ruleSource'], ['--max-bytes', 'maxBytes'], ['--timeout-ms', 'timeoutMs'], ['--max-bundle-bytes', 'maxBundleBytes'], ['--max-envelope-bytes', 'maxEnvelopeBytes']] :
    command === 'audit' ? [['--bundle', 'bundleFile'], ['--expectations', 'expectationsFile'], ['--max-bundle-bytes', 'maxBundleBytes'], ['--max-expectations-bytes', 'maxExpectationsBytes'], ['--max-report-bytes', 'maxReportBytes']] :
    command === 'dataset' ? [['--definition', 'definitionFile'], ['--max-dataset-bytes', 'maxDatasetBytes']] :
    command === 'evaluate' ? [['--dataset', 'datasetFile'], ['--runs', 'runsFile'], ['--max-input-bytes', 'maxInputBytes'], ['--max-report-bytes', 'maxReportBytes']] :
    command === 'packet' ? [['--bundle', 'bundleFile'], ['--reviewer-id', 'reviewerId'], ['--reviewer-version', 'reviewerVersion'], ['--max-request-bytes', 'maxRequestBytes']] :
    command === 'normalize' ? [['--request', 'requestFile'], ['--response', 'responseFile'], ['--max-response-bytes', 'maxResponseBytes'], ['--max-result-bytes', 'maxResultBytes']] :
    [['--repo', 'repo'], ['--base', 'base'], ['--head', 'head'],
    ['--comparison', 'comparison'], ['--max-bytes', 'maxBytes'], ['--timeout-ms', 'timeoutMs'],
    ...(['bundle', 'rule-context-bundle'].includes(command) ? [['--max-bundle-bytes', 'maxBundleBytes'], ['--rules', 'rulesFile'], ['--rule-source', 'ruleSource']] : []),
    ...(command === 'rule-context-bundle' ? [['--context-policy', 'contextPolicyFile'], ['--max-targets', 'maxTargets'], ['--max-envelope-bytes', 'maxEnvelopeBytes']] : [])]);
  const numeric = ['maxBytes', 'timeoutMs', 'maxBundleBytes', 'maxRequestBytes', 'maxResponseBytes', 'maxResultBytes', 'maxDatasetBytes', 'maxInputBytes', 'maxReportBytes', 'maxExpectationsBytes', 'projectId', 'mergeRequestIid', 'maxEnvelopeBytes', 'maxTargets'];
  const options = {};
  while (args.length) {
    const flag = args.shift();
    if (['bundle', 'gitlab-bundle', 'rule-context-bundle'].includes(command) && flag === '--angular-owner') {
      options.angularOwnerPaths ??= []; options.angularOwnerPaths.push(args.shift()); continue;
    }
    if (['bundle', 'gitlab-bundle', 'rule-context-bundle'].includes(command) && flag === '--angular-bindings') {
      if (options.angularBindings) throw new IngestionError('INVALID_INPUT', 'Duplicate --angular-bindings.');
      options.angularBindings = true; continue;
    }
    if (['bundle', 'gitlab-bundle', 'rule-context-bundle'].includes(command) && flag === '--angular-templates') {
      if (options.angularTemplates) throw new IngestionError('INVALID_INPUT', 'Duplicate --angular-templates.');
      options.angularTemplates = true; continue;
    }
    if (bundleCommand && flag === '--semantic') {
      if (options.semantic) throw new IngestionError('INVALID_INPUT', 'Duplicate --semantic.');
      options.semantic = true; continue;
    }
    if (bundleCommand && flag === '--callers') {
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
  if (command === 'rule-context-bundle') {
    const { contextPolicyFile, ...config } = options;
    result = await createRuleContextBundle({ ...config, contextPolicy: await readJsonFile(contextPolicyFile, 256 * 1024) });
  } else if (command === 'gitlab-snapshot') {
    const { metadataFile, ...config } = options;
    if (metadataFile !== undefined) {
      if (config.timeoutMs !== undefined || config.maxResponseBytes !== undefined) throw new GitLabError('INVALID_GITLAB_INPUT', 'Offline metadata mode does not accept network limits.');
      result = normalizeGitLabMergeRequest(await readJsonFile(metadataFile, 8 * 1024 * 1024), config);
    } else result = await fetchGitLabMergeRequest({ ...config, ...(process.env.REVIEW_BUNDLE_GITLAB_TOKEN === undefined ? {} : { token: process.env.REVIEW_BUNDLE_GITLAB_TOKEN }) });
  } else if (command === 'gitlab-bundle') {
    const { snapshotFile, ...config } = options;
    result = await createGitLabReviewBundle({ ...config, mergeRequest: await readJsonFile(snapshotFile, 8 * 1024 * 1024) });
  } else if (command === 'gitlab-check') {
    result = assertGitLabSnapshotCurrent(await readJsonFile(options.snapshotFile, 8 * 1024 * 1024), await readJsonFile(options.currentFile, 8 * 1024 * 1024));
  } else if (command === 'audit') {
    result = auditReviewBundle(await readJsonFile(options.bundleFile, options.maxBundleBytes ?? 16 * 1024 * 1024),
      await readJsonFile(options.expectationsFile, options.maxExpectationsBytes ?? 1024 * 1024),
      { maxBundleBytes: options.maxBundleBytes, maxExpectationsBytes: options.maxExpectationsBytes, maxReportBytes: options.maxReportBytes });
    if (!result.passed) process.exitCode = 2;
  } else if (command === 'dataset') {
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
  const known = error instanceof IngestionError || error instanceof BundleError || error instanceof RuleError || error instanceof SemanticError || error instanceof ReviewerError || error instanceof EvaluationError || error instanceof GitLabError || error instanceof RuleContextError || error instanceof RuleSourceError || error instanceof AcceptanceError || error instanceof AngularContextError;
  process.stderr.write(`${JSON.stringify({ error: { code: known ? error.code : 'INTERNAL_ERROR',
    message: known ? error.message : 'Unexpected operation failure.' } })}\n`);
  process.exitCode = 1;
}

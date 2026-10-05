import { createHash } from 'node:crypto';
import { boundedJson } from './reviewer.js';
import { createReviewBundle } from './bundle.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const oid = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value);
export class GitLabError extends Error {
  constructor(code, message) { super(message); this.name = 'GitLabError'; this.code = code; }
}
function check(condition, message, code = 'INVALID_GITLAB_INPUT') {
  if (!condition) throw new GitLabError(code, message);
}
function integer(value, ceiling = Number.MAX_SAFE_INTEGER) {
  check(Number.isSafeInteger(value) && value > 0 && value <= ceiling, 'Expected a bounded positive integer.'); return value;
}
function options(value, names) { check(object(value) && Object.keys(value).every(key => names.includes(key)), 'Unknown GitLab options.'); }
function copy(value) {
  try { return boundedJson(value, 8 * 1024 * 1024, 'INVALID_GITLAB_INPUT'); }
  catch { throw new GitLabError('INVALID_GITLAB_INPUT', 'GitLab input must be bounded plain JSON.'); }
}
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function instance(value) {
  check(typeof value === 'string' && value.length <= 2048 && !/[\x00-\x20\x7f\\%?#]/u.test(value), 'Invalid GitLab instance URL.');
  let url;
  try { url = new URL(value); } catch { throw new GitLabError('INVALID_GITLAB_INPUT', 'Invalid GitLab instance URL.'); }
  check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
    /^[a-zA-Z0-9._~/-]*$/u.test(url.pathname) && !value.split('/').some(part => part === '.' || part === '..'),
  'GitLab instance must be an HTTPS origin with an optional plain base path, without credentials/query/fragment.');
  const path = url.pathname.replace(/\/+$/u, '');
  check(!path.includes('//'), 'Invalid GitLab base path.');
  return url.origin + path;
}

export function normalizeGitLabMergeRequest(input, config) {
  options(config, ['instanceUrl', 'projectId', 'mergeRequestIid']);
  const instanceUrl = instance(config.instanceUrl); const projectId = integer(config.projectId); const iid = integer(config.mergeRequestIid);
  const data = copy(input);
  check(object(data) && data.project_id === projectId && data.target_project_id === projectId && data.iid === iid,
    'Merge request project/target/IID does not match the requested resource.', 'GITLAB_IDENTITY_MISMATCH');
  integer(data.id); if (data.source_project_id !== null) integer(data.source_project_id);
  check(['opened', 'closed', 'merged', 'locked'].includes(data.state), 'Unsupported merge request state.');
  const refs = data.diff_refs;
  check(object(refs) && oid(refs.base_sha) && oid(refs.head_sha) && oid(refs.start_sha),
    'Merge request diff references are not ready; retry explicitly after GitLab prepares them.', 'GITLAB_DIFF_NOT_READY');
  check([refs.head_sha, refs.start_sha].every(value => value.length === refs.base_sha.length) && data.sha === refs.head_sha,
    'Merge request head and diff references disagree.', 'GITLAB_INCONSISTENT_REFS');
  const payload = { schemaVersion: 'gitlab-merge-request/v1', instanceUrl, projectId, iid, mergeRequestId: data.id,
    sourceProjectId: data.source_project_id, targetProjectId: data.target_project_id, state: data.state,
    diffRefs: { baseCommit: refs.base_sha, headCommit: refs.head_sha, startCommit: refs.start_sha },
    policy: { apiVersion: 'v4', diffBasis: 'recorded-diff-base-to-head', readOnly: true } };
  return freeze({ id: `gitlab-mr:${hash(payload)}`, ...payload });
}

function snapshot(input) {
  const data = copy(input);
  check(object(data) && data.schemaVersion === 'gitlab-merge-request/v1' && object(data.diffRefs), 'Expected gitlab-merge-request/v1 snapshot.');
  const normalized = normalizeGitLabMergeRequest({ id: data.mergeRequestId, iid: data.iid, project_id: data.projectId,
    target_project_id: data.targetProjectId, source_project_id: data.sourceProjectId, state: data.state,
    sha: data.diffRefs.headCommit, diff_refs: { base_sha: data.diffRefs.baseCommit, head_sha: data.diffRefs.headCommit, start_sha: data.diffRefs.startCommit } },
  { instanceUrl: data.instanceUrl, projectId: data.projectId, mergeRequestIid: data.iid });
  check(JSON.stringify(normalized) === JSON.stringify(data), 'Snapshot content ID or contract does not match.');
  return normalized;
}

export function assertGitLabSnapshotCurrent(previous, current) {
  const before = snapshot(previous); const after = snapshot(current);
  check(before.id === after.id, 'Merge request identity/state/diff references changed; regenerate the bundle before using this review.', 'GITLAB_STALE_SNAPSHOT');
  return after;
}

export async function fetchGitLabMergeRequest(config) {
  options(config, ['instanceUrl', 'projectId', 'mergeRequestIid', 'token', 'timeoutMs', 'maxResponseBytes', 'fetchImpl']);
  const instanceUrl = instance(config.instanceUrl); const projectId = integer(config.projectId); const iid = integer(config.mergeRequestIid);
  const timeoutMs = integer(config.timeoutMs ?? 30_000, 300_000);
  const maxBytes = integer(config.maxResponseBytes ?? 1024 * 1024, 8 * 1024 * 1024);
  check(config.token === undefined || (typeof config.token === 'string' && config.token.length > 0 && config.token.length <= 4096 && /^[\x21-\x7e]+$/u.test(config.token)), 'Token must be bounded ASCII header text without whitespace.');
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  check(typeof fetchImpl === 'function', 'A Fetch-compatible transport is required.');
  const endpoint = `${instanceUrl}/api/v4/projects/${projectId}/merge_requests/${iid}`;
  const controller = new AbortController(); let timer; let reader; let receivedResponse;
  const started = performance.now();
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new GitLabError('GITLAB_TIMEOUT', 'GitLab metadata read exceeded timeoutMs.')); }, timeoutMs);
  });
  const operation = async () => {
    const response = await fetchImpl(endpoint, { method: 'GET', redirect: 'manual', credentials: 'omit',
      headers: { Accept: 'application/json', ...(config.token === undefined ? {} : { 'PRIVATE-TOKEN': config.token }) }, signal: controller.signal });
    check(response instanceof Response, 'Transport must return a standard Fetch Response.', 'GITLAB_TRANSPORT_FAILED');
    receivedResponse = response;
    if (controller.signal.aborted) { response.body?.cancel().catch(() => {}); throw new GitLabError('GITLAB_TIMEOUT', 'GitLab metadata read exceeded timeoutMs.'); }
    check(!response.redirected && (!response.url || response.url === endpoint) && !(response.status >= 300 && response.status < 400), 'GitLab redirects are not followed.', 'GITLAB_REDIRECT');
    check(response.status === 200, `GitLab metadata request failed with HTTP ${response.status}.`, 'GITLAB_HTTP_ERROR');
    check(/^application\/(?:json|[a-zA-Z0-9.+-]+\+json)(?:\s*;|$)/u.test(response.headers.get('content-type') ?? ''), 'GitLab response is not JSON.', 'GITLAB_INVALID_RESPONSE');
    const length = response.headers.get('content-length');
    check(length === null || (/^\d+$/u.test(length) && Number(length) <= maxBytes), 'GitLab metadata response exceeds byte budget.', 'GITLAB_RESPONSE_LIMIT');
    check(response.body, 'GitLab response body is missing.', 'GITLAB_INVALID_RESPONSE');
    reader = response.body.getReader(); const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) throw new GitLabError('GITLAB_TIMEOUT', 'GitLab metadata read exceeded timeoutMs.');
      if (done) break;
      size += value.byteLength; check(size <= maxBytes, 'GitLab metadata response exceeds byte budget.', 'GITLAB_RESPONSE_LIMIT'); chunks.push(value);
    }
    const body = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    let data;
    try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
    catch { throw new GitLabError('GITLAB_INVALID_RESPONSE', 'GitLab response is not valid UTF-8 JSON.'); }
    return normalizeGitLabMergeRequest(data, { instanceUrl, projectId, mergeRequestIid: iid });
  };
  try {
    const result = await Promise.race([Promise.resolve().then(operation), timeout]);
    check(performance.now() - started < timeoutMs, 'GitLab metadata read exceeded timeoutMs.', 'GITLAB_TIMEOUT');
    return result;
  } catch (error) {
    if (controller.signal.aborted || (error instanceof GitLabError && error.code === 'GITLAB_TIMEOUT')) throw new GitLabError('GITLAB_TIMEOUT', 'GitLab metadata read exceeded timeoutMs.');
    if (error instanceof GitLabError) throw error;
    throw new GitLabError('GITLAB_TRANSPORT_FAILED', 'GitLab metadata transport failed; no response details or credentials returned.');
  } finally {
    clearTimeout(timer); controller.abort();
    if (reader) reader.cancel().catch(() => {});
    else receivedResponse?.body?.cancel().catch(() => {});
  }
}

export async function createGitLabReviewBundle(config) {
  options(config, ['repo', 'mergeRequest', 'maxEnvelopeBytes', 'maxBundleBytes', 'maxBytes', 'timeoutMs', 'rulesYaml', 'ruleSource', 'angularTemplates', 'semantic', 'contextRequests']);
  const mergeRequest = snapshot(config.mergeRequest);
  check(mergeRequest.state === 'opened' && mergeRequest.sourceProjectId !== null, 'An open merge request with an available source project is required.', 'GITLAB_MR_NOT_OPEN');
  const maxEnvelopeBytes = integer(config.maxEnvelopeBytes ?? 16 * 1024 * 1024, 64 * 1024 * 1024);
  const { mergeRequest: ignored, maxEnvelopeBytes: ignoredBudget, ...bundleOptions } = config;
  const bundle = await createReviewBundle({ ...bundleOptions, base: mergeRequest.diffRefs.baseCommit, head: mergeRequest.diffRefs.headCommit, comparison: 'direct' });
  const payload = { schemaVersion: 'gitlab-review-bundle/v1', mergeRequest, bundle,
    policy: { comparison: 'direct-pinned-diff-refs', repository: 'caller-provided-local-objects', freshness: 'snapshot-only', readOnly: true },
    limitations: ['The metadata snapshot is not a live freshness guarantee; re-read and compare before using the review.',
      'No repository is fetched and no GitLab comment/status is posted. Local object availability and trusted checkout identity are caller responsibilities.'] };
  const result = { id: `gitlab-bundle:${hash(payload)}`, ...payload };
  check(Buffer.byteLength(JSON.stringify(result)) <= maxEnvelopeBytes, 'Serialized GitLab envelope exceeds maxEnvelopeBytes; no partial bundle returned.', 'GITLAB_ENVELOPE_LIMIT');
  return freeze(result);
}

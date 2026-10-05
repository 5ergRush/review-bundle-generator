import { createHash } from 'node:crypto';
import { readTypeScriptSources, readAngularTemplateSources } from './git.js';
import { discoverAngularComponents, AngularContextError } from './angular-context.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = value => JSON.stringify([value.commit, value.path]);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const limits = Object.freeze({ maxCandidatePaths: 32, maxSourceBytes: 4 * 1024 * 1024, maxSourceFileBytes: 512 * 1024, maxTemplates: 10, maxTemplateFileBytes: 32768, maxTemplateBytes: 131072, maxDecisions: 10000, maxOperations: 5_000_000 });
const check = (ok, message, code = 'INVALID_ANGULAR_OWNERS') => { if (!ok) throw new AngularContextError(code, message); };
const fullRange = content => { const lines = content.split(/\r\n|[\r\n\u2028\u2029]/u); return { start: { line: 1, column: 1 }, end: { line: lines.length, column: lines.at(-1).length + 1 } }; };

export function normalizeAngularOwnerPaths(paths) {
  check(Array.isArray(paths) && paths.length > 0 && paths.length <= limits.maxCandidatePaths && new Set(paths).size === paths.length && paths.every(path =>
    typeof path === 'string' && path.length <= 4096 && path.endsWith('.ts') && !path.endsWith('.d.ts') && !/[\\\0\r\n]/u.test(path) && !path.startsWith('/') &&
    !path.split('/').some(part => !part || part === '.' || part === '..')), 'angularOwnerPaths requires 1..32 unique repository-relative .ts paths (no declaration files).', 'INVALID_INPUT');
  return [...paths].sort(compare);
}
function requestsFor(bundle) {
  const requests = []; const changes = new Map(bundle.changes.map(c => [c.id, c]));
  for (const decision of bundle.ruleSelection.decisions) {
    if (decision.status !== 'matched') { requests.push({ ruleId: decision.ruleId, changeId: null, side: null, path: null, commit: null, evidenceId: null, reason: 'rule-not-selected' }); continue; }
    for (const match of decision.matches) for (const matchedPath of match.matchedPaths) {
      const change = changes.get(match.changeId), side = matchedPath.side;
      requests.push({ ruleId: decision.ruleId, changeId: change.id, side, path: matchedPath.path,
        commit: bundle.provenance.revisions[side === 'old' ? 'effectiveBaseCommit' : 'headCommit'], evidenceId: change.evidenceIds[0],
        reason: change[`${side}Kind`] !== 'file' || !['text-diff', 'metadata-only'].includes(change.coverage) ? 'changed-template-text-unavailable' : null });
    }
  }
  check(requests.length <= limits.maxDecisions, 'More than 10000 template ownership decisions.', 'ANGULAR_OWNER_LIMIT');
  return requests;
}
function validateRecords(bundle, records, type, expected, fileBytes, totalBytes, maxCount) {
  check(Array.isArray(records) && records.length <= maxCount, 'Too many ownership sources.', 'ANGULAR_OWNER_LIMIT');
  const seen = new Map(); let bytes = 0;
  const changed = new Map();
  for (const change of bundle.changes) for (const side of ['old', 'new']) if (change[`${side}Path`] !== null) changed.set(key({ commit: bundle.provenance.revisions[side === 'old' ? 'effectiveBaseCommit' : 'headCommit'], path: change[`${side}Path`] }), { object: change[`${side}Object`], kind: change[`${side}Kind`] });
  for (const record of records) {
    check(record && Object.keys(record).sort().join(',') === 'content,id,origin,type' && record.type === type && typeof record.content === 'string', 'Invalid ownership source fields.');
    const o = record.origin;
    check(o && Object.keys(o).sort().join(',') === 'commit,end,object,path,start' && expected.has(key(o)) && !seen.has(key(o)) &&
      /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(o.object) && JSON.stringify({ start: o.start, end: o.end }) === JSON.stringify(fullRange(record.content)) && Buffer.from(record.content).toString('utf8') === record.content, 'Invalid ownership source origin.');
    const size = Buffer.byteLength(record.content); bytes += size;
    check(size <= fileBytes && bytes <= totalBytes, 'Ownership source bytes exceed budget.', 'ANGULAR_OWNER_LIMIT');
    const known = changed.get(key(o)); check(!known || known.kind === 'file' && known.object === o.object, 'Ownership source disagrees with changed-file metadata.');
    const { id, ...payload } = record;
    check(id === `evidence:${hash(payload)}` && createHash(o.object.length === 40 ? 'sha1' : 'sha256').update(`blob ${size}\0`).update(record.content).digest('hex') === o.object, 'Ownership source bytes/ID disagree with Git blob.');
    seen.set(key(o), record);
  }
  return seen;
}
function plan(bundle, paths, sourceEvidence) {
  const requests = requestsFor(bundle); const commits = [...new Set(requests.filter(r => !r.reason).map(r => r.commit))].sort(compare);
  const expected = new Set(commits.flatMap(commit => paths.map(path => key({ commit, path }))));
  const sources = validateRecords(bundle, sourceEvidence, 'angular-owner-source', expected, limits.maxSourceFileBytes, limits.maxSourceBytes, 64);
  const scans = []; const owners = []; let operations = 0;
  const tick = () => check(++operations <= limits.maxOperations, 'Ownership analysis exceeds operation budget.', 'ANGULAR_OWNER_LIMIT');
  for (const commit of commits) for (const path of paths) {
    tick(); const source = sources.get(key({ commit, path }));
    const parsed = source ? discoverAngularComponents(source, tick) : null;
    scans.push({ commit, path, sourceEvidenceId: source?.id ?? null, status: parsed?.status ?? 'candidate-not-regular-or-missing', classes: parsed?.classes ?? [] });
    for (const relation of parsed?.classes ?? []) if (relation.template?.kind === 'external') owners.push({ sourceEvidenceId: source.id, component: relation.component, template: { ...relation.template } });
  }
  const decisions = []; const templates = new Map();
  for (const request of requests) {
    const found = request.reason ? [] : owners.filter(owner => { tick(); return owner.template.commit === request.commit && owner.template.path === request.path; });
    const unique = new Map(found.map(owner => [JSON.stringify([owner.sourceEvidenceId, owner.component.origin]), owner]));
    const matched = [...unique.values()].map(owner => ({ ...owner, template: { ...owner.template } }));
    decisions.push({ ...request, status: matched.length ? 'included' : 'omitted', reason: request.reason ?? (matched.length ? 'explicit-template-url-in-candidate-set' : 'owner-not-resolved-in-candidate-set'), owners: matched });
    if (matched.length) templates.set(key(request), { commit: request.commit, path: request.path });
  }
  check(templates.size <= limits.maxTemplates, 'More than 10 changed owned template sides.', 'ANGULAR_OWNER_LIMIT');
  return { commits, scans, decisions, requests: [...templates.values()].sort((a, b) => compare(key(a), key(b))) };
}

export function compileAngularTemplateOwners(bundle, paths, sourceEvidence, templateEvidence) {
  paths = normalizeAngularOwnerPaths(paths);
  const planned = plan(bundle, paths, sourceEvidence);
  const expected = new Set(planned.requests.map(key));
  const templates = validateRecords(bundle, templateEvidence, 'angular-owner-template-source', expected, limits.maxTemplateFileBytes, limits.maxTemplateBytes, limits.maxTemplates);
  check(templates.size === expected.size, 'Complete owned changed template sources required.');
  for (const decision of planned.decisions) for (const owner of decision.owners) owner.template.evidenceId = templates.get(key(owner.template)).id;
  return { schemaVersion: 'angular-template-owners/v1', policy: { basis: 'selected-changed-path-sides-and-explicit-template-url-in-operator-candidate-set', candidatePaths: paths, candidateCoverage: 'configured-paths-only',
    missingCandidateEvidence: 'unverified-tree-membership-on-import', limits }, scans: planned.scans, decisions: planned.decisions };
}

export async function expandAngularTemplateOwners(repo, bundle, paths) {
  paths = normalizeAngularOwnerPaths(paths); const requests = requestsFor(bundle);
  const commits = [...new Set(requests.filter(r => !r.reason).map(r => r.commit))].sort(compare);
  const revisions = commits.length ? await readTypeScriptSources(repo, commits, commits.map(() => new Set(paths))) : [];
  const record = (source, type) => { const payload = { type, origin: { commit: source.commit, path: source.path, object: source.object, ...fullRange(source.content) }, content: source.content }; return { id: `evidence:${hash(payload)}`, ...payload }; };
  const sourceEvidence = revisions.flatMap(revision => revision.sources.map(source => record({ ...source, commit: revision.commit }, 'angular-owner-source')));
  const planned = plan(bundle, paths, sourceEvidence);
  const templateEvidence = planned.requests.length ? (await readAngularTemplateSources(repo, planned.requests)).map(source => record(source, 'angular-owner-template-source')) : [];
  return { evidence: [...sourceEvidence, ...templateEvidence], angularTemplateOwnerContext: compileAngularTemplateOwners(bundle, paths, sourceEvidence, templateEvidence) };
}

export function angularOwnerBindingDecisions(bundle) {
  return (bundle.angularTemplateOwnerContext?.decisions ?? []).flatMap(decision => decision.owners.map(owner => ({ ruleId: decision.ruleId,
    anchor: { changeId: decision.changeId, side: decision.side, evidenceId: decision.evidenceId, sourceEvidenceId: owner.sourceEvidenceId, origin: owner.component.origin },
    component: owner.component, template: owner.template, status: 'included', reason: decision.reason })));
}

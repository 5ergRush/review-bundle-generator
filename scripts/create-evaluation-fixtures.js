// Maintainer-only synthetic fixture authoring. Evaluation itself never executes Git or a reviewer.
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createReviewBundle, createReviewerRequest, normalizeReviewerResponse, compileEvaluationDataset } from '../src/index.js';

const directory = fileURLToPath(new URL('../fixtures/evaluation/', import.meta.url));
const repo = await mkdtemp(join(tmpdir(), 'evaluation-fixtures-'));
const git = (...args) => execFileSync('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'commit.gpgSign=false', ...args], { cwd: repo, encoding: 'utf8', env: {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull,
  GIT_AUTHOR_NAME: 'Synthetic Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Synthetic Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
} }).trim();
try {
  git('init', '-q', '--template=', '--initial-branch=main'); git('config', 'core.autocrlf', 'false');
  const put = (path, content) => writeFile(join(repo, path), content);
  const commit = message => { git('add', '-A'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
  await put('rate.ts', 'export function rate(amount: number) { if (amount === 0) return 0; return 100 / amount; }\n');
  await put('caller.ts', "import {rate} from './rate';\nexport const zeroRate = rate(0);\n");
  const base = commit('synthetic base');
  await put('rate.ts', 'export function rate(amount: number) { return 100 / amount; }\n');
  const bugHead = commit('synthetic guard removal');
  git('checkout', '-q', '--detach', base);
  await put('rate.ts', '// Equivalent behavior with an explanatory comment.\nexport function rate(amount: number) { if (amount === 0) return 0; return 100 / amount; }\n');
  const cleanHead = commit('synthetic comment-only change');
  const definition = { schemaVersion: 'review-dataset/v1', name: 'synthetic-evaluation-contract', version: '1',
    labelProvenance: { kind: 'synthetic', author: 'fixture-maintainers', revision: '1' }, cases: [
      { id: 'guard-removal', description: 'Guard removal permits division by zero for the committed zero caller.',
        baseCommit: base, headCommit: bugHead, comparison: 'direct', labels: [
          { id: 'zero-division', description: 'Removing the zero guard changes the zero caller result from 0 to Infinity.',
            location: { side: 'new', path: 'rate.ts', startLine: 1, endLine: 1 } },
        ] },
      { id: 'comment-only', description: 'Comment-only change preserves behavior; no seeded defect.',
        baseCommit: base, headCommit: cleanHead, comparison: 'direct', labels: [] },
    ] };
  const dataset = compileEvaluationDataset(definition);
  const candidates = [
    { id: 'diff-only', kind: 'synthetic', reviewer: { id: 'synthetic-diff-reviewer', version: 'fixture-v1' } },
    { id: 'caller-context', kind: 'synthetic', reviewer: { id: 'synthetic-context-reviewer', version: 'fixture-v1' } },
  ];
  const runs = [];
  for (const candidate of candidates) for (const item of dataset.cases) {
    const options = { repo, base: item.baseCommit, head: item.headCommit, comparison: item.comparison };
    let bundle = await createReviewBundle({ ...options, semantic: candidate.id === 'caller-context' });
    if (candidate.id === 'caller-context') {
      const target = bundle.semanticAnalysis.declarations.find(item => item.side === 'new' && item.name === 'rate');
      if (target) bundle = await createReviewBundle({ ...options, semantic: true, contextRequests: [{ kind: 'direct-callers', targetId: target.id }] });
    }
    const request = createReviewerRequest(bundle, candidate.reviewer);
    const evidence = bundle.evidence.find(item => item.type === 'git-patch');
    for (let repetition = 1; repetition <= 2; repetition++) {
      // Deliberately scripted outcomes exercise TP/FP/FN and stability, not AI performance.
      const reportClaim = candidate.id === 'caller-context' ? item.id === 'guard-removal' : repetition === 1;
      const response = { schemaVersion: 'reviewer-response/v1', requestId: request.id, reviewer: candidate.reviewer,
        status: 'complete', reviewedRuleIds: [], findings: reportClaim ? [{ ruleId: null, severity: 'warning',
          title: item.id === 'guard-removal' ? 'Zero guard was removed' : 'Scripted false positive',
          description: 'Synthetic reviewer claim for scoring-contract validation only.', evidenceIds: [evidence.id],
          location: { evidenceId: evidence.id, side: 'new', startLine: 1, endLine: 1 } }] : [], contextRequests: [] };
      const normalized = normalizeReviewerResponse(request, response);
      runs.push({ candidateId: candidate.id, caseId: item.id, repetition, status: 'success', request, response,
        judgments: normalized.findings.map(finding => ({ findingId: finding.id, labelId: item.id === 'guard-removal' ? 'zero-division' : null })),
        measurements: null });
    }
  }
  const input = { schemaVersion: 'review-evaluation/v1', datasetId: dataset.id, baselineCandidateId: 'diff-only', repetitions: 2,
    candidates, adjudication: { kind: 'synthetic', author: 'fixture-maintainers', revision: '1' }, runs };
  await mkdir(directory, { recursive: true });
  for (const [name, value] of [['definition.json', definition], ['dataset.json', dataset], ['runs.json', input]]) {
    await writeFile(join(directory, name), JSON.stringify(value, null, 2) + '\n');
  }
  process.stdout.write('Wrote synthetic evaluation fixtures; no reviewer was invoked.\n');
} finally { await rm(repo, { recursive: true, force: true }); }

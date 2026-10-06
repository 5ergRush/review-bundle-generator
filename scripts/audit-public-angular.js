// Public real-change calibration. Same-author development labels are not a holdout.
// The caller supplies a local checkout with all pinned objects; this script never fetches.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { createReviewBundle, parseRulesYaml, compileAcceptanceExpectations, auditReviewBundle } from '../src/index.js';

const [repoArgument, outputArgument = 'review-output/public-angular', ...extra] = process.argv.slice(2);
if (!repoArgument || extra.length) {
  console.error('Usage: node scripts/audit-public-angular.js /local/angular-components [output-directory]');
  process.exit(1);
}
const repo = resolve(repoArgument);
const output = resolve(outputArgument);
const manifest = JSON.parse(await readFile(new URL('../fixtures/public-angular/cases.json', import.meta.url), 'utf8'));
const rulesYaml = await readFile(new URL('../fixtures/public-angular/rules.yaml', import.meta.url), 'utf8');
const config = parseRulesYaml(rulesYaml);
await mkdir(output, { recursive: true });

// Compile and persist every expectation before generating any candidate bundle.
const frozen = manifest.cases.map(item => ({ item, expectations: compileAcceptanceExpectations({
  schemaVersion: 'review-acceptance-expectations/v1', caseId: item.caseId,
  cohort: manifest.cohort,
  provenance: { kind: 'approved-mr', author: manifest.expectationAuthor, revision: manifest.expectationRevision },
  revisions: { requestedBaseCommit: item.base, effectiveBaseCommit: item.base, headCommit: item.head, comparison: manifest.comparison },
  ruleConfigId: config.id, ruleSource: 'pinned', changes: item.changes,
}) }));
for (const { item, expectations } of frozen) {
  await writeFile(join(output, `${item.caseId}.expectations.json`), JSON.stringify(expectations, null, 2) + '\n');
}

const results = [];
for (const { item, expectations } of frozen) {
  const options = { repo, base: item.base, head: item.head, comparison: manifest.comparison, rulesYaml, ruleSource: 'pinned' };
  const bundle = await createReviewBundle(options);
  const repeat = await createReviewBundle(options);
  assert.deepEqual(bundle, repeat, `${item.caseId}: repeated generation changed`);
  const report = auditReviewBundle(bundle, expectations);
  await writeFile(join(output, `${item.caseId}.bundle.json`), JSON.stringify(bundle, null, 2) + '\n');
  await writeFile(join(output, `${item.caseId}.report.json`), JSON.stringify(report, null, 2) + '\n');
  results.push({ caseId: item.caseId, url: item.url, base: item.base, head: item.head,
    expectationsId: expectations.id, bundleId: bundle.id, reportId: report.id,
    gitVersion: bundle.provenance.tool.gitVersion, compilerVersion: bundle.ruleSelection.policy.compilerVersion,
    changes: bundle.changes.length, factsPassed: report.factsPassed,
    ruleSelectionPassed: report.ruleSelectionPassed, passed: report.passed, repeatedGeneration: 'identical',
    comparisons: report.results,
    qualificationChecks: bundle.ruleSelection.decisions.flatMap(decision => (decision.qualificationChecks ?? []).map(check => ({
      ruleId: decision.ruleId, path: check.origin.path, side: check.side, status: check.status, reason: check.reason,
    }))),
  });
}
const summary = { schemaVersion: 'public-angular-calibration-report/v1', repository: manifest.repository,
  ruleConfigId: config.id, snapshotPolicy: manifest.snapshotPolicy, comparison: manifest.comparison,
  evidenceKind: 'public-upstream-landed-changes-with-same-author-frozen-expectations',
  expectationAuthor: manifest.expectationAuthor, results, passed: results.every(item => item.passed),
  reviewerImprovement: 'not-measured',
  limitations: ['Three deliberately selected development cases, not a representative or independently authored holdout.',
    'Upstream merge approval is not corporate MR approval. No private corporate source was used.',
    'Assertions cover exact changed paths, statuses, entry kinds, counts, per-change selected rules and source coverage. Required patch lines are not asserted.',
    'Repeated generation agreement does not establish cross-Git-version byte equivalence.',
    'No Angular runtime tests, actual reviewer comparison, caller context or template ownership/binding acceptance were run.'],
};
await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ passed: summary.passed, cases: results.map(({ caseId, changes, factsPassed, ruleSelectionPassed }) => ({ caseId, changes, factsPassed, ruleSelectionPassed })), summary: join(output, 'summary.json') }, null, 2));
if (!summary.passed) process.exitCode = 2;

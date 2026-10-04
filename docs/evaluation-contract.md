# Offline review evaluation

Evaluation consumes frozen labels and recorded packets/responses with explicit
adjudication. It does not run Git, fetch repositories, call a reviewer, generate
truth labels from findings or use an AI judge. The included synthetic fixtures
validate scoring and provenance contracts; their scores say nothing about real
reviewer quality, token use, cost or latency.

## Frozen dataset

`compileEvaluationDataset(definition)` produces an immutable `review-dataset/v1`
with `id: dataset:SHA256`. Definitions have these required fields:

```js
{
  schemaVersion: 'review-dataset/v1',
  name: 'curated-suite', version: '1',
  labelProvenance: {kind: 'human', author: 'curator-id', revision: 'labels-v1'},
  cases: [{
    id: 'case-one', description: 'Independent description of the case',
    baseCommit: 'FULL_COMMIT_SHA', headCommit: 'FULL_COMMIT_SHA', comparison: 'direct',
    labels: [{
      id: 'defect-one', description: 'Independent expected defect description',
      location: {side: 'new', path: 'src/file.ts', startLine: 12, endLine: 12},
    }],
  }],
}
```

Use full effective-base/head commit IDs. `comparison` is direct or merge-base;
labels use old/new sides and inclusive positive line ranges. Cases without known
defects have `labels: []`. Definitions allow 1–100 unique cases and at most 250
unique labels per case. IDs are bounded ASCII identifiers, descriptions at most
4096 characters, label paths at most 4096 characters. Case and label order is
normalized. Content changes, including provenance/version, change the dataset ID.
Default dataset budget is 1 MiB, configurable up to 64 MiB.

Labels must be independently curated and sufficiently complete for the chosen
scope. Review output is not automatically accepted as truth. If a claim reveals
a missing expected defect, resolve it with the curator and version the dataset
before scoring; do not declare it false merely because it is absent. Uncertain
judgments are not accepted as completed adjudication. Provenance is caller supplied
and is not independently authenticated by this tool.

## Recorded run matrix

`evaluateReviewRuns(dataset, input)` accepts `review-evaluation/v1`:

```js
{
  schemaVersion: 'review-evaluation/v1', datasetId: dataset.id,
  baselineCandidateId: 'diff-only', repetitions: 2,
  candidates: [{
    id: 'diff-only', kind: 'recorded-reviewer',
    reviewer: {id: 'existing-reviewer', version: 'adapter-prompt-model-v1'},
  }],
  adjudication: {kind: 'human', author: 'adjudicator-id', revision: 'judgments-v1'},
  runs: [{
    candidateId: 'diff-only', caseId: 'case-one', repetition: 1, status: 'success',
    request, response, // reviewer-request/v1 and reviewer-response/v1
    judgments: [{findingId: 'finding:SHA256', labelId: 'defect-one'}],
    measurements: null,
  }],
}
```

Kinds are `human`/`synthetic` for labels/adjudication and
`recorded-reviewer`/`synthetic` for candidates. Mixed or synthetic evidence is
explicitly marked in the report. Reviewer ID/version must match the packet.
Every candidate/case/repetition slot is required exactly once: 1–8 candidates,
1–10 repetitions, at most 500 total slots. Record failures rather than silently
dropping attempts. The default input budget is 64 MiB, capped at 64 MiB; input
structure shares the plain JSON 500000-value/depth64 limits.

Packets must match case effective-base/head/comparison. Repetitions within one
candidate/case must use the **same request ID**, freezing rules/context/tool
policy as well as source. Different candidates may use different packets for the
same case, such as diff-only versus static caller context. For adaptive reviews,
choose and record a consistent round boundary; varying expanded packets are not
identical-input repeatability evidence.

Successful responses are passed through the reviewer normalizer before scoring.
Every resulting normalized finding requires exactly one judgment referencing
its finding ID and either one case-label ID or null for an independently adjudicated
false positive. Unknown IDs, duplicate/missing judgments, foreign packets and
invalid response contracts fail without a report. There is no text similarity,
location heuristic or automated semantic matching; the label location is a curator's
anchor, and the adjudicator decides which claim identifies which defect.

A failed run instead has `errorCode` (a bounded identifier), `request` and
`measurements`, and omits response/judgments. Its packet is still validated. Failure
records cannot include arbitrary error text or fabricated successful findings.

## Quality metrics

For each successful run:

- TP is the number of distinct expected labels identified by adjudicated claims.
- FP is the number of claims mapped to null plus additional distinct claims mapped
  to an already identified label. One defect cannot inflate recall through duplicate claims.
- FN is the number of expected labels without a matched claim.
- Precision = TP / (TP + FP); recall = TP / (TP + FN);
  F1 = 2TP / (2TP + FP + FN). Zero denominators yield null, not a perfect score.

Exact duplicate claims already removed by the normalizer receive one judgment.
Distinct normalized claims for the same label count as duplicate FPs; their IDs
are retained. Per-run matches/misses, FP/duplicate IDs and original explicit
judgments are in the report. Candidate quality uses micro counts summed across
successful attempts, including conservative scoring of partial/needs-context
reviews against all labels. Failed attempts are excluded from these counts and
retained separately in success/failure/completion coverage. An all-failed candidate
has null quality, not zero or perfect metrics.

Baseline deltas are descriptive precision/recall/F1 differences and remain null
when either quantity is undefined. Inspect `allAttemptsSuccessful`,
`allReviewsComplete`, counts and cases before comparison: unequal failures can
change the set of scored cases. The report does not pick a winner or statistically
establish improvement, and no true-negative/accuracy metric is inferred.

## Repeat stability

Each case/candidate reports mean pairwise Jaccard for successful repetitions:

- `claimJaccard` uses exact claim signatures over rule/severity/title/description
  and source side/commit/path/blob/line range, excluding packet/finding/evidence IDs.
- `matchedLabelJaccard` uses identified truth-label sets, so paraphrases of the
  same adjudicated defect can agree even when exact claims differ.

Jaccard is intersection/union, with two empty sets assigned 1. That convention
measures consistency of empty output; it is not proof of correctness. Expected
versus observed pair counts remain visible when failures remove pairs. Candidate
averages weight observed pairs. One repetition or no available successful pairs
gives null stability. Stable false positives can have high claim stability.

## Usage and latency

Optional measurements are explicitly supplied, not estimated by the harness:

```js
measurements: {
  source: 'observed', // observed | synthetic
  inputTokens: 1200, outputTokens: 200, costUsd: 0.003, latencyMs: 800,
}
```

Each numeric field may be null. Token values are nonnegative safe integers;
cost/latency are nonnegative finite numbers. Candidate summaries retain samples,
missing counts, totals/means and observed/synthetic/mixed/unavailable provenance
per field. Missing is never imputed as zero. Summaries include measured failed
attempts, since a failed request can consume resources. Aggregation overflow fails.

Baseline usage/latency deltas use only matching case/repetition slots where both
measurements are explicitly observed and nonnull for that field. They report
paired sample counts and mean candidate-minus-baseline differences. Synthetic
and absent measurements do not create observed deltas. The harness does not verify
provider invoices, clocks or caller assertions; concrete adapters must record these.

## Reports and CLI

`review-evaluation-report/v1` includes dataset and normalized-evaluation input
IDs, label/adjudicator provenance, candidate summaries, comparisons and per-run
audit records. Report IDs hash normalized content. Candidate/run/judgment ordering
does not change report identity. Output is cloned/frozen and has a default 16 MiB
budget, capped at 64 MiB. Existing bundle/reviewer contracts remain unchanged.

```sh
node src/cli.js dataset --definition fixtures/evaluation/definition.json > dataset.json
node src/cli.js evaluate --dataset fixtures/evaluation/dataset.json \
  --runs fixtures/evaluation/runs.json > report.json
```

`dataset` accepts `--max-dataset-bytes`; `evaluate` accepts `--max-input-bytes` and
`--max-report-bytes`. Bounded UTF-8 regular-file inputs use the same offline JSON
reader. Errors emit JSON on stderr with exit code 1 and no partial stdout.
There are no timestamps or local checkout paths in generated reports.

The [frozen example](../fixtures/evaluation/README.md) has two synthetic cases,
two scripted candidates and two repetitions. Maintainers can regenerate it with
`npm run fixtures:evaluation` from the source checkout; that separate authoring script uses an isolated
temporary synthetic Git repository and never invokes a reviewer. Regeneration
can change packet IDs when the Git/compiler version changes; review and commit
the fixture changes. Real benchmark sources and labeled MR data are not included.

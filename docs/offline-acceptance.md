# Offline MR acceptance

`review-bundle audit` checks Gate 1 (facts and rule relevance) on an ordinary
generated bundle against supplied expectations. It accepts existing bundle v1–v5,
including pinned-source mode and optional semantic/caller context. It performs no
Git reads, network requests, source execution or AI review.

```sh
review-bundle audit --bundle bundle.json --expectations expectations.json > report.json
```

Exit **0** means all assertions pass; **2** means valid inputs produced mismatches
and a complete JSON report; **1** means invalid inputs/limits with a structured
stderr error and no report. A shell pipeline must retain the audit command's exit
status. GitLab and rule-context envelopes must be explicitly unwrapped to their
ordinary `.bundle` before auditing; envelope/MR authenticity is not verified here.

## Prepare expectations before generation

1. Select an approved, locally available MR snapshot and pin requested base,
   effective base, head and comparison. GitLab's direct pinned diff refs and ordinary
   merge-base comparisons are different; record the actual intended comparison.
2. Freeze the trusted rules file. Obtain its config ID with `parseRulesYaml(rulesYaml).id`.
   Independently inspect the MR and author exact changed path pairs, statuses,
   entry kinds, text counts, coverage, required patch lines and rule relevance
   **per change**. Include clean negative changes and unsupported-source cases.
3. Record expectation author/revision and declared cohort. Optionally use
   `compileAcceptanceExpectations(definition)` to obtain a canonical frozen object
   and content ID, then save/commit that object before generating the bundle.
4. Generate the bundle using those pinned refs/rules/mode. Run the offline audit.
   Retain expectations, bundle and report together. Diagnose failures before tuning;
   tuning on a held-out case makes it a development case for future comparisons.

The tool never generates expected labels from bundle output. The supplied author,
approval, cohort and pre-run freezing are **not verified**. Same-author fixtures
remain development evidence; declaring `held-out` does not establish independence.
No approved corporate MR or independent holdout has been tested by this increment.

## Expectations contract

See [acceptance-expectations.json](../examples/acceptance-expectations.json) for a
synthetic template. Replace its example pins with the intended commits/config ID.
Raw definitions have exactly these fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `review-acceptance-expectations/v1` |
| `caseId` | Stable case identifier |
| `cohort` | Caller-declared `development` or `held-out` |
| `provenance` | `{kind, author, revision}`; kind `synthetic` or `approved-mr` |
| `revisions` | `{requestedBaseCommit, effectiveBaseCommit, headCommit, comparison}` |
| `ruleConfigId` | Trusted `rules:SHA256` ID, or explicit `null` for rule-free bundles |
| `ruleSource` | `patch` or `pinned`; pinned requires a non-null config ID |
| `changes` | Exact expected change list, including negative controls |

Each change has exactly `status`, `oldPath`, `newPath`, `oldKind`, `newKind`,
`coverage`, `addedLines`, `removedLines`, `selectedRuleIds`, `requiredPatchLines`
and `sourceCoverage`. A path pair identifies the change; duplicate pairs fail.
Missing file sides require null path/kind. Renames retain both paths. Status is
`A/M/D/R/T`; kinds are `file/symlink/gitlink` or null for an absent side.
Coverage is `text-diff/metadata-only/binary-omitted/special-entry`. Binary/special
counts must be null; available counts are nonnegative integers, including zero.
Required patch lines are exact individual strings, including their `+/-/ ` prefix;
an empty array does not assert patch content. These are required lines, not an
assertion that the complete patch contains no other lines.
The external assertions cover the listed fields. Mode values, rename similarity,
blob identities and caller availability are validated internally where applicable,
but are not independently asserted by this expectations schema. Angular template ownership in v5 is internally validated by the packet boundary; these expectations do not independently assert that relationship.

`selectedRuleIds` asserts the exact set selected for that change. Global rule
agreement cannot hide a rule attached to the wrong file. `sourceCoverage` is null
when no pinned syntax query was recorded, otherwise `{available, reason}` matching
that change's `rule-selection/v4.sourceCoverage` record. It does not assert general
semantic completeness or caller availability. Patch mode requires null here.

Compiled expectations add `id: expectations:SHA256`. Input ordering is normalized
for changes, rule IDs and required lines. Supplying an edited compiled object with
a stale ID fails. Raw definitions are compiled internally by the audit as well.

## Report and validation

API exports: `compileAcceptanceExpectations`, `auditReviewBundle`, `AcceptanceError`.
The audit first validates the ordinary bundle through the existing packet boundary,
recomputing deterministic facts, rule selection and pinned source integrity.
Malformed or rehashed forged selections cannot be treated as ordinary mismatches.

`review-acceptance-report/v1` retains expectation/bundle IDs, declarations,
identity mismatches, exact per-change fact differences, missing patch lines,
false/missed selections, source coverage differences and unexpected changes.
`revisionsPassed` and `rulePolicyPassed` are separate. `factsPassed` requires the
intended revisions and exact facts; a rule-config mismatch can leave facts passing
while rule acceptance fails. `ruleSelectionPassed` requires revisions, config/mode,
exact changes, per-change selection and source coverage agreement. Missing/extra
changes fail, including missing negative changes with empty expected rule sets.
Report IDs hash the deterministic payload; API outputs are cloned and frozen.

Defaults: 1 MiB expectations, 16 MiB bundle, 16 MiB report. API/CLI byte limits can
be set up to 64 MiB. At most 10000 changes, 250 rule IDs/change and 1000 required
lines/change; existing plain-JSON, packet, source and selection limits also apply.
CLI flags are `--max-expectations-bytes`, `--max-bundle-bytes`, `--max-report-bytes`.
API options use the corresponding camelCase names. Unknown fields/options, duplicate
records, invalid paths/counts, getters/cycles and overflow fail without partial output.

Passing means agreement with supplied fact/relevance policy. It does not prove a
defect, framework/runtime correctness, repository/MR authenticity or reviewer benefit.
Gate 2 remains the separate [reviewer comparison](validation-plan.md); every report
explicitly records `reviewerImprovement: not-measured`.

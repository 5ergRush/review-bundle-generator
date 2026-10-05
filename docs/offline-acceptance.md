# Offline MR acceptance

`review-bundle audit` checks Gate 1 (facts and rule relevance) on an ordinary
generated bundle against supplied expectations. It accepts existing bundle v1–v7,
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
but are not independently asserted by this expectations schema. Angular template ownership in v5 is internally validated by the packet boundary; v1 expectations do not independently assert that relationship. Use v2 below for configured changed-template owner assertions.

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

## Configured template owner expectations

`review-acceptance-expectations/v2` retains every v1 field and requires
`angularOwners: {candidatePaths, decisions}`. It requires pinned rule mode.
Author these expectations from the pinned source revisions before generation;
copying discovered owners from a bundle does not establish independent acceptance.
This contract checks the v7 configured owner context, not v5 selected-syntax
context or v6 lexical bindings.

`candidatePaths` is the exact configured set of 1..32 unique relative `.ts` paths
(no declaration files). Ordering is normalized. Each decision has exactly:

| Field | Assertion |
| --- | --- |
| `ruleId` | The rule requesting owner context |
| `oldPath`, `newPath` | Exact expected changed path pair |
| `side` | `old` or `new`; pins the owner to effective base or head respectively |
| `status` | `included` or `omitted` |
| `reason` | Exact owner decision reason |
| `owners` | Exact set of `{path, name, start, end}` class identities |

Each owner path must be in `candidatePaths`. Class ranges use one-based line and
UTF-16 column coordinates in the complete TypeScript source, with an exclusive
end, including decorators. Shared templates require all expected owners; matching
names alone cannot hide a wrong class range. Included decisions require owners;
omitted decisions require an empty list. For an unselected rule, use null paths
and side, `omitted`, `rule-not-selected` and an empty owner list. Other decisions
must refer to a selected expected change with the requested side present.
There must be exactly one expected record per actual rule/change/side decision,
including omissions. Missing or extra decisions fail. Duplicate decisions and
owners fail compilation. Decision and owner ordering is normalized into the ID.

Example additional v2 field for a single unchanged owner:

```json
{
  "angularOwners": {
    "candidatePaths": ["owner.ts"],
    "decisions": [
      {
        "ruleId": "template",
        "oldPath": "screen.view", "newPath": "screen.view", "side": "old",
        "status": "included", "reason": "explicit-template-url-in-candidate-set",
        "owners": [{"path": "owner.ts", "name": "Panel",
          "start": {"line": 2, "column": 1}, "end": {"line": 3, "column": 15}}]
      },
      {
        "ruleId": "template",
        "oldPath": "screen.view", "newPath": "screen.view", "side": "new",
        "status": "included", "reason": "explicit-template-url-in-candidate-set",
        "owners": [{"path": "owner.ts", "name": "Panel",
          "start": {"line": 2, "column": 1}, "end": {"line": 3, "column": 15}}]
      }
    ]
  }
}
```

A v2 audit emits `review-acceptance-report/v2` with `angularOwnersPassed` and
`angularOwners`. The latter retains context availability, expected/actual candidate
paths, per-decision expected/actual values, missed/extra owners and unexpected
decisions. Its `passed` is the relationship comparison; top-level
`angularOwnersPassed` also requires revision/rule identity and no unexpected changes.
Overall `passed` requires facts, rule relevance and owners. An absent owner context
fails even with empty expected decisions. The CLI retains exit 0/2/1 semantics.
V1 expectation IDs and report format remain unchanged; v1 does not assert owners.

At most 10000 owner decisions and 64 owners per decision are accepted, within the
existing byte budgets. Owner assertions do not authenticate missing candidates,
commit/tree membership, MR approval or expectation independence. Matching omissions
means agreement about configured coverage, not proof that no owner exists elsewhere.
Semantic template rule selection, lexical binding expectations, Angular runtime
behavior and reviewer benefit remain outside this audit.

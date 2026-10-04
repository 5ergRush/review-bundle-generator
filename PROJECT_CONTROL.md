# Review Bundle Generator — Project Control

Last updated: 2026-10-04
Canonical repository: https://github.com/5ergRush/review-bundle-generator
Canonical control file: PROJECT_CONTROL.md
Phase: foundation merged; bundle contract and deterministic facts implemented locally; next PR/CI validation pending.

## Resume here

1. Read this file and inspect GitHub main, open PRs and current-head CI before changing anything.
2. PR #1 was verified merged on 2026-10-04 at eb1a0789a40042d9881c0b516dd43c0984ba0998. Foundation final-head CI passed Node 22/24.
3. The next increment is on feat/bundle-contract-facts: diff-only review-bundle/v1 compilation, per-change patch evidence, deterministic facts, stable IDs and explicit partial coverage.
4. Check the bundle-contract PR and current-head Node 22/24 CI. Merge remains a user action unless separately authorized.
5. Next implementation increment after merge: validated scoped YAML rules, deterministic selection and matched/skipped reasons. Semantic analysis and adaptive context remain later stages.
6. Include this control file in every implementation PR; separate completed evidence from planned work.

## Objective and authorization

Build the production Review Reliability Layer, now housed in review-bundle-generator.
The user's team lead approved the project. The user authorized autonomous production development and moving the project to GitHub, and stated the demo is proof-of-concept material only.
On 2026-10-04 the user selected this separate repository and requested a durable, maintained project control file.

The layer improves the existing MR Reviewer's context selection, consistency, and measurable reliability. It is not a replacement reviewer.

## Recovered agreed scope

Production shape: library plus CLI/service core.

- Local Git diff ingestion.
- TypeScript semantic analysis.
- Deterministic rule selection.
- Adaptive, bounded context expansion.
- Reviewer adapters.
- Normalized findings.
- Benchmark/evaluation harness.
- GitLab and the existing reviewer behind adapters.
- Dashboard excluded from v1.

Earlier design direction: start with diff-only context, scoped YAML rules, deterministic facts and explicit matched/skipped reasons; expand context on demand.
Preserve evidence, source revision, reviewer identity, and rule provenance.
Evaluation should measure precision, recall, repeated-run stability, tokens/cost, and latency where actual data is available.

Independent specialist reviewers and provenance-preserving aggregation were discussed in the broader workflow. Their exact execution contract is not recovered; do not silently make runtime multi-agent consensus a mandatory dependency of the bundle generator.

## Evidence and uncertainty

### Verified in this continuation

- GitHub repository exists as 5ergRush/review-bundle-generator.
- Repository access includes pull and push.
- Repository visibility is public.
- Initial contents query returned "This repository is empty"; PR search returned no PRs.
- No existing project-specific control file or production source artifact was found in the searched persistent files.
- Current conversation workspace contained no source files at recovery.

### Historical reports, not revalidated here

The demo was reported to implement:
synthetic MR diff → deterministic facts → YAML rules → matched/skipped rules → on-demand direct_callers context → reviewer packet → normalized mock finding.
It reportedly passed seven tests and build/startup checks. It did not have real GitLab/AI integration or repository-wide indexing.
The prototype workspace was reported as D:\Projects\review-layer, with an HTTP demo on port 4173.
A prior attempt was blocked by an unreachable local Codex Bridge; production work in an isolated checkout was proposed, but no resulting source or validation artifact was recovered.

Do not treat planned work or historical assistant claims as completed production implementation.
The old prototype's source is not present here. It may be used later as a behavioral reference if recovered.
Unrelated arcade, Zaebot, Twinby feature fixes, and business research are separate projects.

## Delivery roadmap

| Increment | Deliverable | Exit evidence | Current state |
| --- | --- | --- | --- |
| 0 | Project recovery and canonical control file | Repository access and initial state verified; control file committed | Committed to main |
| 1 | Library/CLI foundation and local Git ingestion | Frozen base/head revisions; explicit diff semantics; integration tests for changes, renames, deletions and invalid inputs | Merged as PR #1; final-head Node 22/24 CI passed |
| 2 | Bundle contract and deterministic facts | Versioned schema; stable ordering; source provenance; honest unsupported/partial analysis markers | Locally validated; PR/CI pending |
| 3 | Scoped YAML rules and selection | Validated rule input; matched/skipped reasons; tests against representative changes | Pending |
| 4 | TypeScript semantic analysis and adaptive context | Semantic evidence and bounded expansion; context budgets; unresolved references reported | Pending |
| 5 | Reviewer adapters and finding normalization | Documented existing-reviewer contract; adapter failure handling; evidence/provenance preserved | Pending |
| 6 | Repeatable evaluation harness | Frozen fixtures/labels; baseline comparisons; precision/recall/stability; actual usage metrics when exposed | Pending |
| 7 | GitLab adapter and operational packaging | Real integration validation; configuration/security docs; reproducible build and CI | Pending |

These are implementation increments, not percentage-complete claims.
Service transport and exact GitLab/reviewer interfaces remain to be established from integration requirements; do not add a dashboard.

## Engineering and validation boundaries

- Build and validate in the current development workspace; the local Codex Bridge is not a prerequisite for repository work.
- Keep source-controlled code and this document in this GitHub repository.
- The repository is public: commit only generic source, synthetic fixtures and public documentation. Do not upload private Twinby code, real private MR contents, credentials or task specifications.
- Freeze and record Git revisions so a bundle can be reproduced and reviewed against the same input.
- Define whether ingestion uses merge-base or direct revision comparison; record the choice in each bundle.
- Do not execute scripts from analyzed repositories as part of ingestion.
- Keep parsing, context limits and failures explicit; truncation or missing evidence must not appear as a successful full review.
- Add meaningful tests for contracts, Git behavior, deterministic output, budgets and adapter failures as those features land.
- Keep human-labelled benchmark truth separate from reviewer-produced findings.
- Mark mocks and synthetic validation clearly; real integration and operational readiness require their own evidence.

## Decisions and open contracts

| Item | State |
| --- | --- |
| Canonical repository | Selected by user: 5ergRush/review-bundle-generator |
| Product boundary | Existing-reviewer reliability layer; library plus CLI/service core |
| Prototype reuse | Behavioral reference only |
| Initial context policy | Diff-only baseline with bounded, requested expansion |
| Dashboard | Excluded from v1 |
| Existing reviewer request/response contract | Not recovered; needed before adapter implementation |
| GitLab deployment/authentication contract | Not recovered; needed before real integration |
| YAML rule schema and service transport | To be specified and documented during implementation |
| Production source recovery | No artifact recovered; begin from verified repository state |

## Current validation and Git state

- Documentation bootstrap on main: 6c7c8a292d891742471689ad436fc0fb356662db.
- Current implementation branch: feat/bundle-contract-facts, based on main merge eb1a0789a40042d9881c0b516dd43c0984ba0998.
- PR #1: https://github.com/5ergRush/review-bundle-generator/pull/1, verified merged at eb1a0789a40042d9881c0b516dd43c0984ba0998.
- Foundation code commit: 665844e679b81ed2d358c946eb2b8008af0097ac.
- Runtime: dependency-free JavaScript ESM; Node >=22 and Git >=2.43. TypeScript semantic analysis is a later increment, not implemented by this foundation.
- Public library APIs: ingestGitDiff, compileReviewBundle, createReviewBundle; error classes IngestionError and BundleError. CLI commands: review-bundle ingest and review-bundle bundle.
- Versioned ingestion/v1 output records Git version, requested/effective base and head IDs, comparison semantics, rename policy, change metadata, unified patch and explicit limitations.
- Default comparison is unique merge-base; direct comparison is explicit. Unrelated and ambiguous histories fail closed.
- Diff computation uses a temporary bare repository with read-only object alternates; pinned head attributes and isolated configuration. Temporary data is removed after success/failure.
- Inherited Git environment selectors and replace refs are disabled. External diff/textconv programs are never executed.
- Tests cover modifications, additions, deletions, renames, Unicode/tab/newline paths, empty/invalid ranges, divergent/unrelated/ambiguous histories, binary entries, symlinks/gitlinks, mode changes, aggregate/output limits, dirty/local attribute isolation, replace refs, invalid UTF-8 and CLI contracts.
- Local validation on Node v24.19.0 / Git 2.51.1: syntax checks and all 17 integration tests passed; npm pack --dry-run passed.
- Ubuntu 24.04 CI passed for Node 22 and 24 at foundation code commit 665844e679b81ed2d358c946eb2b8008af0097ac: push run #1 https://github.com/5ergRush/review-bundle-generator/actions/runs/37227828125 and PR run #2 https://github.com/5ergRush/review-bundle-generator/actions/runs/37227835872. Both concluded success.
- Foundation final documentation head a6704ceccec00343d3562688a3e3ab27dcf5f013 also passed push run #3 https://github.com/5ergRush/review-bundle-generator/actions/runs/37227909577 and PR run #4 https://github.com/5ergRush/review-bundle-generator/actions/runs/37227914409 before merge.
- Bundle increment local validation: 28 integration tests and syntax checks passed on Node 24 / Git 2.51.1; npm pack --dry-run passed. Remote bundle PR/CI pending at this checkpoint.
- review-bundle/v1 contract is documented in docs/bundle-contract.md. Bundle IDs hash normalized payloads; changes/facts/evidence carry stable references.
- Facts cover Git metadata, text additions/removals and explicit filename-based language hints. Evidence includes exact per-change patches and old/new revision/path/object/hunk coordinates.
- Imported snapshots are structurally checked, not authenticated against Git objects. createReviewBundle derives evidence directly from the checkout.
- Compact bundle serialization has a separate 16 MiB default budget, capped at 64 MiB. Failure emits no partial bundle; there are no AI calls.

### Remaining boundaries

- Bundles are diff-only and explicitly partial. Semantic analysis, rule selection and context expansion are not-run; reviewer/evaluation integrations remain absent. Facts are not defect findings.
- Binary and special-entry text counts are unavailable, not inferred zero. Filename language hints are not semantic evidence.
- Bundle compilation accepts at most 10,000 change records; imported snapshot authenticity is the caller's responsibility.
- Binary contents are omitted. Symlink/gitlink targets are not traversed. Rename detection is heuristic and capped.
- Invalid UTF-8 evidence fails explicitly. Source object-directory paths with newlines are unsupported; changed filenames with newlines are supported.
- Per-command timeout defaults to 30 seconds; default raw+patch budget is 8 MiB (JSON overhead additional). Limits fail without partial output.
- Working-tree/index changes are excluded. Missing shallow history must be supplied by the caller; ingestion never fetches.
- Byte-level reproducibility requires the recorded Git version and policy, not commit IDs alone.
- No production release or real GitLab/reviewer integration exists yet.

## Maintenance rule

Update this file whenever scope, implementation, validation, repository state, blockers or the next action change.
Every checkpoint must separate verified evidence from historical reports and planned work.
Record branch/PR identifiers and CI evidence when they exist. Keep the immediate resume steps accurate.
A new conversation must inspect GitHub's current state before relying on this checkpoint.

## Change log

- 2026-10-04: Recovered prior scope, verified the new empty repository, and prepared the canonical control document. GitHub rejected the initial write with HTTP 403; no commit was created. No production implementation artifact was recovered.

- 2026-10-04: GitHub permissions restored; committed control bootstrap and implemented the first foundation increment on feat/git-ingestion-foundation. Local syntax checks, 17 integration tests and packaging dry-run passed; remote PR/CI review pending.
- 2026-10-04: Opened PR #1. Foundation code passed Node 22/24 push and PR CI; recorded immutable code revision and run URLs. Next implementation increment is the reviewer-bundle contract and deterministic facts.

- 2026-10-04: Verified PR #1 merged. Implemented review-bundle/v1, deterministic metadata/text/path-hint facts, per-change evidence with hunk coordinates, structural validation, stable content IDs and separate serialization budget; 28 tests and package dry-run passed locally.

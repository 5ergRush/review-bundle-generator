# Review Bundle Generator — Project Control

Last updated: 2026-10-04
Canonical repository: https://github.com/5ergRush/review-bundle-generator
Canonical control file: PROJECT_CONTROL.md
Phase: production foundation implementation starting; no production release.

## Resume here

1. Read this file, inspect the default branch, open PRs, and CI before changing anything.
2. The repository was empty on 2026-10-04; this document is its initial bootstrap. No production code or production test results were recovered.
3. GitHub rejected the initial documentation commit with HTTP 403: Resource not accessible by integration. The user reports permissions were updated on 2026-10-04. Retry the documentation commit, then proceed on a review branch.
   Next implementation: library/CLI foundation and immutable local Git diff ingestion, with a documented bundle contract and meaningful integration tests.
4. Work on review branches after this initial documentation bootstrap. Include control-file updates in every implementation PR. Report validation and limitations; do not claim production readiness from prototype checks.
5. Continue through the roadmap below. Existing MR Reviewer integration requires its actual interface contract before implementing its adapter.

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
| 0 | Project recovery and canonical control file | Repository access and initial state verified; control file committed | Document bootstrap |
| 1 | Library/CLI foundation and local Git ingestion | Frozen base/head revisions; explicit diff semantics; integration tests for changes, renames, deletions and invalid inputs | Pending |
| 2 | Bundle contract and deterministic facts | Versioned schema; stable ordering; source provenance; honest unsupported/partial analysis markers | Pending |
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

At initial recovery there were no commits, branches with source, PRs or CI runs to validate.
This checkpoint adds documentation only. No production tests have been run and no product release exists.
The initial commit failed with HTTP 403: Resource not accessible by integration. The repository remains empty; this control file is available separately and has not been committed. Repository metadata reports push permission, but integration write access is not proven. Implementation work is still pending.

## Maintenance rule

Update this file whenever scope, implementation, validation, repository state, blockers or the next action change.
Every checkpoint must separate verified evidence from historical reports and planned work.
Record branch/PR identifiers and CI evidence when they exist. Keep the immediate resume steps accurate.
A new conversation must inspect GitHub's current state before relying on this checkpoint.

## Change log

- 2026-10-04: Recovered prior scope, verified the new empty repository, and prepared the canonical control document. GitHub rejected the initial write with HTTP 403; no commit was created. No production implementation artifact was recovered.

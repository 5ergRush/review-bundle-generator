# Review Bundle Generator — Project Control

Last updated: 2026-10-04
Canonical repository: https://github.com/5ergRush/review-bundle-generator
Canonical control file: PROJECT_CONTROL.md
Phase: PR #3 merged; static TypeScript analysis and bounded direct-caller context implemented on feat/typescript-context; local and Node 22/24 CI passed; PR #4 open.

## Resume here

1. Read this file and inspect GitHub main, open PRs and current-head CI before changing anything.
2. PR #3 was verified merged at 34ff701eb89c3cb419e4e211ad415cd87bfefea1. Its final-head push and PR CI passed before merge.
3. Current branch: feat/typescript-context, based on that merge. Adds opt-in bundle v3, pinned compiler-backed declarations, old/new symbol resolution and requested direct callers. Read docs/semantic-contract.md before extending.
4. PR #4: https://github.com/5ergRush/review-bundle-generator/pull/4. Local clean install, syntax checks, all 50 tests and packaging dry-run passed, as did Node 22/24 push and PR CI. Inspect final-head CI before merge. Merge remains a user action unless separately authorized.
5. Next increment: reviewer adapter and finding normalization contracts. The real existing-reviewer request/response interface is not recovered; obtain that contract before claiming real integration. A generic transport-independent adapter can be designed first.
6. No AI calls in the generator. Full project/Angular analysis, recursive context, installed package and tsconfig support remain future extensions. Include this control file in every PR.

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
| 2 | Bundle contract and deterministic facts | Versioned schema; stable ordering; source provenance; honest unsupported/partial analysis markers | Merged as PR #2; final-head Node 22/24 CI passed |
| 3 | Scoped YAML rules and selection | Validated rule input; matched/skipped reasons; tests against representative changes | Merged as PR #3; final-head Node 22/24 CI passed |
| 4 | TypeScript semantic analysis and adaptive context | Semantic evidence and bounded expansion; context budgets; unresolved references reported | Initial static subset implemented; local + Node 22/24 CI passed; PR #4 open |
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
| YAML rule schema | review-rules/v1 documented in docs/rules-contract.md; no semantic predicates yet |
| Service transport | Still to be established from integration requirements |
| Production source recovery | No artifact recovered; begin from verified repository state |

## Current validation and Git state

- Documentation bootstrap on main: 6c7c8a292d891742471689ad436fc0fb356662db.
- Current implementation branch: feat/typescript-context, based on main merge 34ff701eb89c3cb419e4e211ad415cd87bfefea1.
- PR #1: https://github.com/5ergRush/review-bundle-generator/pull/1, verified merged at eb1a0789a40042d9881c0b516dd43c0984ba0998.
- Foundation code commit: 665844e679b81ed2d358c946eb2b8008af0097ac.
- Runtime: JavaScript ESM; Node >=22 and Git >=2.43. Pinned runtime dependencies: yaml 2.9.1 and typescript 5.9.3, recorded in package-lock.json.
- Public library APIs: ingestGitDiff, compileReviewBundle, createReviewBundle; error classes IngestionError, BundleError and RuleError; parseRulesYaml normalizes explicit rule configuration. CLI commands: review-bundle ingest and review-bundle bundle.
- Versioned ingestion/v1 output records Git version, requested/effective base and head IDs, comparison semantics, rename policy, change metadata, unified patch and explicit limitations.
- Default comparison is unique merge-base; direct comparison is explicit. Unrelated and ambiguous histories fail closed.
- Diff computation uses a temporary bare repository with read-only object alternates; pinned head attributes and isolated configuration. Temporary data is removed after success/failure.
- Inherited Git environment selectors and replace refs are disabled. External diff/textconv programs are never executed.
- Tests cover modifications, additions, deletions, renames, Unicode/tab/newline paths, empty/invalid ranges, divergent/unrelated/ambiguous histories, binary entries, symlinks/gitlinks, mode changes, aggregate/output limits, dirty/local attribute isolation, replace refs, invalid UTF-8 and CLI contracts.
- Local validation on Node v24.19.0 / Git 2.51.1: syntax checks and all 17 integration tests passed; npm pack --dry-run passed.
- Ubuntu 24.04 CI passed for Node 22 and 24 at foundation code commit 665844e679b81ed2d358c946eb2b8008af0097ac: push run #1 https://github.com/5ergRush/review-bundle-generator/actions/runs/37227828125 and PR run #2 https://github.com/5ergRush/review-bundle-generator/actions/runs/37227835872. Both concluded success.
- Foundation final documentation head a6704ceccec00343d3562688a3e3ab27dcf5f013 also passed push run #3 https://github.com/5ergRush/review-bundle-generator/actions/runs/37227909577 and PR run #4 https://github.com/5ergRush/review-bundle-generator/actions/runs/37227914409 before merge.
- Bundle increment local validation: 28 integration tests and syntax checks passed on Node 24 / Git 2.51.1; npm pack --dry-run passed.
- PR #2: https://github.com/5ergRush/review-bundle-generator/pull/2, verified merged at 8f993e5f36a96416855976c61b8ec461e672522e. Code commit 3a2c7728673c0401bf25c6db184dbabc021ecad8 passed Node 22/24 CI: push run #7 https://github.com/5ergRush/review-bundle-generator/actions/runs/37228958916 and PR run #8 https://github.com/5ergRush/review-bundle-generator/actions/runs/37228967546. Both concluded success.
- Bundle final documentation head 0658b9530cf46f9f5035ee50d390f4a983dbdb7b passed push run https://github.com/5ergRush/review-bundle-generator/actions/runs/37229023676 and PR run https://github.com/5ergRush/review-bundle-generator/actions/runs/37229026248 before merge.
- review-bundle/v1 and rules-enabled v2 contracts are documented in docs/bundle-contract.md and docs/rules-contract.md. Bundle IDs hash normalized payloads; changes/facts/evidence carry stable references.
- Facts cover Git metadata, text additions/removals and explicit filename-based language hints. Evidence includes exact per-change patches and old/new revision/path/object/hunk coordinates.
- Imported snapshots are structurally checked, not authenticated against Git objects. createReviewBundle derives evidence directly from the checkout.
- Compact bundle serialization has a separate 16 MiB default budget, capped at 64 MiB. Failure emits no partial bundle; there are no AI calls.

### Remaining boundaries

- Bundles are explicitly partial. Without semantic opt-in, bundles remain diff-only; with opt-in, v3 adds partial static analysis and bounded requested callers. Rule selection is complete only when rules are supplied. Reviewer/evaluation integrations remain absent. Facts are not defect findings.
- Binary and special-entry text counts are unavailable, not inferred zero. Filename language hints are not semantic evidence.
- Bundle compilation accepts at most 10,000 change records; imported snapshot authenticity is the caller's responsibility.
- Binary contents are omitted. Symlink/gitlink targets are not traversed. Rename detection is heuristic and capped.
- Invalid UTF-8 evidence fails explicitly. Source object-directory paths with newlines are unsupported; changed filenames with newlines are supported.
- Per-command timeout defaults to 30 seconds; default raw+patch budget is 8 MiB (JSON overhead additional). Limits fail without partial output.
- Working-tree/index changes are excluded. Missing shallow history must be supplied by the caller; ingestion never fetches.
- Byte-level reproducibility requires the recorded Git version and policy, not commit IDs alone.
- No production release or real GitLab/reviewer integration exists yet.


### Scoped-rule increment

- Input schema review-rules/v1: explicit instructions, scope paths/exclusions, statuses, extensions, entry kinds and optional line thresholds. Unknown keys and malformed configuration fail closed.
- YAML restrictions: single YAML 1.2 core document; no tags/anchors/aliases/merges; bounded UTF-8 input, structure and rule count. CLI accepts a regular rule file through --rules, only for bundle.
- Selection is conventional bounded code, with same-side old/new scope semantics. Binary/special text evidence is unavailable for line conditions and produces an explicit skipped reason.
- Every rule receives a matched/skipped decision. Matches link change/evidence and condition-fact IDs; decisions preserve aggregate rejection counters.
- Config IDs hash normalized rules. Comments/order/default spelling do not change semantic identity. Selected instructions and normalized configuration are embedded for provenance.
- No-rules compilation preserves review-bundle/v1 output. Supplied rules produce review-bundle/v2 with rule-selection/v1 and updated stage coverage; selection is not execution of review instructions.
- Examples in examples/review-rules.yaml are generic and opt-in, not adopted team policy. Rule sources must be trusted review configuration.
- Local Node 24 / Git 2.51.1 validation: syntax checks and all 41 tests passed; clean npm ci and packaging dry-run passed.
- PR #3: https://github.com/5ergRush/review-bundle-generator/pull/3, verified merged at 34ff701eb89c3cb419e4e211ad415cd87bfefea1. Code commit bd8dda2ecd27fb508e125be0e9b7e25da26caa6e passed Node 22/24 CI: push run #13 https://github.com/5ergRush/review-bundle-generator/actions/runs/37229934817 and PR run #14 https://github.com/5ergRush/review-bundle-generator/actions/runs/37229943484. Both concluded success.
- This documentation checkpoint records the tested code revision; inspect final-head CI before merge.
- Limits: 256 KiB YAML; 250 rules; 32 items per selector list; 10,000 AST nodes; depth 12; 5,000,000 counted selection operations; 4,096 string-unit changed-path limit during selection. Exceeding limits returns no partial selection/bundle.

### Static TypeScript/context increment

- Opt-in `semantic: true` / CLI `--semantic` produces review-bundle/v3. Pure diff compilation and no-opt-in v1/v2 remain unchanged. Rule matching is not yet semantic.
- Committed regular TypeScript blobs are read for effective base and head in an isolated Git repository; no worktree, symlink, gitlink, tsconfig, installed dependency or plugin execution.
- Compiler host is entirely source-backed with fixed ESNext/Bundler/JSX-preserve/noLib options. Named changed declarations link exact patch evidence and source commit/blob/ranges. Actual edited lines determine declaration overlap; hunk context alone does not.
- Requested direct callers resolve symbols/import aliases and declaration-node identities. Old targets search old sources, new targets search new sources. Context snippets have immutable source provenance and deterministic IDs.
- Invalid/duplicate/stale target requests fail closed. Whole-snippet omissions are explicit for count/line/byte budgets; shared snippets deduplicate. Semantic and overall coverage remain partial; complete-static-matches only describes resolved matches and budget coverage.
- Source limits: 1000 files per revision; 512 KiB per blob; 8 MiB unique source bytes; 30-second aggregate read deadline plus Git command bounds. Per revision: 250000 AST nodes, 10000 calls; per file: 10000 changed lines. Context: 50 requests, 10 snippets, 80 lines per snippet, 64 KiB serialized evidence bytes. Overall bundle limit still enforced.
- Local clean npm ci, syntax checks, all 50 tests and npm pack --dry-run passed on Node 24 / Git 2.51.1. Nine new integration tests cover declarations, aliases/same names, methods/arrow functions, deleted targets, both revisions, deterministic IDs/dirty isolation, parse/missing imports, special entries, request errors, source/bundle limits, all context budgets and CLI JSON behavior.
- Remaining semantic boundaries: no full project type check, standard libraries, tsconfig/path aliases, Angular templates, dynamic dispatch/function-value flow or recursive call expansion. Parse recovery and unresolved references mean caller absence cannot be proven. Compiler work uses source/node bounds, not a preemptive CPU timeout.
- PR #4: https://github.com/5ergRush/review-bundle-generator/pull/4, open and unmerged. Code commit 5d7e9de50ca57865715497ca4499a0ab81e7743d passed Node 22/24 CI: push https://github.com/5ergRush/review-bundle-generator/actions/runs/37231166525 and PR https://github.com/5ergRush/review-bundle-generator/actions/runs/37231174879, both concluded success. This documentation checkpoint triggers final-head CI; inspect current PR head before merge.

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

- 2026-10-04: Opened PR #2. Bundle compilation and facts passed Node 22/24 push and PR CI at 3a2c7728673c0401bf25c6db184dbabc021ecad8. Recorded run URLs and review handoff; next increment is scoped YAML rule selection.

- 2026-10-04: Verified PR #2 merged; implemented scoped YAML rule selection, strict parser limits, rule provenance, explicit decisions and rules-enabled bundle v2. Local clean install, syntax checks, all 41 tests and packaging dry-run passed. Next increment is TypeScript semantic analysis and bounded adaptive context.

- 2026-10-04: Opened PR #3; code passed Node 22/24 push and PR CI at bd8dda2ecd27fb508e125be0e9b7e25da26caa6e. Recorded rule selection delivery evidence and next semantic/context increment.

- 2026-10-04: Verified PR #3 merged; implemented the initial static TypeScript and bounded direct-caller increment on feat/typescript-context. Local clean-install validation passed all 50 tests and packaging checks; PR #4 open; code commit 5d7e9de50ca57865715497ca4499a0ab81e7743d passed Node 22/24 push and PR CI.

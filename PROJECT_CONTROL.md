# Review Bundle Generator — Project Control

Last updated: 2026-10-05
Canonical repository: https://github.com/5ergRush/review-bundle-generator
Canonical control file: PROJECT_CONTROL.md
Phase: PR #17 verified merged; the next increment adds opt-in parsed Angular template/member relationships on feat/angular-template-bindings. PR #18 is open. Code-head Node 22/24 PR CI passed; verify final documentation-head CI before merging. Real MR acceptance and reviewer benefit remain unmeasured.

## Resume here

1. PR #17 merged at 5d2d6c48b60688acb008998239d8b4f6d8beb933. Its final-head Node 22/24 PR CI passed (run 37305140270). This increment starts from that exact main commit. PR #18: https://github.com/5ergRush/review-bundle-generator/pull/18. Code head 423b2005e732a3adac7593ee8b4931ee7323bfb5 passed Node 22/24 PR CI https://github.com/5ergRush/review-bundle-generator/actions/runs/37314677602. This documentation checkpoint triggers final-head CI; inspect the current head before merge or continuation.
2. Read docs/angular-template-bindings.md. angularBindings: true / --angular-bindings requires angularTemplates: true and pinned v3 rules. Bundle v6 preserves facts, selection v4, template ownership and optional callers while adding angular-template-bindings/v1 through exact @angular/compiler 18.2.14 syntax/scope analysis.
3. Parsed roots distinguish declared component members, template locals, event locals, globals and unresolved names. Members retain pinned TypeScript ranges; external offsets use template bytes and inline offsets use decoded values. Parser errors, entity source transformations, custom interpolation, deferred/ICU templates and for-track scope gaps remain explicit. No directive/type/runtime correctness or defect inference is claimed.
4. Run npm run validate, npm run audit:acceptance, npm run audit:callers and npm run smoke:package. The previous 228 regression tests plus 14 new synthetic Git contracts, eighteen fact/rule cases, eight caller cases and installed v6 smoke passed locally. New checks cover shadowing, references/aliases, named roots/calls/writes, missing/static/ambiguous members, parameter properties/getters, shared templates with separate owners, coordinate fidelity, omissions, forged packets, byte/depth limits, CLI/GitLab/caller/acceptance integration.
5. Next first-priority work remains approved real snapshots with independently authored expectations and HTML-only owner discovery. Current template ownership follows observed TypeScript syntax only. Broader Angular grammar, inheritance, computed members, tracking scopes, directive/pipe/type semantics and exact entity offset remapping remain bounded gaps. The offline acceptance schema independently checks facts/rules but does not independently assert these relationships.
6. Reviewer comparison remains second priority. ChatGPT may review provisionally; Gemini fresh sessions can use fixed instructions, opaque trial IDs and hidden frozen expectations. Production wire format remains deferred. No real MR acceptance, Angular application/runtime validation or actual reviewer-quality gain is measured; the generator makes no AI calls.
7. Future dashboard manual rule add/remove controls must preserve automatic decisions/override provenance and regenerate IDs. Dashboard remains future scope; see docs/validation-plan.md.


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
| 4 | TypeScript semantic analysis and adaptive context | Semantic evidence and bounded expansion; context budgets; unresolved references reported | Initial static subset merged as PR #4; final-head Node 22/24 CI passed |
| 5 | Reviewer adapters and finding normalization | Versioned generic boundary; adapter failure handling; evidence/provenance preserved | Generic contract merged as PR #5; final-head Node 22/24 CI passed; actual existing-reviewer mapping pending |
| 6 | Repeatable evaluation harness | Frozen fixtures/labels; baseline comparisons; precision/recall/stability; usage provenance | Offline harness merged as PR #6; final-head Node 22/24 CI passed; real reviewer evaluation pending |
| 7 | GitLab adapter and operational packaging | Metadata/pinned refs; configuration docs; installed artifact and CI | Merged as PR #7; final-head Node 22/24 CI passed; live corporate integration/deployment still pending |

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
| YAML rule schema | review-rules/v1/v2/v3 documented in docs/rules-contract.md; bounded changed-syntax predicates and opt-in pinned source evidence |
| Service transport | Still to be established from integration requirements |
| Production source recovery | No artifact recovered; begin from verified repository state |

## Current validation and Git state

- Current branch: feat/angular-template-bindings; base main 5d2d6c48b60688acb008998239d8b4f6d8beb933. Local syntax checks and all 242 regression tests (including fourteen new binding contracts), both existing audits and installed-package v6 smoke passed. PR #18 is open. Code head 423b2005e732a3adac7593ee8b4931ee7323bfb5 passed Node 22/24 PR CI https://github.com/5ergRush/review-bundle-generator/actions/runs/37314677602, including both audits, packaging and installed v6 smoke. Verify the final documentation head before merge.
- PR #17 final head 26945e2e30ad4849201c62e65c241d0266fd5e8d passed Node 22/24 PR CI https://github.com/5ergRush/review-bundle-generator/actions/runs/37305140270 and is verified merged. Its branch/base/head records below are historical delivery evidence.
- PR #16 branch was feat/offline-mr-acceptance; base main d0dd0e3abc22a3be7ade34d0b69fea9ec4714432. Local 207-test validation, both audits and installed-package smoke passed. Code head 19f466054cd5978fab0cc4b320ea3fd5d43837c6 passed Node 22/24 push CI https://github.com/5ergRush/review-bundle-generator/actions/runs/37301997271 and PR CI https://github.com/5ergRush/review-bundle-generator/actions/runs/37302010620. The final documentation checkpoint triggers current-head CI; inspect that head before merge.
- PR #15 branch was feat/pinned-rule-evidence; base main f237bed37db2bd6ed7f8aa36bde364f8ba5413c3.
- PR #15 local validation: 193 tests and syntax checks, 18 fact/rule cases, 8 caller cases and installed-package smoke passed. Code head e72dd49db04e39d35727842f2d1f599714799e9b passed Node 22/24 push CI https://github.com/5ergRush/review-bundle-generator/actions/runs/37247798044 and PR CI https://github.com/5ergRush/review-bundle-generator/actions/runs/37247810425. This final documentation checkpoint triggers current-head CI; verify that head before merge.
- Current APIs/CLI include Angular template context, offline MR acceptance, rule-directed caller planning and pinned source mode; contracts and limits are linked in Resume here. No actual reviewer quality gain or real corporate MR acceptance is claimed.

### Historical foundation and delivery evidence

- Documentation bootstrap on main: 6c7c8a292d891742471689ad436fc0fb356662db.
- PR #7 implementation branch was feat/gitlab-packaging, based on main merge 7a6163fe91a586f9df4336f5906e97aa27031b26.
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

- Bundles are explicitly partial. Default patch mode without semantic opt-in remains diff-only; pinned rule mode v4 includes bounded full changed TypeScript sources; Angular opt-in v5 adds explicit component/template metadata context; separately opted-in v6 adds bounded parsed lexical template/member relationships. Semantic opt-in adds partial static analysis and bounded requested callers to v3/v4/v5. Rule selection is complete only when rules are supplied. Generic reviewer boundary, offline evaluation and read-only GitLab metadata/local bundle adapter exist; real provider/GitLab deployment and real labelled evaluation remain pending. Facts are not defect findings.
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
- Remaining semantic boundaries: no full project type check, standard libraries, tsconfig/path aliases, Angular templates, dynamic dispatch, general function-value flow beyond bounded local const identifier copies, or recursive call expansion. Parse recovery and unresolved references mean caller absence cannot be proven. Compiler work uses source/node bounds, not a preemptive CPU timeout.
- PR #4: https://github.com/5ergRush/review-bundle-generator/pull/4, verified merged at e2b819553ccf5485c2d76c9c86e28fd4311a1f96. Code commit 5d7e9de50ca57865715497ca4499a0ab81e7743d passed Node 22/24 CI: push https://github.com/5ergRush/review-bundle-generator/actions/runs/37231166525 and PR https://github.com/5ergRush/review-bundle-generator/actions/runs/37231174879, both concluded success. This documentation checkpoint triggers final-head CI; inspect current PR head before merge.

### Reviewer-boundary increment

- New library APIs: createReviewerRequest, normalizeReviewerResponse, runReviewerAdapter and ReviewerError. Offline CLI commands packet/normalize read bounded UTF-8 JSON regular files. Those commands perform no network/provider invocation or comment posting.
- Versioned reviewer-request/v1, reviewer-response/v1 and review-result/v1 are documented in docs/reviewer-contract.md. Request includes full bundle, matched selected rules, fixed boundary policy and reviewer ID/version; generated request/result data is cloned/frozen.
- Imported packets validate content IDs, recompile Git evidence/facts, reselect YAML rules and check semantic/source references. Content hashes are not signatures and do not authenticate imported data against Git. Generated object-key order must be preserved.
- Normalization rejects foreign request/reviewer identities, unknown evidence/rules, unreviewed rule claims, forged location fields, unavailable/gap lines and primary evidence outside a rule's matched changes. Caller evidence links through its target declaration. Derived commit/path/blob preserve source provenance.
- Normalized findings remain unverified reviewer claims. Exact duplicates deduplicate; ordered IDs and coverage are stable. Complete responses missing selected rules become reviewer-partial; bundle coverage is preserved separately and overall remains partial. Empty findings are not a clean verdict.
- needs-context responses may request supplied declaration IDs. The application owns the next pinned bundle/request round. A previous packet response cannot be reused; no automatic retry/context loop or cost claim.
- Injected adapter receives frozen request plus AbortSignal and is invoked once. Deadline defaults to 30 seconds, capped at 300000ms; timeout aborts/discards late responses. Abort is cooperative; synchronous work cannot be preempted but is rejected after returning past deadline. Failures redact arbitrary adapter errors; malformed responses fail closed.
- Limits: request/result default 16 MiB, response default 1 MiB, configurable caps 64 MiB; 500000 JSON values/depth64; 250 findings/reviewed rules; 32 evidence IDs per finding; title512/description16384 characters; 50 context requests. Full source/context limits remain from the preceding contract. Provider transport/tokens/cancellation and usage instrumentation belong to the concrete adapter.
- Local Node 24/Git 2.51.1: all 69 tests and syntax checks passed. Nineteen new tests cover packet immutability/selection, normalized provenance/order/dedup, identity/scope/location errors, coverage, generic v1 findings, semantic context/two-round stale response handling, tamper checks, limits/plain JSON, failures, asynchronous/synchronous deadlines and offline CLI.
- Actual reviewer transport, credentials, payload mapping and model configuration have not been supplied. This is a generic tested boundary; all reviewer execution fixtures are synthetic. No real AI review or production integration was performed.
- PR #5: https://github.com/5ergRush/review-bundle-generator/pull/5, verified merged at b9f6f9eac6b5da3e6051a02e9415ac7658f319d3. Code commit 813116cea5ae5a02058aca1d851fce84b53a4cf5 passed Node 22/24 CI: push https://github.com/5ergRush/review-bundle-generator/actions/runs/37232508407 and PR https://github.com/5ergRush/review-bundle-generator/actions/runs/37232540208; both concluded success. This documentation checkpoint triggers final-head CI; inspect current PR head before merge.

### Evaluation increment

- New library APIs compileEvaluationDataset/evaluateReviewRuns/EvaluationError and offline dataset/evaluate CLI. Schemas review-dataset/v1, review-evaluation/v1 and review-evaluation-report/v1 documented in docs/evaluation-contract.md. Evaluation itself executes no Git/provider/network/AI.
- Dataset binds independently curated labels/descriptions/old-new source anchors to full effective-base/head commits and comparison semantics. Label/adjudicator/candidate provenance separates human/recorded evidence from synthetic evidence. Assertions are caller supplied, not independently authenticated.
- Every candidate/case/repetition slot is required. Packets are validated through the reviewer normalizer and must match source commits and candidate identity. Repeated runs use the same request ID. Every normalized finding requires one explicit finding-ID→label-ID/null judgment; unknown/duplicate/missing judgments fail closed. No AI judge or heuristic matching.
- Micro precision/recall/F1 count unique matched defects as TP, unmatched plus distinct duplicate claims as FP, missed labels as FN. Zero denominators stay null. Failures are reported separately and excluded from quality/stability; partial/needs-context reviews are conservatively scored against all expected labels. All-failed quality is null.
- Pairwise Jaccard separately compares exact claim signatures and matched truth labels. Expected/observed pair counts show missing evidence; no-pair stability is null. Empty/empty is 1 by convention, not proof of correctness. Baseline deltas are descriptive and carry full-attempt/full-review coverage flags.
- Input/output tokens, USD cost and latency are supplied measurements, never estimates. Summaries preserve observed/synthetic/mixed/unavailable sources and missing counts, include failed attempt resource usage, and reject numeric overflow. Baseline measurement deltas use only paired observed samples; missing/synthetic data yields no observed delta.
- Limits: 100 cases, 250 labels/case, 8 candidates, 10 repetitions, 500 total slots; JSON depth64/500000 values. Dataset default1MiB/input default64MiB/report default16MiB with 64MiB caps. Output IDs hash normalized content; inputs remain caller-owned, outputs cloned/frozen; failures emit no partial report.
- Frozen public fixtures contain 2 synthetic cases, 2 scripted candidates and 2 repetitions (8 successful records) with no usage measurements. A separate maintainer authoring script uses temporary generic TypeScript/Git sources with fixed dates, no hooks and isolated configuration; it never invokes a reviewer. Fixture scores validate formulas only and do not establish real quality improvement.
- Local Node 24/Git 2.51.1: syntax checks, all 86 tests and npm pack --dry-run passed. Seventeen new tests cover independent label identity, known confusion counts/deltas, repeatability/ordering, duplicate claims, explicit judgments, failures/incomplete coverage, complete frozen matrix, packet/revision validation, measurement provenance/paired deltas/overflow, undefined denominators, byte/plain-JSON limits and offline CLI.
- PR #6: https://github.com/5ergRush/review-bundle-generator/pull/6, verified merged at 7a6163fe91a586f9df4336f5906e97aa27031b26. Code commit 0c46a86f6daf4e99ae22e1554ad0d46365f7cbc4 passed Node 22/24 CI: push https://github.com/5ergRush/review-bundle-generator/actions/runs/37234234840 and PR https://github.com/5ergRush/review-bundle-generator/actions/runs/37234273026; both concluded success. This documentation checkpoint triggers final-head CI; inspect current PR head before merge. Actual reviewer/GitLab integration and human-labelled real MR benchmarks remain pending; no production readiness or actual performance claims.

### GitLab and packaging increment

- New APIs normalizeGitLabMergeRequest/fetchGitLabMergeRequest/createGitLabReviewBundle/assertGitLabSnapshotCurrent/GitLabError and checkRuntime. Schemas gitlab-merge-request/v1, gitlab-review-bundle/v1 and review-runtime/v1; contracts/operations documented in docs/gitlab-contract.md and docs/operations.md.
- Official GitLab API v4 single-MR fields and PRIVATE-TOKEN authentication were checked against primary docs. Normalization validates requested numeric project/IID/target/global identity, fork/source identity, state and full consistent base/head/start refs; sha must match diff head. Not-ready refs fail without retries. Untrusted title/description/branch/URL fields are discarded.
- Metadata HTTP client makes one GET to explicitly configured HTTPS instance/base path, omits cookies, rejects redirects and uses optional token header only. Default timeout30s/cap300000ms and response1MiB/cap8MiB apply through streamed UTF-8 JSON read/normalization. Errors redact response bodies/transport details; timeout aborts/cancels/discards late responses. Injected Fetch transports remain trusted/cooperative code.
- Snapshot hashes are not authenticity proofs. Imported snapshots preserve generated key order and are validated. Bundle generation requires opened MR/available source project and exact local recorded base/head objects, uses direct comparison, preserves recorded start and rejects revision overrides. No clone/fetch or GitLab writes. Inner ordinary bundle schema stays unchanged inside a bound envelope with separate default16MiB/cap64MiB budget.
- Freshness comparison validates both normalized snapshots and rejects identity/state/ref changes. It is not an atomic live guarantee or authorization to publish. Real server async/concurrency behavior remains deployment-owned.
- CLI gitlab-snapshot supports live GET or --metadata offline normalization; gitlab-bundle and gitlab-check are local. Only the explicit live metadata command performs HTTP, using optional REVIEW_BUNDLE_GITLAB_TOKEN from environment. No CLI/provider AI invocation, comment/status/approval posting or repository fetching.
- Runtime doctor checks Node>=22/Git>=2.43 with bounded version process; runtime-ready means prerequisites only. Explicit package file list ships source/contracts/examples/synthetic fixtures/control while excluding dev tests/CI/maintainer scripts; private package is not published.
- Installed-package smoke packs/installs tarball offline using cached dependencies, imports exports, exercises installed CLI/bin/doctor, a real synthetic local semantic Git bundle and shipped offline evaluation. New CI step runs this on Node22/24 after source validation.
- Local GitLab/runtime tests (15 new cases) and installed-package smoke passed. Tests cover identity/forks/metadata filtering, not-ready/inconsistent refs, strict instance/token inputs, GET/auth/redirect/error/body/encoding/deadline contracts, stale snapshots, pinned dirty-isolated bundles/budgets/no overrides/no fetch, offline CLI and doctor version failures. HTTP fixtures are mocked; local Git/package checks are real.
- Local validation passed: syntax checks, all 101 tests, packaging dry-run and offline installed-package smoke. PR #7: https://github.com/5ergRush/review-bundle-generator/pull/7, verified merged at fa78409e757f11878f30751d7786ca2b16ea1377. Code head c764c0abfa71bb21c38048c94eb01616fe983ff9 passed Node 22/24 push CI https://github.com/5ergRush/review-bundle-generator/actions/runs/37236409652 and PR CI https://github.com/5ergRush/review-bundle-generator/actions/runs/37236414095, including installed-package smoke. Final head f0c1c2b20af8167f0e451c4163c2ddc62f4d89d9 passed push CI 37236522357 and PR CI 37236524381 before merge. No actual corporate GitLab/reviewer access, provider review, deployment or real MR evaluation occurred. All live integration requirements remain explicit.

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

- 2026-10-05: Verified PR #4 merged; implemented generic reviewer boundary and finding normalization on feat/reviewer-contracts. All 69 tests passed locally; PR #5 open. Code commit 813116cea5ae5a02058aca1d851fce84b53a4cf5 passed Node 22/24 push and PR CI.

- 2026-10-05: Verified PR #5 merged; implemented offline evaluation and frozen synthetic fixtures on feat/evaluation-harness. All 86 tests and packaging checks passed locally; PR #6 open. Code commit 0c46a86f6daf4e99ae22e1554ad0d46365f7cbc4 passed Node 22/24 push and PR CI.

- 2026-10-05: Verified PR #6 merged; implemented read-only GitLab metadata/local bundle adapter, runtime doctor and installed-package CI smoke on feat/gitlab-packaging. All 101 tests, syntax checks, packaging dry-run and offline installed-package smoke passed; PR #7 opened and code-head Node 22/24 push and PR CI passed. The initial CI smoke exposed missing registry metadata in an npm-ci-only cache; seeding the consumer with locked dependency URLs/integrities resolved it and the rerun passed.

- 2026-10-05: Verified PR #7 merged at fa78409e757f11878f30751d7786ca2b16ea1377 and final-head CI success. Saved continuation checkpoint on feat/live-integration-checkpoint. Actual reviewer/GitLab configuration is the next dependency; no new runtime scope was invented.

- 2026-10-05: User reprioritized acceptance: meaningful facts/rules first, measured reviewer benefit second; production reviewer format deferred. Added five-case independent-expectation audit: factual/packet checks pass, two same-file negative controls fail rule specificity. Recorded Gemini fresh-session comparison protocol and future dashboard manual rule overrides.

Validation checkpoint: all 101 regression tests and syntax checks passed locally; acceptance audit fact/packet assertions passed and reports specificity failure explicitly. CI now reproduces the audit; this green execution must not be described as full behavioral acceptance.

Acceptance delivery: PR #8 https://github.com/5ergRush/review-bundle-generator/pull/8 is open. Code head 09bffd96dcb57a9fbc97d870d4cd2df9b847d108 passed Node 22/24 push CI 37238836123 and PR CI 37238842226, including the acceptance audit, 101 regression tests and package smoke. This documentation checkpoint triggers final-head CI; inspect the current head before merge. Passing CI is audit reproducibility, not behavioral specificity or reviewer-quality acceptance.

- 2026-10-05: Verified PR #8 merged. Added versioned evidence-based changed-syntax rule subset and packet recomputation. Expanded acceptance from five to nine authored cases; original two false selections now excluded, all audit checks pass. Runtime/Angular semantics and real reviewer benefit remain unproved.

Changed-syntax validation: all 117 tests and syntax checks passed locally; nine-case facts/packet/specificity audit passed; offline installed-package smoke passed. PR #9 https://github.com/5ergRush/review-bundle-generator/pull/9 is open. Code head 3a238197feb482ebef1698a1f261a318526ed02c passed Node 22/24 push CI 37239794254 and PR CI 37239801467, including acceptance and installed-package smoke. This documentation checkpoint triggers final-head CI; inspect that head before merge. No actual AI reviewer experiment was conducted.

- 2026-10-05: Verified PR #9 merged. Added contextual v3 syntax selectors and Angular-style teardown/loading negative controls; added a real-Git caller audit. Reproduced indirect-call and deletion-only indexing limitations and surfaced them in bundle coverage. Neither framework/runtime correctness nor AI reviewer gains are claimed.

Contextual validation checkpoint: syntax checks and all 131 tests passed locally; fourteen-case fact/packet/specificity audit passed; five-case caller audit passed contract assertions while explicitly confirming two coverage limitations; installed-package smoke passed. PR #10 https://github.com/5ergRush/review-bundle-generator/pull/10 is open. Code head 0aaedb41d671b3b3f0893f748af43304e4c86147 passed Node 22/24 push CI 37240793152 and PR CI 37240800628, including both audits and installed-package smoke. This documentation checkpoint triggers final-head CI; verify the current head before merge. Known caller limitations remain open; no actual AI-quality experiment occurred.

- 2026-10-05: Verified PR #10 merged. Added typescript-analysis/v2 structural counterpart mapping and imported-packet provenance validation. Deletion-only caller acceptance is now passing; unsupported/ambiguous candidates remain explicit and indirect calls remain a known gap. All 148 tests, both audits and installed-package smoke passed locally; PR #11 https://github.com/5ergRush/review-bundle-generator/pull/11 is open. Code head 5f3288f0152a9f3641f58569359e7cd0ee27af56 passed Node 22/24 push CI 37242755401 and PR CI 37242769622, including both audits and installed-package smoke. This documentation checkpoint triggers final-head CI; verify the current head before merge. Indirect calls/rule-directed expansion remain open; no AI reviewer benefit was measured.

- 2026-10-05: Verified PR #11 merged and its main tree against the local checkpoint. Implemented explicit bounded rule-directed caller planning on feat/rule-directed-context, preserving the ordinary inner bundle and per-rule request/omission provenance. Five caller acceptance cases now use automatic planning. Reviewer improvement remains unmeasured. Local syntax checks and all 159 tests passed; fourteen-case fact/rule audit, five-case automatic caller audit and installed tarball smoke passed. PR #12 https://github.com/5ergRush/review-bundle-generator/pull/12 is open. Code head b25d5c0010361a1e3d961e89f7091c63e03552fb passed Node 22/24 push CI https://github.com/5ergRush/review-bundle-generator/actions/runs/37244111742 and PR CI https://github.com/5ergRush/review-bundle-generator/actions/runs/37244119940, including both acceptance audits, packaging and installed smoke. This documentation checkpoint triggers final-head CI; verify the current head before merge. Indirect calls, patch-fragment scope and framework/template relationships remain open; no actual AI-quality experiment has occurred.

- 2026-10-05: Verified PR #12 merged and its main tree against the local checkpoint. Added bounded immutable local const caller resolution, caller-context/v2 binding provenance, shared-budget omissions and legacy import compatibility. Eight caller audit cases distinguish passing const flows from unsupported mutable/property copies. Reviewer improvement remains unmeasured. Local syntax checks and all 172 tests passed; fourteen-case fact/rule audit, eight-case caller audit and installed tarball smoke passed, including automatic alias planning and reviewer packet validation. PR #13 https://github.com/5ergRush/review-bundle-generator/pull/13 is open. Code head 28e4c17df20e570b0179d32123facf45eeeb3dd5 passed Node 22/24 push CI https://github.com/5ergRush/review-bundle-generator/actions/runs/37245708538 and PR CI https://github.com/5ergRush/review-bundle-generator/actions/runs/37245715598, including both acceptance audits, packaging and installed alias-context packet validation. This documentation checkpoint triggers final-head CI; verify the current head before merge. Full-source rule evidence beyond patch fragments, held-out/real MRs, framework/template relationships and general function-value flow remain open; no actual AI-quality experiment has occurred.

- 2026-10-05: Verified PR #13 was merged while its final documentation checkpoint was being recorded. Main commit 62ea92e439b3b68fc34b1ddd65a27103e4ef7e18 has the validated feature tree 71d5f91c738f19835bb8565b34baf20ceda3c9d5. Prepared a documentation-only follow-up on docs/alias-context-checkpoint to put current status, code CI evidence and continuation notes on main. No implementation changes in that follow-up.

- 2026-10-05: Verified PR #14 merged. Implemented pinned changed-source rule selection to address long-method hunk scope loss; new bundle/selection v4 contracts reuse v3 rule predicates. Eighteen fact/rule cases and source-mode packet/caller smoke now exercise the expanded evidence. Reviewer improvement remains unmeasured. Local syntax checks and all 193 tests passed; eighteen-case fact/rule audit, eight-case caller audit and installed tarball smoke passed. PR #15 https://github.com/5ergRush/review-bundle-generator/pull/15 is prepared. Code head e72dd49db04e39d35727842f2d1f599714799e9b passed Node 22/24 push CI https://github.com/5ergRush/review-bundle-generator/actions/runs/37247798044 and PR CI https://github.com/5ergRush/review-bundle-generator/actions/runs/37247810425, including both audits, packaging and installed smoke. This final documentation checkpoint triggers current-head CI; verify that head before merge. Held-out/real MRs and framework/template relationships remain first priority; real reviewer improvement remains unmeasured. Future dashboard manual rule overrides remain tracked.

- 2026-10-05: Verified PR #15 merged and main tree matched the clean local checkpoint. Added offline fact/rule acceptance for supplied approved-MR/held-out expectations, with pinned identity, exact per-change relevance, explicit unavailable counts/source coverage, safe imports and CLI mismatch exit codes. Declarations of approval/independence remain unverified; no real MR or actual reviewer gain is claimed. Local syntax checks and all 207 tests passed; eighteen-case fact/rule audit, eight-case caller audit and installed-package smoke passed. The smoke cache was restored with a clean locked npm ci before rerunning successfully. PR #16 https://github.com/5ergRush/review-bundle-generator/pull/16 is prepared. Code head 19f466054cd5978fab0cc4b320ea3fd5d43837c6 passed Node 22/24 push CI https://github.com/5ergRush/review-bundle-generator/actions/runs/37301997271 and PR CI https://github.com/5ergRush/review-bundle-generator/actions/runs/37302010620, including both audits, packaging and installed smoke. This final documentation checkpoint triggers current-head CI; inspect that head before merge. Approved real MR snapshots/independent expectations and framework/template relationships remain first-priority work; no real AI-quality experiment occurred. Future dashboard manual rule overrides remain tracked.

- 2026-10-05: Verified PR #16 merged and main tree matched the clean local checkpoint. Added opt-in component/template context based on bound Angular import and explicit literal metadata, retaining selected-syntax ownership and pinned blob evidence. Local 228 tests, both existing audits and installed smoke passed. Read/budget failures do not truncate; dynamic/ambiguous/custom/HTML-only ownership remains unsupported. No real MR/Angular runtime/AI-quality claim. PR #17 https://github.com/5ergRush/review-bundle-generator/pull/17 is prepared. Code head 38d07a258dd46684787cfc992603937b1a7bb878 passed Node 22/24 push CI https://github.com/5ergRush/review-bundle-generator/actions/runs/37304861722 and PR CI https://github.com/5ergRush/review-bundle-generator/actions/runs/37304879456, including both audits, packaging and installed smoke. This final documentation checkpoint triggers current-head CI; inspect that head before merge. Approved real MRs/independent expectations, HTML-only ownership and parsed template relationships remain first priority; reviewer benefit remains unmeasured. Future dashboard manual rule overrides remain tracked.

- 2026-10-05: Verified PR #17 merged and its final-head PR CI passed. Implemented separate parsed-template opt-in on feat/angular-template-bindings with pinned Angular 18.2.14 compiler, unique declared member evidence, lexical local/global/unresolved classification and packet recomputation. Local regression/binding contracts, both audits and installed v6 CLI/caller/GitLab/packet/acceptance smoke passed. HTML entity decoding was found to change compiler expression offsets; such bindings now explicitly omit relationships rather than invent raw offsets. Custom interpolation, deferred/ICU templates and tracking scopes retain explicit limits; structural count/byte/depth/operation bounds fail without partial output. Approved real MRs and reviewer-quality comparison remain pending. Future dashboard manual rule overrides remain tracked.

PR #18 delivery checkpoint: https://github.com/5ergRush/review-bundle-generator/pull/18. Code head 423b2005e732a3adac7593ee8b4931ee7323bfb5 passed Node 22/24 PR CI https://github.com/5ergRush/review-bundle-generator/actions/runs/37314677602. All 242 tests, both audits and packaging/installed smoke passed. This documentation-only checkpoint triggers current-head CI; inspect that head before merge. No real MR/AI-quality experiment was performed.

# Review Bundle Generator

Opt-in [changed-template owners](docs/angular-template-owners.md) follows explicit component candidates through repeatable `--angular-owner PATH` (bundle v7), including unchanged owners of template-only edits.

Opt-in [Angular binding relationships](docs/angular-template-bindings.md) adds parsed template locals and pinned component-member references through `--angular-templates --angular-bindings` (bundle v6).

Opt-in [Angular template context](docs/angular-template-context.md) follows explicit
component metadata from selected-rule syntax:
`--rule-source pinned --angular-templates` emits bundle v5.

For approved MR fact/rule checks against pre-authored expectations, use the
[offline acceptance command](docs/offline-acceptance.md):
`review-bundle audit --bundle bundle.json --expectations expectations.json`.

Deterministic context preparation for an existing AI MR reviewer. The generator will compile relevant changes, rules and bounded supporting context; the external reviewer performs the AI review.

**Current increment:** JavaScript ESM library and CLI for committed Git ingestion, deterministic bundles, scoped YAML rules, static TypeScript/caller context, a generic reviewer boundary with normalized findings, offline repeatable evaluation, and a read-only GitLab metadata adapter. Bundles and results preserve evidence and partial coverage. See [PROJECT_CONTROL.md](PROJECT_CONTROL.md) for scope, evidence and the next step.

## Requirements and validation

- Node.js 22 or newer; Git 2.43 or newer available on PATH (uses commit-scoped attributes).
- A local Git working tree with the required commit history available.
- After installing pinned dependencies, local generation/normalization/evaluation needs no API key, network access or AI call. The optional live GitLab metadata command uses a configured HTTPS instance and optional token.

```sh
npm ci --ignore-scripts
npm run validate
node src/cli.js --help
```

## CLI

```sh
node src/cli.js ingest --repo /path/to/checkout --base origin/main --head HEAD
node src/cli.js ingest --repo /path/to/checkout --base COMMIT --head COMMIT --comparison direct
node src/cli.js bundle --repo /path/to/checkout --base origin/main --head HEAD
node src/cli.js bundle --repo /path/to/checkout --base origin/main --rules /trusted/review-rules.yaml
```

Success writes one compact JSON document to stdout. Failure writes a JSON error to stderr, returns exit code 1, and emits no partial snapshot or bundle. Redirect output to a location outside the analyzed checkout if you want to retain it.

Defaults: head `HEAD`, comparison `merge-base`, maximum raw diff output 8 MiB, timeout 30 seconds per Git command. Override with `--max-bytes` (up to 64 MiB) and `--timeout-ms` (up to 300,000). The size limit applies to each Git stdout/stderr stream and to combined raw metadata plus patch bytes; JSON serialization overhead is additional.

## Library

```js
import { ingestGitDiff, IngestionError } from './src/index.js';

const snapshot = await ingestGitDiff({
  repo: '/path/to/checkout',
  base: 'origin/main',
  head: 'HEAD',
  comparison: 'merge-base',
});
```

`base` and `head` are resolved to immutable commit IDs before diffing. `merge-base` compares the unique common ancestor against head, as in a typical MR diff. `direct` compares the requested base commit against head. Missing/ambiguous merge bases fail explicitly; shallow checkouts may need more history fetched by the caller. Working-tree and staged changes are excluded.

## Snapshot contract: git-ingestion/v1

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Explicit ingestion contract version; not a reviewer-bundle schema |
| `tool` | Git version used; reproduce with the same version for byte-level comparisons |
| `revisions` | Requested base, effective base and head commit IDs; comparison policy |
| `policy` | Rename threshold/cap, context lines, algorithm, byte budget and committed-only policy |
| `changes` | Stable path ordering; status, old/new paths, blob IDs, modes and entry kinds |
| `patch` | Unified diff with three context lines; binary contents omitted |
| `limitations` | Explicit coverage boundaries |

Statuses include added (`A`), modified (`M`), deleted (`D`), renamed (`R`) and type-changed (`T`). Absent paths/objects are `null`. Paths are parsed from NUL-delimited Git metadata, including tabs, newlines and Unicode. Paths and patch bytes must be valid UTF-8; otherwise ingestion fails rather than silently corrupting evidence.

Rename detection uses 50% similarity and a 1,000-candidate exhaustive-search limit. Binary files receive Git's binary marker without blob contents. Symlinks and submodules are entries, not traversed repositories. Opt-in static TypeScript analysis and direct-caller snippets are available. A generic injected reviewer adapter is available; a read-only GitLab metadata transport is available. Live GitLab/reviewer validation and evaluations with real labelled MR data remain pending.

Diffs run in a disposable bare repository sharing the checkout's objects read-only. Repository configuration, local attributes, replace refs and uncommitted attributes do not affect patch generation. Attributes are read from the pinned head commit. Global/system attributes and external diff/textconv programs are disabled. The temporary repository is cleaned up on success or failure. Git alternates require the source object-directory path to have no newlines; changed filenames may contain newlines. Available object history remains the caller's responsibility.

## Bundle compilation

```js
import { createReviewBundle, compileReviewBundle } from './src/index.js';

const bundle = await createReviewBundle({ repo: '/checkout', base: 'origin/main' });
const fromSnapshot = compileReviewBundle(snapshot);
```

The versioned [review-bundle/v1 contract](docs/bundle-contract.md) defines stable IDs, per-file evidence, revision/line provenance, deterministic facts and stage coverage. These are diff observations, not defect findings. Imported snapshots are structurally checked, but their authenticity must be established by the caller.

Default compact bundle budget is 16 MiB; use `--max-bundle-bytes` (bundle command only) or `maxBundleBytes` in the library, up to 64 MiB. This includes JSON serialization overhead and is separate from ingestion's raw diff budget. Compilation does not truncate evidence to fit.

## Scoped review rules

Supply `rulesYaml` in the library or `--rules PATH` in the bundle CLI. The strict [review-rules/v1 contract](docs/rules-contract.md) supports file-path scopes, exclusions, statuses, extensions, entry kinds and optional text-change thresholds. [Example rules](examples/review-rules.yaml) are supplied explicitly, not implicitly enabled.

With rules, output becomes `review-bundle/v2`: normalized instructions/configuration and one evidence-linked matched/skipped decision per rule. Without rules, v1 output is preserved. Selection uses conventional bounded code; matching a rule does not mean its review instructions have been executed.

## Delivery

Implementation changes go through review branches. Every increment updates the project control file with its actual validation and remaining limitations. The public repository contains generic source and synthetic fixtures only.

## Static TypeScript context

Use `review-bundle bundle --repo . --base BASE_SHA --head HEAD_SHA --semantic`
to add pinned TypeScript declarations and static-resolution coverage. Request
callers with `--callers declaration:SHA256` using an ID from that bundle and the
same commits. This produces bundle v3; source snippets are bounded and omissions
are explicit. See [the semantic contract](docs/semantic-contract.md) for supported
declarations, compiler limits and the API. Full project type checking, runtime
dispatch and installed dependencies are outside this increment.

## Reviewer packets and results

`createReviewerRequest(bundle, {id, version})` prepares an immutable packet with
selected instructions and the full evidence bundle. `normalizeReviewerResponse`
checks an external response against that packet, derives source locations and
preserves findings as unverified claims. `runReviewerAdapter` invokes a supplied
function once with an AbortSignal and a deadline; no provider client is built in.
See [the reviewer contract](docs/reviewer-contract.md) for schemas and obligations.

The `packet` and `normalize` CLI commands work on local JSON files without AI or
network calls. Existing ingestion/bundle output is unchanged. The concrete reviewer and live GitLab deployment still require validation.

## Offline evaluation

`compileEvaluationDataset` freezes independent defect labels and source commits.
`evaluateReviewRuns` scores explicitly adjudicated recorded responses, compares
baseline quality, and reports repeat stability, failures and supplied usage data.
The `dataset` and `evaluate` CLI commands are offline. Missing metrics stay null;
synthetic results are marked explicitly. See [the evaluation contract](docs/evaluation-contract.md)
and [the frozen synthetic example](fixtures/evaluation/README.md).

```sh
node src/cli.js evaluate --dataset fixtures/evaluation/dataset.json --runs fixtures/evaluation/runs.json
```

The example tests scoring logic; no real reviewer performance has been measured.

## GitLab and installation

The [GitLab adapter](docs/gitlab-contract.md) reads MR metadata, validates identity
and pins local generation to its recorded diff refs. It never fetches repositories
or writes to GitLab. Saved snapshots support offline generation and freshness checks.
Use the inner envelope `.bundle` at the reviewer boundary.

```sh
node src/cli.js doctor
node src/cli.js gitlab-snapshot --instance https://gitlab.example.invalid --project-id 100 --mr-iid 7
```

The snapshot command without `--metadata` performs an HTTPS GET. Optional header
authentication uses `REVIEW_BUNDLE_GITLAB_TOKEN` from the environment. All other CLI
commands remain local and no command calls an AI reviewer. See [operations](docs/operations.md)
for tarball installation, runtime checks, package smoke validation and remaining
live integration requirements.

Changed-code rule conditions are available through opt-in `review-rules/v2`; see
[the rule contract](docs/rules-contract.md), [invariant examples](examples/invariant-rules.yaml)
and [validation plan](docs/validation-plan.md). `npm run audit:acceptance` reproduces
the authored facts/rule audit from the source checkout. These syntax predicates
do not prove runtime defects or measured AI reviewer improvement.

Opt-in `review-rules/v3` adds enclosing-method qualifiers, literal `this` calls and
simple member assignments; see [contextual examples](examples/angular-invariant-rules.yaml).
`npm run audit:callers` checks static caller provenance and reproduces known indexing
limits. These acceptance checks do not demonstrate AI reviewer improvement.

Semantic analysis v2 exposes unique new-revision structural counterparts for
deletion-only edits, with separate provenance and explicit missing/ambiguous
outcomes. See [the semantic contract](docs/semantic-contract.md).

## Rule-directed caller context

`createRuleContextBundle` and `review-bundle rule-context-bundle` accept a trusted
per-rule JSON policy and generate caller requests from selected v3 syntax anchors.
Targets keep rule/evidence/revision provenance; unsupported anchors and target-limit
omissions remain explicit. Pass the envelope's `.bundle` to the existing reviewer
packet boundary. See [the contract](docs/rule-context-contract.md) and
[example policy](examples/context-policy.json). No AI calls or measured reviewer
benefit are introduced.

Caller context also resolves bounded local const identifier copies to named functions.
The packet includes both call and alias-binding evidence under the shared source
budget. Mutable and complex function-value flow remain unsupported; see
[the semantic contract](docs/semantic-contract.md).

Use `--rule-source pinned` with v3 rules to recover enclosing-method context from
complete pinned changed TypeScript files, even when a diff hunk omits the header.
This opt-in produces bundle/selection v4 with blob-verified source evidence; semantic
analysis remains optional. See [the pinned rule evidence contract](docs/pinned-rule-evidence.md).

# review-bundle/v1 contract

Supplying `rulesYaml` now produces **review-bundle/v2**, adding the versioned [rule-selection section](rules-contract.md) and marking rule selection complete. All base change/evidence/fact/provenance semantics below are preserved. Without rules, v1 output is unchanged. Rule selection is instruction preparation, not completed review; overall coverage remains partial.

This increment compiles a **diff-only bundle**. Facts are observations about Git changes, not AI findings. Every bundle explicitly states that semantic analysis, rule selection and context expansion have not run.

## Public APIs

```js
import { createReviewBundle, compileReviewBundle, BundleError } from '../src/index.js';

const bundle = await createReviewBundle({ repo: '/checkout', base: 'origin/main' });
// Or compile a previously captured, trusted git-ingestion/v1 snapshot:
const sameBundle = compileReviewBundle(snapshot, { maxBundleBytes: 16 * 1024 * 1024 });
```

`createReviewBundle` uses the ingestion options plus optional `maxBundleBytes` and `rulesYaml`. `compileReviewBundle` accepts these compiler options and a snapshot from the current ingestion contract, normalizes supported fields and rejects unsupported versions/policies, invalid provenance shape, duplicate paths, malformed hunks and missing/mismatched patch sections. Unknown input fields are not carried into the bundle.

Compilation validates structure and internal consistency; it does **not** contact Git to prove that an imported snapshot is genuine. Use `createReviewBundle` to derive evidence from a checkout. Imported snapshots must be obtained from a trusted source.

## Required output fields

| Field | Contract |
| --- | --- |
| `id` | `bundle:` followed by SHA-256 of the compact JSON payload excluding `id` |
| `schemaVersion` | Exactly `review-bundle/v1` |
| `provenance` | Ingestion version, Git version, pinned revisions and ingestion policy |
| `summary` | File count; text additions/removals; binary and special-entry counts; explicit text-count exclusion policy |
| `changes` | Ordered records with IDs, status, old/new paths, modes, object IDs, kinds, evidence IDs and coverage |
| `evidence` | Per-change Git patches, source locations and hunk ranges |
| `facts` | Stable facts referencing both change and evidence IDs |
| `coverage` | Partial status, stage completion markers and sorted limitations |

No timestamp, absolute checkout path, random run ID or AI response is included. Change records are sorted by their destination path (source path for deletions), using locale-independent comparison. Evidence follows change order. Fact order within each change is file-change, text-change when applicable, then path-hint. Supported input properties are normalized into fixed key order before hashing. Changing evidence, source revisions or recorded ingestion policy changes the bundle ID. The compiler's output byte ceiling does not change the ID of a bundle that fits.

IDs are integrity/identity references, not signatures or proof of trusted authorship.

## Change records

Each record contains `id` (`change:<sha256>`), ingestion fields `status`, `similarity`, `oldPath`, `newPath`, `oldMode`, `newMode`, `oldObject`, `newObject`, `oldKind`, `newKind`, plus `evidenceIds` and `coverage`.

`coverage` is one of:

- `text-diff`: unified text hunks available.
- `metadata-only`: no text hunks, such as a pure rename or mode change.
- `binary-omitted`: Git classified content as binary; blob contents are unavailable in the patch.
- `special-entry`: at least one side is a symlink or gitlink; targets are not traversed.

Binary coverage takes precedence if an entry is both special and classified binary. Summary counters may therefore overlap; they are not a partition of changed files.

## Evidence records

Each record contains `id` (`evidence:<sha256>`), `type: git-patch`, `changeId`, `origin`, `content` and `hunks`.

`origin.old` is `null` for additions; otherwise `{ commit, path, object }` references the effective base. `origin.new` is `null` for deletions; otherwise it references head. `content` preserves the exact Git patch section(s), including headers and missing-final-newline markers. A type change can contain separate deletion/addition sections under one evidence record.

Each hunk is `{ old: { start, lines }, new: { start, lines } }`. Starts are Git's 1-based line coordinates; a zero-length side can have start 0. Counts are hunk span lengths, including context, rather than the number of changed lines. The enclosing origin identifies the path and revision for each side.

## Fact records

Each fact contains `id` (`fact:<sha256>`), `type`, `changeId`, `evidenceIds` and `value`.

| Type | Value | Interpretation |
| --- | --- | --- |
| `file-change` | Status, old/new paths and kinds, `modeChanged` | Deterministic Git metadata |
| `text-change` | `addedLines`, `removedLines`, `hunkCount` | Counts from patch hunks; unavailable for binary and special entries |
| `path-hint` | Lowercase `extension`, `language` or null, `basis: filename-only` | File naming hint; not semantic evidence or confirmed framework identity |

Text metrics count only added/removed content lines. Patch headers, context lines and missing-final-newline markers do not contribute. Binary/special entries have no text-change fact; absent metrics must not be interpreted as zero content changes.

## Coverage and limits

Current stages: `gitDiff: complete`, `deterministicFacts: complete`; `semanticAnalysis`, `ruleSelection` and `contextExpansion` are `not-run`. Top-level coverage is always `partial` in this increment, even for an empty diff.

Compilation accepts at most 10,000 changed records and a patch bounded by the ingestion policy (at most 64 MiB). Default serialized bundle limit is 16 MiB, configurable up to 64 MiB. The limit measures compact JSON UTF-8 bytes including IDs and evidence; the CLI emits this exact encoding plus one trailing newline. Exceeding it throws `BundleError` with `BUNDLE_LIMIT` and returns no partial output. This is a byte budget, not an LLM token estimate. Ingestion retains its separate raw-output budget and timeouts.

Malformed snapshots fail with `INVALID_SNAPSHOT`; malformed compiler options fail with `INVALID_INPUT`. Bundles never silently drop changed files to fit a budget.

Future contract changes must preserve existing semantics or use a new schema version. A future reviewer adapter must interpret coverage markers and avoid treating not-run stages as completed review.

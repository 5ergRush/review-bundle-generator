# Review Bundle Generator

Deterministic context preparation for an existing AI MR reviewer. The generator will compile relevant changes, rules and bounded supporting context; the external reviewer performs the AI review.

**Current increment:** dependency-free JavaScript ESM library and CLI for committed Git diff ingestion. This is not yet a compiled reviewer bundle or a production release. See [PROJECT_CONTROL.md](PROJECT_CONTROL.md) for scope, evidence and the next step.

## Requirements and validation

- Node.js 22 or newer; Git 2.43 or newer available on PATH (uses commit-scoped attributes).
- A local Git working tree with the required commit history available.
- No API key, network access, runtime package dependency or AI call is needed for ingestion.

```sh
npm ci --ignore-scripts
npm run validate
node src/cli.js --help
```

## CLI

```sh
node src/cli.js ingest --repo /path/to/checkout --base origin/main --head HEAD
node src/cli.js ingest --repo /path/to/checkout --base COMMIT --head COMMIT --comparison direct
```

Success writes one JSON document to stdout. Failure writes a bounded JSON error to stderr, returns exit code 1, and emits no partial snapshot. Redirect output to a location outside the analyzed checkout if you want to retain it.

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

Rename detection uses 50% similarity and a 1,000-candidate exhaustive-search limit. Binary files receive Git's binary marker without blob contents. Symlinks and submodules are entries, not traversed repositories. No semantic facts, YAML selection, adaptive context, reviewer integration or evaluation harness are implemented yet.

Diffs run in a disposable bare repository sharing the checkout's objects read-only. Repository configuration, local attributes, replace refs and uncommitted attributes do not affect patch generation. Attributes are read from the pinned head commit. Global/system attributes and external diff/textconv programs are disabled. The temporary repository is cleaned up on success or failure. Git alternates require the source object-directory path to have no newlines; changed filenames may contain newlines. Available object history remains the caller's responsibility.

## Delivery

Implementation changes go through review branches. Every increment updates the project control file with its actual validation and remaining limitations. The public repository contains generic source and synthetic fixtures only.

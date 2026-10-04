# Static TypeScript analysis and caller context

`createReviewBundle({repo, base, head, semantic: true})` opts into
`review-bundle/v3`. Without this option, v1/v2 output remains unchanged.
`compileReviewBundle(snapshot)` remains a pure diff compiler and never reads sources.
Rules can be supplied alongside semantic analysis; semantic declarations do not
change rule selection in this increment. No AI calls occur.

## Source and compiler boundary

The generator reads regular committed `.ts`, `.tsx`, `.mts`, and `.cts` blobs
(including declarations) from the effective base and head. It reads no working
tree files, symlink targets, gitlinks, tsconfig, installed dependencies or compiler
plugins. Tracked dependency TypeScript sources are included like any other source.
Git configuration is isolated in a temporary bare repository using read-only object
alternates. Git sources are UTF-8; invalid encoding fails without replacement.

TypeScript 5.9.3 is pinned. A compiler host backed entirely by those blobs uses
fixed ESNext target/module, Bundler resolution, JSX preserve and noLib. Relative
imports can resolve to pinned files. Path aliases, package metadata, JavaScript
sources and standard libraries are unavailable. This is static symbol analysis,
not a project build, type-check verdict, Angular template analysis or proof of
runtime behavior. Both revisions report parse diagnostics, unresolved static
import/export specifiers, and unresolved call counts. Dynamic imports and runtime
dispatch are outside this contract. Parse recovery can yield approximate nodes.

Limits fail without a partial bundle: 1000 TypeScript files per revision,
512 KiB per blob, 8 MiB across unique blobs in both revisions, 30-second aggregate
source-read deadline (setup/tree Git operations additionally have per-command
30-second timeouts), 250000 traversed AST nodes and 10000 call sites per revision,
10000 changed lines per TypeScript file. Deep traversal fails explicitly.
Compiler parsing/checker work is bounded by source/node sizes rather than a
preemptive wall-clock timeout. Existing Git output and overall bundle budgets
also apply.

## Changed declarations

`semanticAnalysis` now contains `typescript-analysis/v2`, compiler version, policy,
revision summaries, declaration records and counterpart decisions. Imported legacy
`typescript-analysis/v1` remains supported. Supported named declarations are
identifier-named functions, methods, classes, interfaces, type aliases, enums and
variables (including arrow-valued variables). Constructors, anonymous declarations,
binding patterns and computed/string-literal names are not separate targets.
Enclosing supported declarations can also be marked changed when their body changes.
Directly changed records require actual added/removed lines intersecting declaration
ranges; unchanged hunk context does not mark them directly changed. Separate
structural counterpart records can expose remaining new-side targets. Metadata-only changes have no changed declarations.

Each record carries `id`, `side`, `name`, `qualifiedName`, AST `kind`, `changeId`,
patch `evidenceIds`, and source `origin` with commit/path/blob and 1-based line/column
coordinates. End coordinates are exclusive. IDs hash the complete record, excluding
the ID. They bind the declaration to its source revision and diff evidence.
Old/new declarations have independent source IDs. Structural counterpart links
do not assert semantic equivalence.

## On-demand direct callers

First generate a semantic bundle. Select a declaration ID, then regenerate using
the same pinned effective-base/head commits and:

```js
contextRequests: [{kind: 'direct-callers', targetId: declaration.id}]
```

CLI equivalents:

```sh
review-bundle bundle --repo . --base BASE_SHA --head HEAD_SHA --semantic
review-bundle bundle --repo . --base BASE_SHA --head HEAD_SHA --semantic --callers declaration:SHA256
```

`--callers` is repeatable. Requests require semantic mode, accept only the two
documented keys, and must have distinct target IDs (maximum 50). Unknown IDs fail
closed. Reuse of an ID requires the same declaration record to exist; explicitly
pin both commits to reproduce the entire bundle.

The compiler resolves call/new-expression symbols, follows import aliases, and
matches symbols or their declaration nodes. The search covers pinned TypeScript
sources on the target's side only. It does not expand recursively or follow
dynamic dispatch, indirect function-value flow, reflection or runtime callbacks.
Unresolved sites are counted and never claimed to be absent callers.

`contextExpansion` contains `caller-context/v1`, policy, sorted request decisions,
and serialized evidence byte usage. Each decision records every matched call's
origin, an evidence ID or an explicit omission. Evidence is the complete nearest
enclosing statement/function node snippet, with immutable origin. Identical
snippets are deduplicated across call sites and requests. Limits are global:
10 unique snippets, 80 source lines per snippet, and 64 KiB of compact serialized
evidence records (including metadata/IDs, excluding array separators). Snippets
are omitted whole with `snippet-line-limit`, `snippet-count-limit` or
`context-byte-limit`; no unmarked truncation occurs. Request order is normalized;
source traversal order determines budget allocation.

Semantic coverage remains `partial`. Context coverage is `not-requested`,
`complete-static-matches`, or `partial` when snippets are omitted.
`complete-static-matches` only describes budget coverage of resolved matches:
zero static callers is not proof of no callers. The final compact bundle budget
is enforced after semantic/context records are added and fails without output.
Rules remain selected instructions, not executed reviews; facts are not findings.

## Structural counterparts: typescript-analysis/v2

After both pinned revisions are analyzed, each directly changed old declaration
gets one counterpart decision. Candidate grouping uses the same recorded change,
AST kind and qualified name. It requires exactly one old and one new candidate,
with parseable sources and supported named scope. Git renames can match within
one recorded rename change; unrelated files or renamed declarations do not match.
At most 10,000 candidates are indexed per revision; exceeding that budget fails
with SEMANTIC_LIMIT. Candidate grouping and indexed lookups use bounded maps.

| Status | New target |
| --- | --- |
| `already-indexed` | Existing directly edited new record, retaining its original ID |
| `matched` | New record with `basis: structural-counterpart` and `counterpartOf: old ID` |
| `missing` | Null: no candidate remains in indexed TypeScript sources |
| `ambiguous` | Null: old/new candidates are not unique, including overloads |
| `parse-unavailable` | Null: relevant source has parse diagnostics |
| `source-unavailable` | Null: new path is outside the indexed TypeScript sources/kinds |
| `unsupported-scope` | Null: anonymous function or unnamed conditional block ancestry |

`counterparts` decisions contain `oldTargetId`, `status`, `newTargetId`, ordered by
old ID. A matched new record has the normal pinned source coordinates/blob/change
links plus explicit basis/old-target provenance; its ID hashes all those fields.
These records can be requested by `direct-callers` just like edited targets.
An old-only deletion therefore permits new-revision caller context for a remaining
unique declaration. Deleting a whole declaration/file does not falsely mark the
next declaration, and an ambiguous or unavailable outcome fabricates no target.

This is a structural association, not proof of declaration identity, equivalent
behavior, or runtime dispatch. A replaced definition with the same unique
kind/name can be structurally associated; inspect the actual source evidence.
Existing directly edited declaration IDs remain unchanged, but semantic bundle
IDs change because the analysis schema/metadata has changed. Reviewer packet
validation accepts v1/v2, verifies link/status/provenance consistency and rejects
missing/duplicate/inconsistent decisions. It cannot authenticate the source or
re-run the TypeScript AST from the small imported snippets; use trusted local Git
bundle generation for actual source provenance, as before.

## Acceptance coverage and remaining gaps

`npm run audit:callers` checks old/new caller counts, aliased imports, same-name
exclusion, exact lines/revisions, source snippets and packet validation. The prior
deletion-only limitation is now a passing acceptance case with explicit structural
provenance. The variable-indirect case (`const invoke = validate; invoke(...)`)
remains limitation-confirmed; contract checks are not complete caller coverage.

Rules still select from changed syntax. Caller snippets require explicit requests
and do not automatically determine rule relevance. Counterpart mapping is
conservative, and zero static matches is not proof of no runtime callers. No
Angular framework or template/runtime analysis is performed.

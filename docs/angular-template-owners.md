# Changed-template component ownership

`angularOwnerPaths: ['views/panel.ts']` / repeatable `--angular-owner PATH` adds
bounded, opt-in ownership lookup for selected changed template paths. It requires
`angularTemplates: true` and pinned v3 rules. Output is **review-bundle/v7** with
an `angular-template-owners/v1` section named `angularTemplateOwnerContext`.
The original template context remains present and unchanged; facts, changes and
rule selection retain their identities. Earlier modes retain their versions/output.

```sh
review-bundle bundle --repo /checkout --base BASE --head HEAD \
  --rules /trusted/rules.yaml --rule-source pinned --angular-templates \
  --angular-owner views/panel.ts --angular-owner views/dialog.ts \
  --angular-bindings
```

The library/CLI GitLab and rule-directed caller operations support the same option.
Binding parsing remains optional; when requested it also parses the discovered
owners' changed templates with their pinned source member declarations. A template
can have multiple owners. Each is retained; members never leak between classes.

## What is searched

The operator supplies 1..32 unique repository-relative `.ts` source paths. Paths
are sorted deterministically. Declaration files, globs, root/parent escapes,
backslashes and newline/NUL spellings are rejected. This is a configured candidate
set, not a whole-repository search or a project configuration inferred from names.
Only revision sides in existing selected rules' `matchedPaths` are searched.
Unselected rules do not trigger reads. A selected regular text or metadata-only
side (such as an unchanged-content rename) is eligible; known binary/special sides
emit `changed-template-text-unavailable` without candidate reads for that side.
No template filename extension convention is required.

In each pinned side's commit, candidate regular blobs are read through the isolated
Git source reader. Working-tree files, links and repository scripts are not used.
Missing/non-regular candidates record `candidate-not-regular-or-missing`; malformed
candidate TypeScript records `parse-unavailable`. All available candidate bytes are
included, including candidates without an owner match, so imported packets can
recompute the same parsed positive and negative results. Unrelated files outside
the configured list are neither read nor included by this operation.

The existing bound `@angular/core` named/namespace Component import and explicit
literal `templateUrl` parser is reused. Every candidate class records its source
range and relation or omission reason. Dynamic/ambiguous/custom metadata, custom
or type-only decorators, shadowed bindings and inline templates do not establish
ownership of an external changed path. Literal relative URLs resolve against the
candidate's own source directory in the same commit. Old/new metadata is checked
independently; ownership is never copied from the other side or a similar filename.

Each rule/change/matched-side decision records its patch ID, path, commit, owners,
status and reason. A missing match is `owner-not-resolved-in-candidate-set`, which
is not proof of no component owner. The scan records show missing/parse/unsupported
candidates; `candidateCoverage` remains `configured-paths-only`. Explicit path rules
remain path rules. Discovery selects no new rules, does not claim semantic template
rule specificity, and does not turn context into a defect finding.

## Evidence and packet scope

Full candidate bytes are `angular-owner-source` evidence; discovered changed
external templates are `angular-owner-template-source` evidence. Both record
content IDs, pinned commits/paths/blob hashes and exclusive full-file ranges.
Changed-file objects/kinds are cross-checked with the diff metadata. Identical bytes
in different commits keep their separate provenance. Shared owners/templates are
deduplicated by revision/path for source reads, not reduced to one class.

Packet validation checks full source shapes, UTF-8 content, ranges, IDs, blob hashes
and source budgets, then recomputes the complete candidate scans and owner decisions.
It also recomputes optional bindings. Missing/extra owned template evidence,
removed owners while retaining candidate bytes, forged names/metadata/coordinates,
changed-file object disagreement and wrong classifications fail even if the bundle
is rehashed. Legacy packets cannot import the new evidence types.

Imported content hashes do not authenticate Git tree membership or source completeness.
In particular, declared candidate absence cannot be proved from an offline bundle.
Local generation checks the actual pinned tree, but an imported packet remains a
structural consistency check. Candidate paths are explicit operator input, not
cryptographically authenticated policy. The ordinary offline acceptance schema
checks facts/rules, not independently labelled ownership completeness.

Normalized owner-template claims must belong to the cited selected rule's owner
decision. Primary candidate-source locations must additionally stay within a
relevant owning class or its decorator import binding. An unrelated class elsewhere
in the same included source cannot become primary evidence for that rule. Claims
remain unverified. No counterpart caller requests are inferred from a path rule.

## Bounds and limits

At most 32 candidate paths / 64 revision-path sources, 512 KiB/source and 4 MiB
stored candidate bytes. Candidate ASTs retain the existing 250000-node/file limit
and share a 5-million counted operation ceiling. Ownership decisions are limited
to 10000. At most 10 distinct owned template **revision/path sides**, 32 KiB/file
and 128 KiB total, separate from original syntax-directed template sources. These
limits fail without partial output. The shared reader has its existing bounded
Git/tree output and 30-second source-read deadline. Parsing uses structural bounds,
not a hard wall-clock preemption guarantee.

Binding parsing applies its own combined 64-template/128-KiB/depth/node/operation
limits across syntax-directed and changed-template owners. Bundle, packet and
envelope size limits remain independent. Broader directive/pipe/type/runtime
semantics, inherited/computed members, entity offset remapping, deferred/ICU analysis
and tracking scope remain the existing explicit parser limits. Synthetic tests and
installed-package smoke verify this contract; no actual corporate MR, application
build/runtime validation or reviewer-quality improvement is claimed.

Supplied owner expectations can be audited independently with the v2 contract in
[offline acceptance](offline-acceptance.md#configured-template-owner-expectations).

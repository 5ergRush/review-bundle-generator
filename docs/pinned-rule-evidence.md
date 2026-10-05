# Pinned source evidence for rules

Small diff hunks can omit the enclosing function/method header or be unparseable
fragments of an otherwise valid file. `ruleSource: 'pinned'` fixes that context gap
by parsing complete **changed regular .ts source sides** from the exact effective
base and head. It requires explicitly supplied `review-rules/v3`. The predicates
and configuration IDs retain their existing format; no new predicate language or
AI calls are introduced. Default `ruleSource: 'patch'` retains existing behavior.

```sh
review-bundle bundle --repo /checkout --base BASE --head HEAD \
  --rules /trusted/rules.yaml --rule-source pinned
review-bundle rule-context-bundle --repo /checkout --base BASE --head HEAD \
  --rules /trusted/rules.yaml --context-policy /trusted/policy.json --rule-source pinned
```

`createReviewBundle`, `createRuleContextBundle` and the GitLab bundle adapter accept
the same option. `--semantic` remains a separate opt-in. The output is
`review-bundle/v4` with `rule-selection/v4`; semantic/caller sections are present
only when requested. Automatic rule-directed caller generation opts into semantic
analysis itself. Without pinned mode, bundle v1/v2/v3 and selection v1/v2/v3 retain
their contracts. Git change/fact/provenance semantics and IDs are preserved.

Each `typescript-rule-source` evidence record contains `changeId`, `side`, complete
`content`, and `origin` with commit/path/blob/start/end. Its evidence ID hashes that
record. File ranges start at line 1/column 1 and end exclusively; an empty file has
an empty range. Source bytes are checked against their SHA-1 or SHA-256 Git blob
ID, including the Git blob header. BOMs and CRLF are preserved. UTF-8 decoding is
strict, with no replacement or text transformation. No working-tree sources,
symlinks, installed packages, tsconfig or source execution are used.

Limits fail without partial output: 64 source sides, 512 KiB per file, 4 MiB of
source content, 250000 lexical/AST nodes per parsed file, and the existing 5 million
selection operations. Existing Git reader limits/timeouts and overall bundle and
reviewer request budgets also apply. Source text is a separate explicit budget from
the caller/alias snippet budget (10 snippets/80 lines/64 KiB). A large MR may need
a different later batching policy; this mode never silently truncates source files.

Observations are derived from full AST nodes, grouped and compared within the
actual diff hunks. Tokens exclude comments/trivia. Qualifying nodes must have an
actual edited token or an edited nearest enclosing named-function identifier.
Complete node token fingerprints and named parent scopes distinguish unchanged
syntax and same-named methods in different classes. A renamed method header can
anchor a distant unchanged node whose enclosing name changed. This is syntactic
change evidence, not binding identity, execution order or defect proof.

Each observation carries the original patch `evidenceId`/`hunkIndex`, a
`sourceEvidenceId`, pinned AST `origin`, node line range and nearest named scope
and name line. Source mode verifies patch-side line text against those full files.
The automatic context planner retains both patch and source anchors. AND predicates
still have to match within one recorded change and the scoped side; a source file
merely existing or containing keywords is insufficient.

`sourceCoverage` records each queried change's availability, reason and source
evidence IDs. Full-file parse errors, unsupported sources and unavailable nearest
scope remain explicit. Anonymous callbacks do not inherit an outer method's name.
This increment supports LF/CRLF; lone CR and Unicode line separators produce
`unsupported-line-separators` because Git diff lines and TypeScript line positions
would differ. TSX/MTS/CTS/HTML and metadata-only/binary/special-entry changes are
not part of these predicates. Framework/template ownership and runtime correctness
remain outside this contract.

For offline compilation, supply the complete generated records explicitly:

```js
compileReviewBundle(snapshot, {
  rulesYaml, ruleSource: 'pinned', ruleSourceEvidence: records,
});
```

The pure compiler performs no I/O, verifies completeness/provenance/blob bytes and
clones the supplied evidence. Missing/extra/duplicate/stale records fail. Reviewer
packet validation accepts v4, re-verifies all source identities and recomputes rule
selection from the supplied bytes and patches. Source evidence can be cited with
`side: 'source'` within the matched change; normalized findings remain unverified
reviewer claims. Blob verification binds content to the claimed blob, but imported
snapshots still do not authenticate a repository, commit or actual MR.

Acceptance now has eighteen authored real-Git cases, including long teardown/loading
changes and same-path refresh/reset controls. The new positives assert that patch
mode misses the qualifier while pinned mode selects it without changing facts.
These checks verify facts/context/rule relevance; reviewer improvement is unmeasured.

Angular template opt-in can extend this inner bundle to v5 without changing selection v4. See [Angular template context](angular-template-context.md) for explicit metadata ownership and template provenance.

Pinned review-rules/v4 adds same-revision bound Angular component qualification and rule-selection/v5; see [the component predicate contract](rules-contract.md#bound-component-qualification-review-rulesv4). Existing v1–v3 rule behavior is preserved.

Pinned rules v5 can require an explicit bound OnPush reference and retain successful/failed qualification checks in rule-selection/v6; see [the strategy contract](rules-contract.md#explicit-onpush-metadata-review-rulesv5).

# Scoped rule selection

This stage chooses review instructions; it does not execute them or find defects. It makes no AI calls. Rules must be supplied explicitly, never automatically loaded from the analyzed checkout.

## CLI and library

```sh
node src/cli.js bundle --repo /checkout --base origin/main --rules /trusted/review-rules.yaml
```

```js
import { parseRulesYaml, compileReviewBundle, createReviewBundle } from '../src/index.js';

const config = parseRulesYaml(rulesYaml);
const bundle = compileReviewBundle(snapshot, { rulesYaml });
const fromGit = await createReviewBundle({ repo: '/checkout', base: 'origin/main', rulesYaml });
```

The CLI reads at most 256 KiB from a regular UTF-8 file. `--rules` is available only for `bundle`. Treat the rule source as trusted review configuration: its instructions will later be supplied to an external reviewer.

## Input: review-rules/v1

See [examples/review-rules.yaml](../examples/review-rules.yaml) for a generic starting point. It is not implicitly enabled and does not establish team policy.

| Field | Required/default | Contract |
| --- | --- | --- |
| `schemaVersion` | Required | Exactly `review-rules/v1` |
| `rules` | Required | Array of 0–250 rules |
| Rule `id` | Required | Unique lowercase slug beginning with a letter, at most 80 characters |
| `title` | Required | Nonempty string, at most 200 characters |
| `instruction` | Required | Nonempty string, at most 8,000 characters; intended for later reviewer execution |
| `severity` | `warning` | `info`, `warning` or `error`; this annotates instructions, not findings |
| `enabled` | `true` | Strict boolean; disabled rules still receive a skipped decision |
| `scope.paths` | Required | 1–32 include patterns |
| `scope.excludePaths` | Empty | 0–32 exclusion patterns |
| `scope.statuses` | `A,M,D,R,T` | Nonempty subset of Git change statuses |
| `scope.extensions` | Unrestricted | Nonempty array of lowercase suffixes such as `.ts`; omission means unrestricted |
| `scope.entryKinds` | `file` | Nonempty subset of `file`, `symlink`, `gitlink` |
| `when.minAddedLines` | Absent | Integer from 0 to 10,000,000 |
| `when.minRemovedLines` | Absent | Integer from 0 to 10,000,000 |

Selector lists have at most 32 items and are deduplicated/sorted. Empty status, extension or kind lists are invalid. Unknown keys, unsupported versions, duplicate mapping keys/IDs, null optional fields and mistyped scalars are rejected. Disabled rules must still be valid. Titles/instructions/IDs are trimmed during normalization.

Only one YAML 1.2 document using core scalar types is accepted. Tags, anchors, aliases, merge keys, multiple documents and parser warnings are rejected. Structural limits are 10,000 AST nodes and depth 12. No executable expressions, regular expressions or semantic predicates are supported.

## Path matching

- Paths use Git's `/` separator and are case-sensitive.
- `*` matches zero or more characters inside one segment; `?` matches one Unicode code point.
- A whole segment `**` matches zero or more complete path segments. `src/**/*.ts` matches `src/file.ts` and nested TypeScript files.
- Braces, character classes, parentheses, negation syntax, backslashes, control characters, absolute paths, `.`/`..` segments and embedded `**` are rejected. Other characters are literal.
- Pattern length is at most 256 characters and 64 segments. Changed path length is at most 4,096 JavaScript string units during selection.

Status must match the change. Path, extension and entry-kind criteria must all match **the same old or new side**. A path must match an include and no exclude pattern. Renames can therefore match an old source scope and/or a new destination scope. An exclusion removes a side; it does not remove a matching opposite side. Criteria never combine an old path with a new extension or kind.

Both line thresholds, if present, must pass for the same change. They use the compiler's text-change fact. Binary and special-entry text counts are unavailable: a threshold rule is skipped with an explicit reason even when its threshold is 0. Without text conditions, metadata rules may match such entries when their scope permits them. Default file-kind scope excludes symlink/gitlink-only changes.

Glob matching uses bounded non-regex matching. The whole selection has a deterministic budget of 5,000,000 counted comparison/iteration operations. Exceeding it fails with `SELECTION_LIMIT`, without partial decisions. This is a work ceiling, not a wall-clock timeout.

## Output: rule-selection/v1 within review-bundle/v2

Without rule YAML, compilation retains review-bundle/v1 and `ruleSelection: not-run`. With rule YAML, it emits review-bundle/v2 and a `ruleSelection` section:

| Field | Role |
| --- | --- |
| `schemaVersion` | Exactly `rule-selection/v1` |
| `configId` | `rules:<sha256>` of the normalized versioned rule configuration |
| `rules` | Complete normalized configuration, including review instructions and disabled/skipped rules |
| `policy` | Old/new side semantics, same-side criteria, default kinds, work limit and unavailable-text policy |
| `decisions` | One decision per rule, sorted by rule ID |

Each decision contains `ruleId`, `status` (`matched` or `skipped`), `reason`, `matches` and rejection counters. Each match identifies `changeId`, `evidenceIds`, `matchedPaths` (`side`, `path`) and `conditionFactIds` (text-fact IDs when conditions were evaluated). Every reference resolves to the enclosing bundle's facts/evidence/changes.

Reasons: `disabled`, `no-changes`, `scope-and-conditions-match`, `text-evidence-unavailable`, `line-threshold-not-met`, `scope-not-matched`, `status-not-matched`. If no file matches, the primary reason prioritizes unavailable text, then threshold failure, then scope failure, then status failure. `rejected` counters retain mixed candidate outcomes, so one reason does not imply all candidates failed identically. Disabled rules have no evaluated candidates.

Config IDs and resulting bundle IDs are unaffected by comments, rule/list ordering, duplicate list entries or explicitly writing default values. Changing a rule's instruction, scope, severity, enabled state or conditions changes the config identity. Exact normalized instructions/configuration are retained for provenance; raw YAML formatting and local rule-file paths are not retained.

Rule selection coverage is `complete` once supplied rules are successfully evaluated, including an empty rule set. The bundle remains `partial`: semantic analysis/context expansion have not run, and selected review instructions have not been reviewed by AI or a human. Full bundle byte limits include the configuration and all decisions/matches.

Errors: `INVALID_YAML`, `INVALID_RULES`, `RULE_INPUT_LIMIT`, `INVALID_RULE_FILE`, `SELECTION_LIMIT`. No rule files are silently skipped and no automatic fallback selection is used.

## Opt-in changed syntax: review-rules/v2

Version 1 remains unchanged. Version 2 adds `when.changedSyntax` (0–8 predicates,
all required on the same change). Empty/omitted predicates retain scoped selection.
Version 2 emits `rule-selection/v2` inside the existing bundle envelope. Packet
validation reparses the configuration and recomputes observations from patch evidence.

```yaml
schemaVersion: review-rules/v2
rules:
  - id: authorization-invariant
    title: Check authorization enforcement
    instruction: >-
      Verify that unauthorized roles cannot reach the protected operation.
      A changed guard needs equivalent enforcement; request caller evidence
      before assuming this change is a defect.
    scope:
      paths: ['src/**']
    when:
      changedSyntax:
        - side: removed
          kind: throw-guard
          identifiers: [role]
```

Each predicate has `side: added|removed`, `kind: throw-guard|call`, optional
`identifiers` (0–32 literal ASCII identifier spellings, all required) and, for calls,
a required literal dotted `callee` such as `Number.isInteger`. Guards reject callee.
Unknown keys/versions/kinds/expressions are rejected. Predicates are sorted/deduplicated
for stable configuration IDs. No arbitrary regexes or executable expressions.

The selector parses old/new hunk projections with TypeScript 5.9.3, compares AST
token fingerprints with occurrence counts, and requires a token to occupy an edited
line. Comments/trivia are excluded; strings containing code are not parsed as code.
Unchanged fingerprints do not trigger on formatting/comment changes. A throw guard
is an `if` without `else`, whose sole consequent statement is `throw` (optionally in
a block). Calls are syntactic identifier/property-access callees; dynamic/computed
callees are unsupported. Identifier spelling includes property names; it is not
symbol binding, alias resolution or type analysis. Same-hunk unchanged nodes pair
across sides, so removing one of two identical nodes is still detected.

Only regular text `.ts` changes are supported. Other kinds/extensions, missing
patch evidence, parse errors and hunk resource limits yield explicit
`syntax-evidence-unavailable` when a required observation cannot be obtained.
A valid supported hunk without the requested observation yields
`changed-syntax-not-matched`. Rejection counters distinguish these outcomes.
Known matches from available hunks may select even if other hunks are unavailable;
selection is positive evidence, not a completeness claim. Mixed extension renames
are unavailable. A removed predicate must match a scoped old path; an added
predicate must match a scoped new path. Criteria cannot mix rename sides.

Each hunk side is limited to 128 KiB and 25,000 lexical/AST nodes. Traversal,
comparison and token work consume the existing shared deterministic 5,000,000
operation budget. Exceeding that overall budget fails without a partial bundle.
Observations retain kind, side, identifier/callee spelling, evidence ID, hunk index
and absolute start/end lines. Matches contain `syntaxMatches`, one observation list
per normalized predicate; all references point to the patch evidence.

These are bounded syntax observations, not runtime invariant facts. Patch fragments
can be incomplete; nodes moved across separate hunks can appear changed. No whole-file
control-flow equivalence, imported alias binding, Angular template relationship,
transitive calls or proof of missing enforcement is inferred. Rules must ask the
reviewer to verify the domain invariant using the available evidence.

## Context-qualified syntax: review-rules/v3

Version 3 is opt-in and preserves v1/v2 selection contracts. It emits
`rule-selection/v3`, adds `within` to syntax predicates, and adds two kinds:

| Predicate | Required fields | Observation |
| --- | --- | --- |
| `member-call` | `callee: this.member.chain` | Literal property access call rooted at `this` |
| `assignment` | `target: this.member.chain` | Simple `=` assignment to a literal `this` property chain |
| `within` qualifier | Optional literal ASCII name | Nearest named function/method containing the syntax node |

Other predicate fields/limits remain as in v2. Callee/target fields are exclusive
to their applicable kinds. Computed receivers, variable aliases and compound
assignment operators are outside these patterns. Anonymous callbacks do not inherit
an outer lifecycle method's name; constructors/anonymous functions have no supported
name. If a structurally matching observation lacks the requested enclosing name,
the qualifier is reported unavailable, rather than asserting it is outside scope.
A different known name is a non-match.

Observations add `within`, `withinLine` and an assignment `target` where relevant.
The enclosing name participates in pairing across hunk sides; renaming a method
can therefore change contextual scope even with unchanged call tokens. Either an
edited node token or edited enclosing-name token is required. Coordinates retain
both the observed call/assignment and the enclosing-name evidence line. All
observations/decisions are recomputed by imported reviewer-packet validation.

See [Angular-style examples](../examples/angular-invariant-rules.yaml): changed
subscription teardown in `ngOnDestroy`, and changed loading assignments in `load`,
with the same syntax in unrelated methods excluded. These examples are authored
policy triggers, not proof the class is an Angular component, that OnPush applies,
that teardown is absent elsewhere, or that loading transitions are defective.
Template bindings, framework metadata, equivalent cleanup and caller predicates
remain outside this syntax subset. No rules are loaded from the analyzed checkout.

## Pinned source selection

V3 rule configurations can opt into `ruleSource: 'pinned'` / `--rule-source pinned`.
This produces rule-selection/v4 inside bundle/v4 and verifies complete changed .ts
source sides against their pinned blobs. Predicates/config IDs retain the v3 format.
See [pinned rule evidence](pinned-rule-evidence.md) for source limits, patch/source
anchors, parsing availability, default compatibility and packet recomputation.

## Bound component qualification: review-rules/v4

Version 4 requires `ruleSource: 'pinned'` / `--rule-source pinned` and adds an
optional `angularComponent: true` field to each changed-syntax predicate. False,
null and other values are invalid; omission leaves that predicate unqualified.
Existing v1/v2/v3 configurations and their IDs/selection output are unchanged.
V4 emits `rule-selection/v5` inside the existing pinned bundle v4–v7 envelopes;
these envelopes now admit selection v4 (rules v3) or v5 (rules v4). No additional
CLI flag or template-expansion opt-in is required.

See [component rules](../examples/angular-component-rules.yaml). For example,
`member-call`, `callee: this.subscription.unsubscribe`, `within: ngOnDestroy`
and `angularComponent: true` require all of the following on one changed syntax
observation in the scoped revision side:

- The literal call and named-method syntax conditions match.
- Its nearest lexical class is a named TypeScript class declaration.
- Exactly one decorator call on that class resolves through a direct runtime
  named/aliased `Component` import or namespace `.Component` import from
  `@angular/core` in the same pinned source.

An ordinary class with an `ngOnDestroy` method does not qualify. Custom imports,
barrels/re-exports, type-only imports and locally shadowed decorator identifiers
are outside the direct-binding contract. A nested ordinary class cannot borrow
its outer component's decorator. Multiple bound decorators and class expressions
retain explicit unavailable scope rather than invent a component. Imports and
class/decorator ranges may be outside the patch hunk because complete pinned
source bytes back the observation. The opposite revision's decorator cannot
qualify this observation.

Every v4 observed node includes `angularComponentContext` with `status`
(`included`, `not-component`, `unavailable`), `reason` and `component` (null or
`{name, origin, decorator}`). Decorator provenance includes its range and the
bound import declaration's kind/local name/range. These references share the
observation's pinned source commit/path/blob and source evidence ID. The imported
packet boundary reparses and recomputes all qualification, so rehashing a forged
component/import claim does not make it valid.

V4 pairs observations using token, qualified parent-name and component-status
multisets within each hunk. This distinguishes a call moved out of a component
into a same-named ordinary class. An edited node token line or enclosing method
name remains required. Comment-only edits with unchanged qualification and
untouched syntax under decorator-only edits do not trigger rules. A simultaneous
qualification change on an edited syntax line may be a contextual change even
when call tokens match. Cross-hunk moves, repeated same-qualified parent names,
syntactic receiver spelling and structural comparison remain bounded observations,
not complete semantic equivalence or runtime dispatch.

Qualification proves this explicit decorator binding, not a lifecycle invocation,
`this` receiver identity, framework version, installed package authenticity,
inheritance, OnPush behavior or runtime correctness. Metadata arguments are not
evaluated and need not contain a literal template; dynamic metadata can qualify
the class while optional template expansion remains unavailable. Template ownership
and lexical binding sections retain their separate opt-in contracts. No template
rule predicates or defect findings are added by this version.

Existing pinned source limits apply: 64 sides, 512 KiB each, 4 MiB total,
250000 AST nodes per source traversal and the shared deterministic 5000000-operation
selection budget. Qualification's additional source/class traversal consumes that
budget. These are structural/work limits, not hard parser preemption. Unsupported
or parse-failed sources retain explicit unavailable selection. Source coverage
means parsing availability, not that every class qualified.

The supplied offline expectation contract can assert selected rules for positive
and negative component cases without a new acceptance schema. The acceptance audit
contains six authored synthetic component-specificity cases; these do not establish
real MR acceptance, independent holdout performance or reviewer benefit.

## Explicit OnPush metadata: review-rules/v5

Version 5 requires pinned sources and optionally adds `changeDetection: OnPush`
to a changed-syntax predicate that also has `angularComponent: true`. `Default`,
other values, null and qualification without the component requirement are invalid
rule configuration. Existing v1–v4 configurations retain their format, IDs and
selection behavior. V5 emits `rule-selection/v6` in the existing pinned bundle
v4–v7 envelopes. See [the authored example](../examples/angular-on-push-rules.yaml).

The nearest qualified class must have one literal object argument in its bound
Component decorator. All metadata properties must be plain uniquely named
assignments; spreads, computed names, shorthand/method properties or duplicates
make strategy qualification unavailable. Other property values are not evaluated.
The `changeDetection` value must be the literal `.OnPush` access rooted at a
runtime named/aliased `ChangeDetectionStrategy` import from `@angular/core`, or
`namespace.ChangeDetectionStrategy.OnPush` through a direct runtime namespace
import. Import symbols are resolved in the same pinned source revision. Strings,
numbers, enum copies, computed members, calls, local/shadowed/custom/type-only
bindings and wrappers/barrels do not establish this reference.

`angularComponentContext.changeDetection` retains:

| Field | Meaning |
| --- | --- |
| `status` | `included`, `not-matched` or `unavailable` |
| `reason` | Explicit metadata/import outcome |
| `strategy` | Bound literal `OnPush` or `Default`, otherwise null |
| `metadataOrigin` | Exact strategy expression range with source commit/path/blob, or null |
| `binding` | Direct enum import kind/local name/declaration range, or null |

A missing property gives `not-matched / no-explicit-change-detection`. A bound
`.Default` gives `not-matched / bound-change-detection-strategy`; `.OnPush` gives
`included` with that reason. Neither a missing property nor the contract asserts
a runtime default. Unknown metadata is unavailable, including
`nonliteral-component-metadata`, `unsupported-component-metadata-properties`,
`ambiguous-component-metadata-properties`, `nonliteral-change-detection-reference`,
`change-detection-import-binding-unavailable` and `unsupported-change-detection-member`.
A source that parsed can still have unavailable strategy qualification.

Every v6 rule decision includes `qualificationChecks` (empty if no applicable
candidate was evaluated). Each check records change ID, normalized predicate index,
added/removed side, patch and pinned source evidence IDs, syntax origin, outcome
status/reason and the complete component context. These checks cover scoped changed
syntax candidates that satisfy the kind/spelling/within conditions before strategy
filtering. They preserve failed outcomes as well as successful ones; absence of a
check does not prove available metadata. Normal selection reasons and rejection
counters remain. All checks and strategy/import/class ranges are recomputed at the
packet boundary; a rehashed forged reason or reference is invalid.

V5 pairing includes component and change-detection status alongside the existing
token/qualified-parent fingerprint. An identical call moved from a same-named
explicit OnPush component into a Default component cannot cancel the observation.
An edited syntax token line or named-method token is still required; changing only
metadata around untouched syntax does not select. Simultaneous qualification
changes on edited syntax lines can be contextual changes even with equal call
spelling. This remains hunk-local structural comparison, not semantic equivalence.

The existing AST/source/5000000-operation limits apply. At most 10000 strategy
qualification checks are returned across the entire selection. Exceeding any limit
fails without a partial bundle. Class/metadata/import traversal consumes the shared
work budget; compiler parsing/type-checker work is not hard preempted by that budget.
Bundle/request byte limits still apply to the retained checks.

This contract proves an explicit directly bound reference in source, not installed
package authenticity, effective runtime metadata, inheritance, receiver identity,
notification requirements, change-detection execution or a defect. Rule instructions
must ask the reviewer to assess the relevant invariant using consumers and actual
notification paths. The six authored synthetic OnPush acceptance cases verify
positive/negative rule selection and unavailable metadata reasons; real MR relevance,
independent holdouts and reviewer improvement remain unmeasured.

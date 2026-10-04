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

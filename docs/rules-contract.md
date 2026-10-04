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

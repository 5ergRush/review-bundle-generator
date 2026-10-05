# Angular component/template context

Opt-in `angularTemplates: true` / CLI `--angular-templates` follows explicit
component metadata for selected-rule syntax in changed TypeScript sources.
It requires `ruleSource: 'pinned'` and existing `review-rules/v3`. It attaches
template context without selecting extra rules or interpreting filename suffixes.
No AI calls or Angular runtime dependencies are introduced.

```sh
review-bundle bundle --repo /checkout --base BASE --head HEAD \
  --rules /trusted/rules.yaml --rule-source pinned --angular-templates
```

The same option works with `createReviewBundle`, `createRuleContextBundle`,
`createGitLabReviewBundle` and their CLI commands. Output is **review-bundle/v5**
with unchanged **rule-selection/v4** and an `angularTemplateContext` section.
Semantic/caller analysis remains optional; rule-directed callers keep their existing
policy. Old modes retain their versions. Git facts, changes, rule config and selections
are preserved. The pure diff compiler does not fetch Angular context.

## Relationship and coverage

Angular's [Component API](https://v18.angular.dev/api/core/Component/) defines
`template` as inline metadata and `templateUrl` as a template file location. Its
[component guide](https://v18.angular.dev/guide/components/) describes relative
template locations. This increment supports a bounded static subset:

- Start from a matched rule's exact pinned syntax observation, retaining rule ID,
  change ID, side, patch/source IDs and AST origin.
- Find its nearest containing class, including nested classes. Require a named
  class declaration with exactly one `Component` decorator bound to a runtime
  named import (including aliases) or namespace import from `@angular/core`.
  TypeScript symbol declarations distinguish shadowed/custom/local spellings.
  Type-only imports and copied decorator variables do not establish ownership.
- Require one object-literal metadata argument, unique explicit property assignments,
  and exactly one literal `template` or `templateUrl`. Spreads, computed/shorthand
  properties, getters, duplicates, conflicting fields and dynamic values omit context.
- Inline string/no-substitution template literals retain decoded value and exact
  source literal range. External URLs resolve relative to the component source
  directory in the same observation-side commit. Filenames need not resemble the
  component's name or have an HTML extension.

Only local repository-relative URL spellings are supported. Absolute/remote URLs,
root escapes, backslashes, NUL/newlines, percent encoding, colon, query and fragment
spellings are omitted. Relative `..` segments within the repository normalize safely.
No network fetches or custom resource loaders run. The isolated Git reader reads
pinned regular blobs; it never follows working-tree files, symlinks or gitlinks.

`angular-template-context/v1` records policy/compiler version/limits, decisions and
external source references. Included decisions retain component class, decorator
and import-binding origins plus template metadata provenance. Omissions distinguish
unselected rules, missing anchors, unnamed/non-component classes, unavailable import
bindings, ambiguous decorators, unsupported/ambiguous/conflicting metadata,
missing/dynamic templates, unsupported URLs and parse failures. Path-only selected
rules do not request templates. A nested non-component class does not inherit an
outer component template.

Coverage stage `angularTemplates` is always **partial**. HTML-only edits do not
discover unchanged owners. Only observed sides are attached; opposite-side owners
are not inferred from class names. Template binding/expression analysis, Angular
control flow, selector/import ownership, inheritance and runtime correctness remain
future work. A source import is static provenance, not proof of installed-package
or decorator execution. This is reviewer context, not defect proof.

## Source and validation contract

External templates are full `angular-template-source` records with content ID,
commit/path/blob/full-file exclusive range and exact UTF-8 bytes. BOM/CRLF and empty
templates are preserved. Shared commit/path requests are deduplicated across rules
and classes; distinct commits retain distinct provenance even when bytes match.
Inline decoded values live in the context section. Their source ranges refer to
the TypeScript literal including delimiters, rather than pretending decoded HTML
offsets are TypeScript locations.

External budgets: **10 commit/path sources**, **32 KiB/file**, **128 KiB total
content**, separate from pinned rule sources and caller snippets. Overall bundle,
request and envelope limits still apply. Planning permits 10000 unique per-rule
syntax anchors, 250000 AST nodes/file and 5 million counted operations. Existing
pinned-source limits apply. Template reads share a 30-second deadline and bounded
tree listings. Missing/non-regular templates, invalid UTF-8 and file/count/total/output
overflow fail without a partial bundle; files are never truncated.

Packet validation accepts v5, validates ordinary facts/rules, recomputes ownership
from pinned source bytes, verifies complete external references/content IDs/full
ranges/Git blob hashes, cross-checks changed-template blobs against known diff metadata, and compares the entire context section. Missing, extra,
stale or forged context fails. Imported records still do not authenticate tree
membership, repository identity or an actual MR.

Normalized findings can cite external templates with `side: 'source'` and actual
template line ranges. Primary template evidence must belong to the cited rule's
ownership decision, even when different templates share a changed TypeScript file.
Findings remain unverified reviewer claims. Offline fact/rule acceptance supports
v5; its expectations schema does not independently assert template ownership.
The packet boundary checks internal relationships and targeted tests cover authored
positive/negative ownership cases.

The tests and installed-package smoke verify this static contract. No actual
corporate MR, Angular build/runtime validation or AI-quality comparison occurred.
Reviewer benefit remains unmeasured.

Optional [Angular binding relationships](angular-template-bindings.md) now parses a bounded static subset through a separate `--angular-bindings` / `angularBindings: true` opt-in (bundle v6). Ordinary v5 context retains the limits described above.

Optional [changed-template ownership](angular-template-owners.md) now supports explicit candidate component paths for template-only edits through `angularOwnerPaths` / repeatable `--angular-owner PATH` (bundle v7). It preserves rule selection and earlier modes. Optional bindings include those owners; candidate coverage and imported-tree authenticity remain explicit limits.

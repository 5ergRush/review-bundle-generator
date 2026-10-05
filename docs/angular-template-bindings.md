# Angular template binding relationships

`angularBindings: true` / `--angular-bindings` additionally parses templates
attached by `angularTemplates: true` / `--angular-templates`. Both require pinned
v3 rules. Existing modes keep their versions; the new mode emits **review-bundle/v6**
with `angular-template-bindings/v1`. Facts, rule selections, template ownership and
source IDs remain unchanged. It selects no additional rules and makes no AI calls.

```sh
review-bundle bundle --repo /checkout --base BASE --head HEAD \
  --rules /trusted/rules.yaml --rule-source pinned \
  --angular-templates --angular-bindings
```

The option also works with the rule-directed caller and GitLab bundle operations.
Packet validation independently recomputes all relationships after verifying the
existing pinned ownership/source contract. Changed classifications, declarations,
coordinates, diagnostics, compiler policy or missing sections fail even when a
caller recomputes the bundle hash. Imported packets still do not authenticate Git
tree membership or an actual MR. Findings remain unverified reviewer claims.

## Static contract

The installed, exact `@angular/compiler@18.2.14` dependency parses the supplied
UTF-8 template bytes. This targets Angular 18 syntax; no analyzed project's compiler,
plugins, scripts, dependencies, tsconfig or executable template expressions run.
The lock also pins the compiler's tslib dependency. The compiler version is recorded
in the analysis policy; compatibility with other Angular versions is not inferred.

Angular's [expression syntax](https://v18.angular.dev/guide/templates/expression-syntax/)
distinguishes component context, locals and globals. Its official
[18.2.14 compiler source](https://github.com/angular/angular/tree/18.2.14/packages/compiler/src)
provides `parseTemplate` and the lexical target binder. An empty selector matcher
is deliberate: directive consumers, exportAs targets and pipe definitions are not
resolved. A template reference records its lexical declaration, not a verified
DOM/directive type. No Angular type checking or application compilation is performed.

Each included ownership decision retains rule/anchor/component/template provenance
and produces deterministically ordered bindings for property expressions, events,
interpolations and supported control-flow expressions. A binding has its name,
exclusive UTF-16 offsets and one-based line/column coordinates, status/reason, root
references and pipe names. `undefined` is an Angular literal, not a member reference.
Named root references distinguish:

- `template-local`, with a template variable/reference/alias declaration range;
- `event-local` for `$event` in an event expression;
- `global` for the `$any` builtin;
- `component-member`, with a unique declared instance member's exact pinned
  TypeScript evidence ID, revision/path/blob and range;
- `unresolved`, with an explicit reason for absent/ambiguous members or unsupported
  tracking scope. Absence is not a defect finding.

Component roots may be reads, writes or call receivers. Nested `user.name` links
`user`, rather than mistaking `name` for a component member. Explicit `this` roots
are distinguished from implicit roots and bypass local shadowing. Named instance
properties, methods, accessors and constructor parameter properties can link;
static members and private identifier names do not. Overloads/getter-setter pairs
with multiple declarations remain ambiguous. Inherited members, computed root
member access and general runtime value/type resolution are outside the contract.
Signals are ordinary named call roots; no signal/change-detection behavior is inferred.
Two-way syntax may yield input/event expressions; the analyzer does not establish
a directive or model contract. Pipes retain names with `not-resolved` provenance.

## Coordinates and explicit omissions

External coordinates refer to the full pinned template evidence content.
Inline coordinates refer to the **decoded template value**, with the original
TypeScript literal's separate metadata origin retained. They must never be used as
TypeScript source offsets. CRLF and Unicode are preserved; columns/offsets count
UTF-16 code units, matching the compiler and TypeScript source coordinates.

Angular decodes HTML entities before parsing expressions. When an expression's
parsed text differs from the raw source slice, that binding omits all relationships
with `expression-source-transformation`; its raw binding envelope remains available.
There is no guessed offset remapping. A custom `interpolation` metadata property
omits analysis with `custom-interpolation-unsupported`. Parser diagnostics omit
all relationships for the template and record exact parser diagnostic ranges.
Deferred/ICU templates omit analysis explicitly; `@for` tracking roots remain
unresolved because the pinned lexical binder does not visit tracking expressions.
Other parsed loop body variables, conditional aliases and structural-directive
variables/reference declarations use lexical binding. These are syntax/scope
relationships, not proof that the corresponding directive exists at runtime.

## Budgets and evidence

At most 64 distinct templates are parsed, 32 KiB each and 128 KiB total, including
inline decoded values. Shared external templates are parsed once but member
resolution stays separate for each owner. AST preflight precedes recursive scope
binding: 20000 visited nodes, depth 128 and 500000 total counted operations. The
existing selected-syntax/source/template-read and output budgets still apply.
Count/byte/depth/operation overflows and parser/binder exceptions fail without a
partial bundle. Ordinary parse diagnostics are explicit omissions, not silent
successful analysis. The parser is synchronous; these are structural work bounds,
not a hard wall-clock termination guarantee.

Targeted synthetic Git tests and installed-package smoke verify positive/negative
scope, source-coordinate, ownership, validation and integration contracts. The
existing offline acceptance schema independently checks facts/rules, not these new
relationships. Real approved-MR acceptance and measured reviewer benefit remain
pending; no application build, real MR or AI-quality experiment is claimed.

Optional [changed-template ownership](angular-template-owners.md) now supports explicit candidate component paths for template-only edits through `angularOwnerPaths` / repeatable `--angular-owner PATH` (bundle v7). It preserves rule selection and earlier modes. Optional bindings include those owners; candidate coverage and imported-tree authenticity remain explicit limits.

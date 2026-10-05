# Public Angular calibration

Three upstream merged Angular Material PRs provide real-source development cases
for the fact and rule-relevance gate. The frozen cases and rules are in
`fixtures/public-angular/`. Expectations were authored by the same Codex agent
that implemented the selector, from upstream file patches and source inspection,
before candidate bundle generation. They are not an independent holdout.

| Upstream change | Expected relevance |
| --- | --- |
| [Menu #23185](https://github.com/angular/components/pull/23185) | Highlight assignment and optional notification call in the explicit OnPush menu-item component; no rules on constructor forwarding, the trigger or API documentation |
| [Slider #27250](https://github.com/angular/components/pull/27250) | Parent notification from the directive's `value` setter; no component qualification or rules on the interface declaration |
| [Button #23992](https://github.com/angular/components/pull/23992) | Lifecycle listener teardown in both the directive base and component; explicit OnPush qualification only in the component; no rules on test additions, build files or API documentation |

The unrelated loading-state rule must remain unselected across all thirteen
changed files. Rules use changed syntax, named enclosing scopes and optional
bound component/OnPush metadata, rather than selecting everything with a `.ts`
suffix. Spelling-based receivers and lexical class qualification are not runtime
identity or proof of notification requirements. An anonymous callback does not
inherit an outer lifecycle method's name; the button registration match is the
direct fallback call, not the call inside `runOutsideAngular`.

## Pinned snapshot choice

Each case compares the landed **single-parent squash commit against its first
parent**, with `comparison: direct`. The manifest retains the original PR base
and head for provenance, but does not use them for generation. Directly comparing
those stored PR refs includes unrelated branch changes in two cases. The landed
comparison matches the upstream PR file lists and per-file line counts. This
is calibration of landed changes, not reconstruction of every historical review
iteration or the current default branch.

## Run locally

From the generator repository checkout, use a trusted local checkout of the public `angular/components` repository with
all six pinned commit/tree objects and required blobs already available. A full
checkout with the relevant history is simplest. Shallow or filtered clones must
be prepared separately; the generator and this runner never fetch missing objects
or execute scripts from the analyzed repository.

```sh
npm run audit:public-angular -- /local/angular-components review-output/public-angular
```

The runner freezes and writes all compiled expectations before generating any
bundle. It generates each case twice, checks exact repeated-generation agreement,
and runs the ordinary offline acceptance audit, which also validates imported
bundle integrity. It writes expectation, bundle, report and summary JSON under the
chosen output directory. Exit 0 means all cases pass, 2 means valid audit
mismatches, and 1 means invalid input, missing objects, limits or other failures.
No output directory should contain private corporate artifacts for this run.

The checked-in `report.json` is a compact receipt without upstream source bodies.
Full bundles remain local under the ignored `review-output/` directory. The
upstream repository retains its own license and copyright notices. CI continues
to run offline synthetic audits; this external-source calibration is a separate
manual command and introduces no network dependency to the regular test suite.

## What this evidence covers

The audit asserts exact changed path pairs, statuses, entry kinds, added/removed
line counts, exact per-change selected rule sets and source coverage. Test/build/
interface/API changes provide real negative controls. Required patch lines are
empty, so exact patch content is not an external assertion. Qualification outcomes
are retained in the receipt; only selected-rule sets and source coverage are
external acceptance assertions. Repeated output agreement is limited to the
same pinned inputs and recorded Git/compiler policies.

The cases were deliberately chosen and the rules tailored to inspected syntax;
passing them is development calibration, not representative precision/recall,
corporate acceptance, independently validated framework behavior or reviewer
improvement. Caller context, changed-template owners and lexical bindings are
not covered. The next independent gate remains approved MR snapshots with
expectations authored separately from implementation. See
[offline acceptance](offline-acceptance.md) and [validation plan](validation-plan.md).

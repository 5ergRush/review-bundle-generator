# Acceptance and reviewer experiment

The user prioritized factual change extraction and meaningful rule relevance over
reviewer-quality gains on 2026-10-05. Exact production reviewer transport is not a
prerequisite. ChatGPT can review provisionally; the user's Gemini subscription can
support an independent experiment without adding AI calls to the generator.

## Gate 1: facts and rule relevance

Approved snapshots can now use [offline MR acceptance](offline-acceptance.md) via
`review-bundle audit --bundle bundle.json --expectations expectations.json`.
Author and freeze exact facts and per-change relevance before generation. Commit,
config/mode, source coverage and negative cases are explicit; declared approval and
holdout independence are not verified. No real corporate MR has been supplied or
tested. The existing synthetic audit below remains development evidence.

Run `npm run audit:acceptance` from the source checkout. Authored expectations in
`fixtures/acceptance/cases.json` precede execution. The script creates real local
Git commits, generates semantic bundles and reviewer packets, and verifies exact
change paths/status, added/removed line counts, patch lines, pinned evidence
revisions and selected-rule propagation. Failures of those assertions stop it.
It reports rule relevance against the authored policy. Version 2 now asserts
`specificityPassed`; regression of an authored case fails the process. The preserved
`baseline-v1.json` records the original failed five-case baseline.

Initial five-case result: all factual and packet checks passed. Two guard-removal
cases selected the intended authorization/money rules; the unrelated file selected
none. Both comment-only edits in the same files incorrectly selected the same rules.
This is an observed limitation of path/status/line-count selectors, not evidence
that those rules find defects. The original selectors could not inspect changed code.
Those instructions expressed concrete domain invariants, but relevance was coarse.

Initial specificity increment: opt-in review-rules/v2 changed-syntax predicates recognize
changed throw guards and calls, with explicit unavailable evidence and traceable
patch coordinates. The original nine-case audit passed, including the original controls,
guard-condition replacement, and misleading comments/strings. This fixes the narrow
baseline gap; it is not complete behavioral analysis.

Current coverage: 30 authored fact/packet/relevance cases pass. V3 adds literal
this-member calls, simple state assignments and nearest named-function qualifiers;
pinned source mode recovers long-method scope beyond patch fragments. V4 requires
same-side bound Component ownership; v5 can additionally require an explicit directly
bound OnPush strategy reference. Same-file/class negatives, custom/type-only imports,
absent/Default metadata and dynamic/spread/numeric strategies exercise specificity
and unavailable outcomes. The six OnPush cases also assert authored qualification
statuses/reasons. This is same-author synthetic development evidence.

The separate eight-case caller audit covers direct imports, bounded immutable local
const aliases and unsupported mutable/property flows. Structural counterpart mapping
and rule-directed context requests are implemented. Optional component/template
metadata, lexical bindings and configured template-only owner discovery retain
pinned evidence and explicit omissions. These relationships are bounded syntax and
binding contracts, not Angular/runtime correctness.

Next validation dependency: independently authored held-out/approved real MR
snapshots and expectations, with positive and same-path negative examples. The offline
acceptance API can check exact per-change facts/rules and, with expectations v2,
configured template owner sets. Broader project indexing, semantic changed-template
rule predicates and general function-value flow remain possible implementation work.
Do not substitute filename suffixes or keyword counts for semantic proof. No single
predicate establishes complete Angular/runtime correctness; no real corporate MR
or independent reviewer-quality comparison has been tested.

## Gate 2: independent reviewer comparison

The existing `fixtures/evaluation/runs.json` is scripted and proves evaluation
arithmetic only. It is not experimental evidence of reviewer improvement. This
acceptance audit also contains no reviewer responses or quality claims.

Use Gemini in fresh sessions for each review, keeping its displayed model/mode and
instructions fixed. Subscription access is not an API integration; the user runs
these sessions and returns the verbatim responses. ChatGPT can also run a pilot,
but a reviewer that has already seen the fixture labels cannot provide a blind test.
Do not expose expected findings, case names, gold labels, prior responses or scores.
Use opaque trial identifiers, randomize order, and retain that mapping outside the
reviewer inputs. Freeze expected defects/non-defects before running reviews.

Compare these arms on the same pinned changes:

- Baseline: exact MR diff and fixed generic review instructions.
- Treatment: same diff and generic instructions plus generated factual context and
  selected rules. Record which extra context was supplied.
- Optional ablations: facts without rules; rules without expanded caller context.

Give both arms the same output instructions: report concrete defects with location,
reason and supporting evidence; identify missing context; do not invent defects.
Capture model/mode, date, full inputs/outputs, repetitions and actual usage if available.
Never fabricate tokens/cost/latency. Independent adjudication should score actionable
true positives, false positives and missed defects, including clean negative MRs.
Repeat cases to expose response variation; report per-case paired results, not just
an average. Freeze the rules during a comparison; tune on development cases and
rerun on unseen held-out cases. Small pilot gains are descriptive, not a promise of
real-world improvement. These obvious guard-removal fixtures are for selector
acceptance and are insufficient to establish reviewer benefit.

Exact production wire format can be mapped later. Reviewer experiment inputs can
be ordinary text/JSON files; identity/provenance still matter for reproducibility.
No Gemini session or live AI review was run by this audit.

## Future dashboard worklog

Requested by the user: before final bundle generation, allow a human to manually
add or remove selected rules in the future dashboard. Dashboard remains outside
current core scope. Preserve automatic decisions alongside explicit overrides,
show the reason/evidence for each automatic selection, and regenerate bundle IDs
and reviewer packets from the effective selection. Record rule/config versions and
overrides for audit/evaluation; exclusions must not erase automatic provenance.
Define override authorization and validation when implementing the dashboard.

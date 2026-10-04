# Acceptance and reviewer experiment

The user prioritized factual change extraction and meaningful rule relevance over
reviewer-quality gains on 2026-10-05. Exact production reviewer transport is not a
prerequisite. ChatGPT can review provisionally; the user's Gemini subscription can
support an independent experiment without adding AI calls to the generator.

## Gate 1: facts and rule relevance

Run `npm run audit:acceptance` from the source checkout. Authored expectations in
`fixtures/acceptance/cases.json` precede execution. The script creates real local
Git commits, generates semantic bundles and reviewer packets, and verifies exact
change paths/status, added/removed line counts, patch lines, pinned evidence
revisions and selected-rule propagation. Failures of those assertions stop it.
It separately reports rule relevance against the authored policy. A process exit
of zero does not mean specificity passed: inspect `specificityPassed`.

Initial five-case result: all factual and packet checks passed. Two guard-removal
cases selected the intended authorization/money rules; the unrelated file selected
none. Both comment-only edits in the same files incorrectly selected the same rules.
This is an observed limitation of path/status/line-count selectors, not evidence
that those rules find defects. Current selection cannot inspect changed behavior.
The instructions express concrete domain invariants, but relevance remains coarse.

Next: implement bounded deterministic predicates using actual changed-code evidence,
with explicit unsupported/unknown cases and traceable reasons. Cover positive and
same-path negative examples, misleading comments/strings, indirect calls, import
aliases, validation modifications and Angular state/lifecycle/template relationships.
Do not substitute filename suffixes or keyword counts for semantic proof. No single
predicate should be described as full Angular/runtime correctness. Extend this audit
with independently authored expectations and later approved real MR samples.

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

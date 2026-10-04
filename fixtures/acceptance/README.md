# Acceptance baseline

`cases.json` contains authored synthetic source changes and independent factual
and rule-relevance expectations. `report.json` records the current audit result:
facts, packet checks and narrow syntax-rule specificity pass on fourteen cases, including contextual teardown/state controls.
`baseline-v1.json` preserves the original two false selections.
These are not reviewer outputs or real MR quality measurements.

Run `npm run audit:acceptance` in the source checkout to reproduce the report and
generate full packets and patch files locally. Generated packets/patches are
ignored because they are reproducible; they contain no secret or corporate code.
The audit now asserts both factual correctness and the authored specificity cases.
This is limited synthetic acceptance, not comprehensive semantic correctness or
measured reviewer quality.

See `docs/validation-plan.md` for the next implementation and Gemini experiment.

`npm run audit:callers` reproduces `caller-report.json` with aliased-import,
new-caller and same-name exclusion checks. It confirms the deletion-only target fix with explicit structural provenance,
while indirect-variable calls remain a known gap. Contract checks passing do not
mean complete caller coverage. Both audits use synthetic TypeScript sources.

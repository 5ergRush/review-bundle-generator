# Acceptance baseline

`cases.json` contains authored synthetic source changes and independent factual
and rule-relevance expectations. `report.json` records the current audit result:
facts/packet checks pass, rule specificity fails on both same-file comment controls.
These are not reviewer outputs or real MR quality measurements.

Run `npm run audit:acceptance` in the source checkout to reproduce the report and
generate full packets and patch files locally. Generated packets/patches are
ignored because they are reproducible; they contain no secret or corporate code.
The audit process asserts factual correctness, but reports specificity separately.
Inspect `specificityPassed`; zero process exit does not indicate overall acceptance.

See `docs/validation-plan.md` for the next implementation and Gemini experiment.

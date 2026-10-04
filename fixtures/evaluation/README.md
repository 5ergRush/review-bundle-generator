# Synthetic evaluation fixtures

These records exercise the evaluation contract; they are not real reviewer runs.
`definition.json` independently describes a guard-removal case and a comment-only
negative case. `dataset.json` freezes those labels and commit IDs. `runs.json`
contains scripted diff-only/caller-context packets, responses and adjudications
for two repetitions. Every label, candidate and adjudication is marked synthetic;
measurements are unavailable.

The scripted diff-only candidate yields TP=1, FP=1, FN=1; the scripted caller-context
candidate yields TP=2, FP=0, FN=0. These deliberately chosen outcomes test formulas
and report flags. They do not demonstrate that context improves any real reviewer.

Run the offline report with:

```sh
node src/cli.js evaluate --dataset fixtures/evaluation/dataset.json --runs fixtures/evaluation/runs.json
```

`npm run fixtures:evaluation` rebuilds the files from the maintainer script's
generic TypeScript sources in a temporary Git repository with fixed author dates,
no hooks and isolated global configuration. The captured Git/compiler versions
are part of packet provenance. Review generated changes before committing them.

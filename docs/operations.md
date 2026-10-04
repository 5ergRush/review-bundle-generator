# Installation and operational checks

The current deliverable is a private npm package built from this repository,
providing ESM library exports and the `review-bundle` CLI. It is not published to
a registry, deployed as a service or validated against a live corporate GitLab/
reviewer. A dashboard remains excluded. Runtime requires Node >=22 and Git >=2.43.
CI tests Node 22 and 24 on Ubuntu 24.04.

## From the trusted source checkout

```sh
npm ci --ignore-scripts
npm run validate
npm run smoke:package
npm pack --ignore-scripts
```

Install the resulting tarball in the application's tool environment:

```sh
npm install --ignore-scripts /path/to/review-bundle-generator-0.1.0.tgz
npx --no-install review-bundle doctor
```

The distribution includes runtime source, contracts, examples, frozen synthetic
evaluation fixtures and the project control file. Development tests, CI files and
maintainer scripts are excluded through the package's explicit `files` list.
Development/fixture-generation npm scripts are for the source checkout. Installed
consumers use the exported library or CLI; they do not run the package's development
scripts. There are no installation lifecycle scripts. Pinned dependency versions
and integrity hashes are in the source lockfile; normal consumer installation
requires those dependencies to be available in its registry/cache.

`smoke:package` creates the actual tarball, installs it offline in a temporary
consumer (using dependencies already cached by npm ci), imports package exports,
checks the installed CLI/bin/runtime, generates a semantic bundle from a temporary
synthetic repository and runs the shipped offline evaluation fixture. It removes
temporary directories and performs no publish/deploy/AI operation. GitHub CI runs
this check for both supported Node versions. It is separate from source tests so
distribution omissions and executable-path errors are caught.

`doctor` / `checkRuntime()` reports observed Node/Git versions and their minimum
requirements. Missing/old Git fails explicitly, with a 3-second/4-KiB version-read
bound. `runtime-ready` means those prerequisites are present; it does not assert
repository history, provider credentials, TLS connectivity or production readiness.

## Pipeline ownership

Keep the tool package and rule configuration in a trusted tool environment.
Analyze source with local Git objects; do not run dependency installation, builds,
hooks or application scripts from an analyzed checkout. Existing source reading
and diff computation are isolated and committed-only. The application supplies
the exact MR objects/history, including fork/shallow histories, before generation.
CI merged-result HEAD is not a substitute for the snapshot's recorded source head.

For GitLab usage, configure the approved instance/project/IID and token through
the deployment environment. Only the explicit live `gitlab-snapshot` command makes
an HTTPS GET. Private/fork sources and full history availability must be tested in
that deployment. Network/TLS/proxy configuration remains deployment-owned.
The local generator needs no AI key. The application supplies any external reviewer
adapter, authentication/model/prompt mapping, retry/cost/round limits and observed
token/cost/latency instrumentation separately.

Retain snapshot/envelope/request/result and evaluation IDs with their corresponding
JSON files as review provenance. Honor source-data access policy when moving those
files into the external reviewer. Re-read metadata and compare recorded identity
before using review output. Failures and partial coverage must stay visible; no
automatic MR approval, status posting or finding publication is implemented.

## Remaining live validation

The runtime, HTTP contract mocks, real local Git integrations and installed package
are tested. Still required before production release: the real instance/API/token
policy, authorized project/checkout and fork history handling, existing-reviewer
request/response mapping, observed usage instrumentation, human-labelled real MR
evaluation and deployment-owned transport/concurrency behavior. No live performance,
quality, provider-cost or operational-readiness claim is made by synthetic tests.

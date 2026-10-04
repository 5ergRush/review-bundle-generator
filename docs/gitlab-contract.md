# GitLab metadata and pinned local bundles

The adapter reads one GitLab API v4 MR metadata resource, normalizes its identity
and diff refs, and compiles an ordinary bundle from caller-provided local Git objects.
It makes no AI calls, posts no comments/statuses, and never clones/fetches repositories.
Live deployment and the existing reviewer's actual provider mapping remain to be validated.

## Metadata source

The implementation follows the official [MR API](https://docs.gitlab.com/api/merge_requests/)
and [REST authentication](https://docs.gitlab.com/api/rest/authentication/) contracts.
It uses `GET /api/v4/projects/:projectId/merge_requests/:iid` and the returned
`diff_refs.base_sha`, `head_sha`, and `start_sha`. Base is the recorded divergence
commit; head is the source commit; start identifies the recorded target-side diff
reference. These refs can be absent while GitLab prepares a diff. The adapter then
fails with `GITLAB_DIFF_NOT_READY`; it does not poll or select a branch tip instead.

```js
const snapshot = await fetchGitLabMergeRequest({
  instanceUrl: 'https://gitlab.example.invalid',
  projectId: 100, mergeRequestIid: 7,
  token: process.env.REVIEW_BUNDLE_GITLAB_TOKEN,
});
```

Instance URLs require HTTPS and may have a plain base path. URL credentials,
queries, fragments, encoded path segments, dot traversal, whitespace and backslashes
are rejected. Project IDs/IIDs must be positive safe integers; namespace paths are
not supported in this increment. Treat the instance as trusted application
configuration, not MR-supplied data. Self-hosted TLS/proxy setup belongs to the
deployment or an explicitly supplied Fetch-compatible transport.

Optional token authentication uses the `PRIVATE-TOKEN` header; anonymous public
reads omit it. Tokens are never URL parameters, snapshot fields or error text.
The CLI reads `REVIEW_BUNDLE_GITLAB_TOKEN` from the environment rather than argv.
Use a token permitted for this GET under the deployment's read-access policy.
CI job-token/OAuth-specific headers are not implemented.

One GET is made without cookies, retries or redirect following. HTTP failure
messages retain only the status; arbitrary transport errors are redacted. JSON
content type, UTF-8, advertised size and streamed/decompressed bytes are checked.
Default body budget is 1 MiB, capped at 8 MiB. The full fetch/body/normalization
deadline defaults to 30 seconds, capped at 300000ms. Timeout aborts, cancels the
reader and rejects late data. Abort is cooperative for injected transports; blocking
JavaScript cannot be preempted but is rejected after returning past the deadline.
`fetchImpl` must return a standard Fetch Response and honor the provided headers,
signal, manual-redirect and no-cookie options. A custom transport is trusted code.

`normalizeGitLabMergeRequest(rawMetadata, {instanceUrl, projectId, mergeRequestIid})`
provides the offline equivalent with an 8 MiB plain-JSON bound. It validates the
requested project/IID and target project, global MR/source-project IDs, state and
full consistent diff commit IDs. `sha` must equal `diff_refs.head_sha`; an inconsistent
response fails closed. Fork source/target identity is retained. Titles, descriptions,
branch names, API URLs and other unrelated response fields are discarded.

## Frozen snapshot and envelope

`gitlab-merge-request/v1` contains a content-derived `gitlab-mr:SHA256` ID,
instance/project/IID/global MR identity, source/target project IDs, state, normalized
base/head/start refs and read-only API policy. It is cloned/frozen. Source project
may be null in an imported closed/deleted-source record. Snapshot IDs are content
hashes, not proof of authentic GitLab data; trust imported files separately.
Preserve generated object-key order in saved JSON.

```js
const envelope = await createGitLabReviewBundle({
  repo: '/trusted/local/checkout', mergeRequest: snapshot,
  rulesYaml, semantic: true, contextRequests: [],
});
const request = createReviewerRequest(envelope.bundle, reviewerIdentity);
```

Only an opened MR with an available source-project ID can generate a bundle.
The adapter pins **direct** local comparison from recorded diff base to recorded
head, preserving start as metadata rather than recomputing merge-base or inspecting
a branch tip. Base/head/comparison overrides are rejected. Exact objects must be
available locally; missing/shallow/fork history fails without fetching. Checkouts
are trusted caller inputs; commit equality verifies source content, not repository
remote configuration or GitLab membership.

`gitlab-review-bundle/v1` wraps the normalized snapshot and the unchanged ordinary
v1/v2/v3 bundle. Its stable `gitlab-bundle:SHA256` ID binds both. Use `.bundle` at
the reviewer/evaluation boundary; the wrapper is not itself a reviewer packet.
Existing Git/source/rule/context/bundle limits apply. An additional compact envelope
budget defaults to 16 MiB, capped at 64 MiB, with `maxEnvelopeBytes`. Metadata overhead
can make an envelope exceed its limit even when the inner bundle fits.

## Freshness and application responsibility

After review, fetch a fresh snapshot and call
`assertGitLabSnapshotCurrent(previous, current)`. It validates both snapshots and
compares normalized identity/state/all diff refs; changes fail with
`GITLAB_STALE_SNAPSHOT`. Title-only changes do not alter the recorded code identity.
The check proves snapshot equality, not atomic freshness after the second read or
immediate reflection of asynchronous server changes. Review output cannot be
automatically approved or published from this check alone. Any future writer must
bind its own atomic/concurrent-update handling to the reviewed refs.

```sh
# Optional live metadata read; configure the token in the environment if required.
review-bundle gitlab-snapshot --instance https://gitlab.example.invalid \
  --project-id 100 --mr-iid 7 > snapshot.json
review-bundle gitlab-bundle --repo /trusted/local/checkout --snapshot snapshot.json \
  --semantic > envelope.json
# After the external reviewer runs, read current metadata separately.
review-bundle gitlab-check --snapshot snapshot.json --current current.json
```

`gitlab-snapshot --metadata PATH` instead normalizes saved raw API JSON offline
and does not read the token or invoke HTTP. Network-limit flags are rejected in
offline mode. `gitlab-bundle` accepts the ordinary rules/semantic/caller/Git limits
plus `--max-envelope-bytes`. The freshness command is offline. Each failure emits
one JSON error on stderr, exit code 1 and no partial stdout. No command publishes
review results, changes an MR or invokes an AI reviewer.

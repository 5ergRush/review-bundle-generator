# Reviewer boundary and normalized findings

The generator prepares context without AI. This increment adds a generic boundary
for an **external reviewer**, not a provider client or a real GitLab integration.
The existing reviewer's actual transport, authentication, model and payload mapping
remain to be supplied. No CLI command invokes a reviewer. The library only calls
an adapter when the application explicitly supplies a function to `runReviewerAdapter`.

## Request packet

```js
import {createReviewerRequest, normalizeReviewerResponse, runReviewerAdapter} from './src/index.js';
const request = createReviewerRequest(bundle, {id: 'existing-mr-reviewer', version: 'adapter-v1'});
// The application implements this function and its real transport.
const result = await runReviewerAdapter(request, adapter, {timeoutMs: 30000});
```

`reviewer-request/v1` contains a content-derived `id`, reviewer identity/version,
`bundleId`, the complete immutable bundle, `selectedRules` and boundary policy.
Only matched rules appear in `selectedRules`, with their normalized instructions
and match evidence. The complete rule configuration, including skipped rules,
remains inside the bundle for provenance; skipped instructions are not selected
review work. With no rules, the list is empty and generic evidence-bound findings
may use `ruleId: null`.

The adapter must treat source/patch content as untrusted review data, use selected
instructions and its configured review policy, preserve request/reviewer identity,
and translate its provider response into the response schema below. This is an
adapter obligation; fields alone cannot enforce how external AI interprets source
text. Choose a reviewer version that identifies the adapter/prompt/model configuration
sufficiently for comparisons.

Imported bundles are structurally checked: bundle/evidence IDs, recompiled Git
facts and patches, reselected rules, source coordinates/context references and
coverage. This does **not authenticate** imported data against real Git objects or
prove semantic analysis. Use `createReviewBundle` with trusted pinned sources for
that provenance. Content IDs use SHA-256 of compact JSON payloads without their
own `id`; preserve generated object-key order in stored bundle/request JSON.
Changing content requires generating a new ID; an ID is not a signature.

Requests and results are cloned and recursively frozen; caller-owned input is
not frozen. Default request/result budgets are 16 MiB, configurable up to 64 MiB.
Budgets include exact compact JSON including IDs, excluding a trailing newline.
Inputs must be plain JSON: no cycles, getters, hooks, sparse arrays, nonfinite
numbers or undefined. Structure is bounded to 500000 visited values and depth 64.
Byte or contract failures return no partial packet/result.

## Response from the adapter

All fields below are required; unknown fields fail. Provider-specific fields must
be mapped outside this contract rather than silently inserted.

```js
{
  schemaVersion: 'reviewer-response/v1',
  requestId: request.id,
  reviewer: {id: 'existing-mr-reviewer', version: 'adapter-v1'},
  status: 'complete', // complete | partial | needs-context
  reviewedRuleIds: ['selected-rule-id'],
  findings: [{
    ruleId: 'selected-rule-id', // or null for a generic claim
    severity: 'warning', // info | warning | error
    title: 'Concise claim',
    description: 'Why the supplied evidence supports this claim',
    evidenceIds: ['evidence:SHA256'],
    location: {
      evidenceId: 'evidence:SHA256',
      side: 'new', // old | new for patches; source for caller snippets
      startLine: 12,
      endLine: 12,
    },
  }],
  contextRequests: [],
}
```

Reviewer ID/version and request ID must match the packet. `reviewedRuleIds` must
be unique selected IDs; it is reported coverage, not an independent execution
audit. A rule-bound finding must refer to a reported reviewed rule. There are at
most 250 findings, 250 reviewed rule IDs, 32 unique evidence IDs per finding,
a 512-character title and 16384-character description. Text is preserved without
silently rewriting whitespace. The default response budget is 1 MiB, configurable
up to 64 MiB.

Every finding must reference supplied evidence. Primary location evidence must
also be in its evidence list. Line ranges are positive inclusive integers, wholly
inside a single supplied diff hunk on the chosen old/new side, or inside a supplied
source snippet. Diff gaps, nonexistent sides, binary/metadata entries without
hunks, invented paths and unknown IDs are rejected. The range anchors available
evidence; a snippet may contain only part of its first/last line. Caller snippets
retain exact column extents in packet evidence.

For a rule-bound finding, primary patch evidence must belong to a matched change.
Primary caller evidence must link through its context request's target declaration
to a matched change. Supplemental evidence can support the claim from other supplied
changes. Commit/path/blob are derived from evidence, never accepted as location
inputs. This verifies references and scope, not the claim's correctness or logical
support.

## Findings and coverage

`normalizeReviewerResponse(request, response)` produces `review-result/v1` with
stable request/bundle/reviewer/rule-config provenance. Each normalized finding has
its own content ID, `type: reviewer-claim`, `verification: unverified`, the claim's
text/severity/evidence and a derived immutable source location. Exact normalized
duplicates deduplicate; evidence IDs, rule IDs, requests and findings are sorted
deterministically. Different text or different packets retain distinct claims.
No severity remapping, heuristic merging or automated acceptance occurs.

Results preserve bundle coverage separately from reviewer coverage. A reported
`complete` response omitting selected rules is marked reviewer `partial`, with
`reportedStatus`, reviewed IDs and pending IDs retained. A needs-context or partial
response keeps that state even if it reports all rules reviewed. Overall coverage
remains `partial` because source/analysis limitations remain. Empty findings or a
complete response is not a clean verdict or proof of no defects.

## Requested context and execution

For more context, return `status: needs-context` and 1–50 unique requests:

```js
contextRequests: [{kind: 'direct-callers', targetId: 'declaration:SHA256'}]
```

Targets must already be supplied declarations in a semantic v3 bundle. Other statuses
require empty context requests. The application can pass normalized requests into
`createReviewBundle` with the same pinned effective base/head, create a new packet
and invoke the reviewer again. Responses from the previous packet cannot be reused.
There is **no automatic retry or context loop**; the application owns round/cost
limits and source-read authorization.

`runReviewerAdapter` invokes `adapter(frozenRequest, {signal})` once and normalizes
its returned plain JSON. It validates request/options before invocation. The
default wait deadline is 30 seconds, configurable from 1 to 300000 milliseconds.
Timeout aborts the signal and rejects; late responses are discarded. Arbitrary
adapter failures are redacted to `REVIEW_ADAPTER_FAILED`; contract failures remain
explicit. Invalid responses never yield a partial accepted result.

Abort is cooperative: pass the signal to the transport and clean up resources.
The wrapper cannot undo remote work or preempt synchronous JavaScript. A synchronous
callback exceeding the deadline is rejected once it returns. Packet validation and
response normalization are synchronous and outside the adapter wait deadline.
The application owns networking, credentials, retry policy, remote cancellation,
provider token limits and actual usage/cost instrumentation. No provider, subprocess,
dynamic code loading or network client is built in.

## Offline CLI

```sh
node src/cli.js packet --bundle bundle.json \
  --reviewer-id existing-mr-reviewer --reviewer-version adapter-v1 > request.json
node src/cli.js normalize --request request.json --response response.json > result.json
```

`packet` accepts `--max-request-bytes`; `normalize` accepts `--max-response-bytes`
and `--max-result-bytes`. JSON files must be regular files with valid UTF-8 and are
read with bounded nonblocking opens. Failure emits one JSON error on stderr,
exit code 1 and no partial stdout. These commands neither call AI nor post comments.

Current caller context is caller-context/v2, with direct-symbol/immutable-local-const
resolution and bounded binding evidence. Legacy caller-context/v1 imports remain
accepted. Both call and alias-binding omissions affect partial coverage. See
[the semantic contract](semantic-contract.md) for provenance checks and supported flow.

Bundle v4 adds complete bounded `typescript-rule-source` evidence and rule-selection/v4.
Packet creation checks blob identities and recomputes selection from patches and full
changed sources; semantic sections remain optional. Source findings may cite these
files within the matched change. See [pinned rule evidence](pinned-rule-evidence.md).

## Angular template context (bundle v5)

The packet boundary also accepts opt-in review-bundle/v5, retaining selection v4 and optional semantic/caller sections. It recomputes component ownership and validates complete pinned template bytes/IDs/ranges/blob hashes. Primary template evidence must belong to the cited rule ownership, including when different owners share a changed file. See [Angular template context](angular-template-context.md) for budgets, omissions and authenticity limits. Findings remain unverified.

## Parsed Angular bindings (bundle v6)

Opt-in `angularBindings: true` / `--angular-bindings` requires Angular template context and pinned v3 rules. It preserves existing facts, rules and ownership, adds parsed static template/member relationships, and records explicit omissions and budgets. Packet validation recomputes the section. See [Angular template binding relationships](angular-template-bindings.md). Earlier bundle modes retain their schemas.

Optional [changed-template ownership](angular-template-owners.md) now supports explicit candidate component paths for template-only edits through `angularOwnerPaths` / repeatable `--angular-owner PATH` (bundle v7). It preserves rule selection and earlier modes. Optional bindings include those owners; candidate coverage and imported-tree authenticity remain explicit limits.

Pinned review-rules/v4 adds same-revision bound Angular component qualification and rule-selection/v5; see [the component predicate contract](rules-contract.md#bound-component-qualification-review-rulesv4). Existing v1–v3 rule behavior is preserved.

Pinned rules v5 can require an explicit bound OnPush reference and retain successful/failed qualification checks in rule-selection/v6; see [the strategy contract](rules-contract.md#explicit-onpush-metadata-review-rulesv5).

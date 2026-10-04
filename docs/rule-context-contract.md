# Rule-directed caller context

`createRuleContextBundle(options)` and `review-bundle rule-context-bundle` plan
bounded direct-caller requests from selected rules. The operator explicitly supplies
`rulesYaml` and `contextPolicy`; neither is discovered in the reviewed checkout.
There are no AI calls. Existing manual `bundle --semantic --callers` remains available.

Policy is a JSON array of at most 50 entries:

```json
[{ "ruleId": "amount-invariant", "kind": "direct-callers", "sides": ["old", "new"] }]
```

Rule IDs must exist in the supplied YAML and be unique. Each entry has exactly these
three fields. Sides must be a nonempty unique subset of `old`, `new`. Unknown kinds,
fields, duplicate entries and executable JSON properties fail. Policy bytes are
bounded to 256 KiB. Disabled and skipped rules produce `rule-not-selected` omissions.

Only selected **v3 changed-syntax observations with known nearest named scope**
can request context. The planner finds the narrowest indexed `FunctionDeclaration`
or `MethodDeclaration` containing the observation and enclosing-name lines and
matching that name in the same change and revision. Equal-span candidates are
ambiguous. A full-source parse diagnostic for that file prevents requests.
Anonymous functions, arrows, top-level syntax, unavailable patch scope, and older
syntax contracts produce omissions. Path-only rules have `syntax-anchor-required`;
they do not request every declaration in a matching file.

Requested opposite-side targets require an explicit unique semantic counterpart
link. Missing/deleted/renamed/ambiguous scopes retain the underlying decision reason;
added-only targets without an indexed old association have `counterpart-unavailable`.
Structural links do not establish semantic identity. See [semantic contract](semantic-contract.md).

The `rule-context-bundle/v1` envelope contains:

| Field | Meaning |
| --- | --- |
| `id` | SHA-256 of normalized envelope payload |
| `bundle` | Ordinary `review-bundle/v3`, accepted by the existing reviewer/evaluation boundary |
| `contextPlan.policy` | Normalized operator-supplied rule policy |
| `contextPlan.rulesConfigId` | Supplied rule configuration identity |
| `contextPlan.decisions` | Selection status/reason and per-rule targets or omissions |
| `contextPlan.requests` | Unique requests actually passed to caller expansion |
| `contextPlan.omittedTargetIds` | Unique targets excluded by the target budget |
| `limitations` | Explicit scope and completeness boundaries |

Each proposed target records its side/commit, rule membership, anchor patch evidence,
line range, nearest scope/name line, anchor declaration ID and association basis.
Duplicate target IDs across rules yield one request while retaining each provenance
record. IDs are lexically sorted; the first `maxTargets` are requested (default 50,
range 1–50); the rest have `status: omitted`, `reason: target-limit`. This is deterministic
allocation, not a relevance ranking. Policy order and side order do not alter output.
Planning is limited to 5 million comparisons and 10,000 records per rule. Limit
failures return no partial envelope. Output is cloned/frozen, default 16 MiB,
maximum 64 MiB via `maxEnvelopeBytes`; ordinary bundle budgets still apply.

Caller expansion separately records static matches and snippet omissions under its
10-snippet/80-line/64-KiB limits. No requests or zero static matches do not prove no
callers. Indirect variable calls, runtime dispatch, Angular templates and external
packages remain unsupported. Synthetic contract checks do not measure reviewer gains.

The initial operation resolves base/head once; the expansion pass uses those full
commit IDs and comparison semantics. Moving refs and dirty checkout files do not
change the selected revision between passes. Standard ingestion options and
`maxBundleBytes` are supported; `semantic` and manual `contextRequests` are rejected
by this operation to keep policy attribution complete.

```sh
review-bundle rule-context-bundle --repo /path/to/repo --base BASE --head HEAD \
  --rules /trusted/angular-invariant-rules.yaml \
  --context-policy /trusted/context-policy.json > context-envelope.json
node --input-type=module -e 'import fs from "node:fs"; const x=JSON.parse(fs.readFileSync("context-envelope.json","utf8")); fs.writeFileSync("bundle.json",JSON.stringify(x.bundle));'
review-bundle packet --bundle bundle.json --reviewer-id provisional --reviewer-version v1
```

Use matching rule IDs for your own policy. The shipped example policy pairs with
`examples/angular-invariant-rules.yaml`; it may produce omissions because framework
callers are outside the static subset. Pass `.bundle` to `createReviewerRequest`,
not the outer envelope. The envelope preserves planning provenance for the operator;
the existing reviewer validates the inner bundle. An imported envelope is not an
authenticated planning claim, and no separate envelope-import validator is supplied.

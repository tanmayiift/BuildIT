# Two-user tenant isolation, executed against production

Date: 2026-09-02. Deployment: `https://buildit-agentic-review.vercel.app`,
Convex `judicious-barracuda-968`.

Two GitHub identities, each signed in independently through the normal OAuth flow. No cookie or
session was copied between them, which is what `docs/security/two-user-production-proof.md`
forbids and why the harness refuses a shared storage state.

| | Identity A | Identity B |
|---|---|---|
| GitHub login | `tanmayiift` | `smratipahwa` |
| Workspace | tanmayiift's workspace | smratipahwa's workspace |
| Organization id | `n57d05n4jcqcg7648he7wj4ae58dgwvr` | `n574kqc2hn5gn4r5cnt92adzxs8dk0kv` |

Every probe below ran from identity B's live browser session against production. B's session token
was never read out of the browser: the requests were issued inside the page and only the
pass/refuse result was returned.

## Same function, own organization versus A's organization

The control is the pair. A refusal on its own could mean the function is broken; a refusal beside a
success on the same function means the refusal is authorization.

| Public query | B's own organization | A's organization |
|---|---|---|
| `activation:funnel` | success | refused |
| `usage:summarize` | success | refused |
| `audit:list` | success | refused |
| `metrics:summarize` | success | refused |
| `memberships:list` | success | refused |
| `reviews:list` | success | refused |

## Direct object references

These take an id and no organization argument, so they are the insecure-direct-object-reference
case rather than a filter case.

| Public query | Argument | Result |
|---|---|---|
| `reviews:getEvidence` | A's review `nx70e3kyn3y2vdaxgqr6bsfbtd8dm6ke` | refused |
| `dashboardReviewData:availableProviders` | A's repository `nd7cf3e0retp5170jbcpqpz7dh8djy59` | refused |

Production masks the reason as a generic server error, so no id, name or existence signal leaks
back to the caller. The in-process suite (`convex/tenantIsolation.test.ts`) asserts the specific
`not_found_or_forbidden` code behind that mask.

## What this does not cover

Write paths were not exercised against the other tenant, because doing so would mean attempting a
real mutation on someone else's workspace. Those are covered in process by
`convex/tenantIsolation.test.ts`.

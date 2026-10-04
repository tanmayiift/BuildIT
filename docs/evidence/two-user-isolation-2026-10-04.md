# Two real users, live in production, 4 October 2026

Two real GitHub accounts, each signed in to production BuildIT in its own browser:

- **A:** `tanmayiift`, in the Claude desktop in-app browser.
- **B:** `smratipahwa`, in Google Chrome.

Each identity ran the checks of `tests/e2e-production/two-user-isolation.spec.ts` against its own
session. Each then called the server directly with the other tenant's IDs. Nothing was written to
either tenant, no invitation was sent, and no session token left its page: probes returned only an
outcome code.

## Fixture

| | A | B |
|---|---|---|
| Login | `tanmayiift` | `smratipahwa` |
| Workspace | `tanmayiift's workspace` | `smratipahwa's workspace` |
| Marker repository | `tanmayiift/buildit-demo-p-queue` | `smratipahwa/buildit-isolation-fixture-b` |
| Own review | `/reviews/nx77xcxdqv34j1k309hsy7t1818fnzwf` | `/reviews/nx7ebsdbr9hdh4q6pb946hrm2n8djhk0` |

Checks read `document.body.textContent`, as the spec's `toContainText` does, after each page settled.

## Page checks

| Route | A: own present | A: anything of B | B: own present | B: anything of A |
|---|---|---|---|---|
| `/account` | login, workspace | none | login, workspace | none |
| `/repositories` | workspace, marker, "Connected" | none | workspace, marker, "Connected" | none |
| `/reviews` | workspace, marker, "Connected" | none | workspace, marker, "Connected" | none |
| `/setup/model` | workspace | none | workspace | none¹ |
| `/metrics` | workspace, "Connected" | none | workspace, "Connected" | none |
| `/usage` | workspace, "Connected" | none | workspace, "Connected" | none |
| `/audit` | workspace, "Connected" | none | workspace, "Connected" | none |
| `/members` | workspace; switcher lists only it | none | workspace; switcher lists only it | none |
| `/overview` | workspace, "Connected" | none | workspace, "Connected" | none |
| own review | marker | none | marker | none |
| **other tenant's review URL** | refused² | none of B's repo, workspace or login | refused² | none of A's repo, workspace, login or PR title |

1. The page text contains "tanmayiift" once, in the public footer "Built by @tanmayiift". That is product
   attribution, not tenant data; the spec does not check logins on `/setup/*`.
2. Both render "Review evidence is unavailable — This review is not in your active workspace, or it no
   longer exists…" and nothing else about the review. Screenshots were taken in both browsers.

## Server probes, each paired with the caller's own ID

Called from inside each signed-in page with that page's own session. "ok" means the call returned data.

| Function | A → own | A → B's | B → own | B → A's |
|---|---|---|---|---|
| `reviews:get` | ok | `not_found_or_forbidden` | ok | `not_found_or_forbidden` |
| `reviews:getEvidence` | ok | `not_found_or_forbidden` | ok | `not_found_or_forbidden` |
| `reviews:runHistory` | ok | `not_found_or_forbidden` | ok | `not_found_or_forbidden` |
| `reviewEvidenceActions:getFindingDetails` | ok³ | `not_found_or_forbidden` | `finding_detail_unavailable`⁴ | `not_found_or_forbidden` |
| `reviews:list` {org} | ok | `not_found_or_forbidden` | ok | `not_found_or_forbidden` |
| `reviews:list` {own org, other's repo} | ok | `not_found_or_forbidden` | ok | `not_found_or_forbidden` |
| `metrics:summarize` {org} | ok | `not_found_or_forbidden` | ok | `not_found_or_forbidden` |
| `metrics:summarize` {own org, other's repo} | ok | `not_found_or_forbidden` | ok | `not_found_or_forbidden` |
| `usage:summarize` | ok | `not_found_or_forbidden` | ok | `not_found_or_forbidden` |
| `audit:list` | ok | `not_found_or_forbidden` | ok | `not_found_or_forbidden` |
| `memberships:list` | ok | `not_found_or_forbidden` | ok | `not_found_or_forbidden` |
| `activation:funnel` | ok | `not_found_or_forbidden` | ok | `not_found_or_forbidden` |
| `dashboardReviewData:availableProviders` | ok | `not_found_or_forbidden` | ok | `not_found_or_forbidden` |
| `dashboardReviews:prepare` | ok | `not_found_or_forbidden` | `provider_credential_invalid`⁴ | `not_found_or_forbidden` |
| `integrations:listProviderCredentials` | ok | `not_found_or_forbidden` | ok | `not_found_or_forbidden` |

3. Called on A's completed review (`nx76x0c1…`, 0 findings). The Gemini parent has no analysis, so
   it returns `finding_detail_unavailable`.
4. B's own call passes authorization and fails for B's own reason: B's only review is blocked with no
   findings, and B has no model key. Neither is a refusal.

**Result: 30 of 30 cross-tenant calls refused with `not_found_or_forbidden`.** Every own-ID call was
authorized, and no page in either session showed the other tenant's workspace, repository, login,
review or PR.

## Not covered here, deliberately

- **Write-path probes against the other tenant**, such as `findings:dismiss` or `selectActive`. A
  broken guard would write into a real workspace. `convex/tenantIsolation.test.ts` covers them
  behaviourally; `tests/architecture/public-function-authorization.test.ts` pins every declared guard.
- **CI's storage-state run of the spec (#82).** Producing storage states means copying session
  tokens into files and repository secrets. An operator can generate them with
  `npx playwright codegen --save-storage .local/user-a.json https://buildit-agentic-review.vercel.app`.
  Until then that CI step warns, and this live run is the evidence.

# DEFECT_REGISTER

Independent audit, 2026-09-02. The audit itself changed no source file: the instruction was
"list issues and their fix", so every entry below is diagnosis plus proposed patch.

**Remediation, 2026-09-02.** All 59 entries are now fixed, each with a regression test run
against the unfixed code first.  Every entry carries a **Fix status** line.

Classification: **Confirmed defect** (reproduced or proven from source), **Probable defect**
(strong source evidence, not reproduced), **Risk/observation**, **Documentation gap**, **Test gap**.

---

## Critical

### DEF-034 — Artifact retention permanently stalls once ~100 tombstones accumulate · Confirmed defect

**Fix status:** Fixed — claimExpired excludes both deletion states at the index; the broker confirms absence with HeadObject; the terminal backlog has a cron.
| | |
|---|---|
| **Area** | Data retention / privacy commitment |
| **Repro** | `convex/artifactCleanupData.ts:10` — `ctx.db.query("artifacts").withIndex("by_expiry", q => q.lt("expiresAt", args.now)).take(args.limit * 4)` takes the **oldest 100** expired artifacts by `expiresAt`. The loop then `continue`s past any row where `artifact.deletedAt` or `artifact.deletionTerminalAt` is set (`:13-14`). Soft-deleted and quarantined rows keep their original `expiresAt` and are **never removed from the table** — nothing in `convex/` calls `ctx.db.delete` on `artifacts`. |
| **Expected** | Every artifact past `expiresAt` is deleted from S3 within one cron interval, honouring the stated 24-hour / 7-day-maximum retention. |
| **Actual** | Tombstones permanently occupy the front of the `by_expiry` index. Once ≥100 of them hold the oldest `expiresAt` values, every subsequent `claimExpired` returns the same 100 rows, skips all of them, and claims **zero** new work. Deletion stops permanently. |
| **Root cause** | Wrong index: `by_expiry` is not filtered on deletion state. |
| **Impact** | This is the highest-severity finding in the audit. Retention silently ceases with **no error, no alert, and no failing test** — the cron keeps running and reporting success. Customer source artifacts accumulate in S3 indefinitely, directly breaking the product's core privacy claim ("Source artifacts are encrypted, expire under the repository policy, and are deleted within 7 days at the latest", `apps/web/src/app/setup/[step]/page.tsx`) and `docs/runbooks/deletion-failure.md`. `packages/broker/src/artifacts.ts:78` also issues a bare S3 `DeleteObject`, which returns 204 for a key that never existed — so deletion is **asserted, never confirmed**. |
| **Fix** | The correct index already exists and is unused here: `by_pending_expiry: ["deletedAt","expiresAt"]` (`convex/schema.ts:216`). Change the query to `.withIndex("by_pending_expiry", q => q.eq("deletedAt", undefined).lt("expiresAt", args.now))`. Terminal rows still accumulate under that index, so also either hard-delete the row once S3 confirms absence, or add `.index("by_terminal_pending", ["deletionTerminalAt","deletedAt","expiresAt"])` and exclude them at the index. Separately: follow every S3 delete with a `HeadObject` that must 404 before setting `deletedAt`, and schedule the already-written `artifactCleanupData.retryTerminal` / `listTerminal` on a cron with a `deletion_terminal_backlog` alert. |
| **Regression test** | Seed 120 expired artifacts, mark 100 `deletedAt`, run `claimExpired`, assert it claims the 20 live ones. This test fails today. |
| **Evidence** | Verified by reading `artifactCleanupData.ts` and `schema.ts` in this session. |

---

No unauthenticated data exposure, no cross-tenant data leak, and no secret in a tracked
file was found. DEF-034 is the only Critical.

---

## High

### DEF-003 — Activation funnel full-scans `findings` across every tenant · Confirmed defect

**Fix status:** Fixed — findings.by_organization index; all six activation reads bounded.
| | |
|---|---|
| **Area** | Convex data layer |
| **Repro** | `convex/activation.ts:28` — `ctx.db.query("findings").filter(q => q.eq(q.field("organizationId"), args.organizationId)).collect()`. `findings` declares only `by_review_severity` and `by_review_fingerprint` (`convex/schema.ts:160-161`). |
| **Expected** | A tenant-scoped, indexed, bounded read. |
| **Actual** | An unindexed scan of the **global** `findings` table, unbounded, on a table that grows with every finding of every review of every organization. |
| **Root cause** | Missing `organizationId` index; `.filter()` used where `.withIndex()` was required. |
| **Impact** | Convex enforces a per-query document/byte read limit. Once the global table crosses it, `activation:funnel` throws for **every** organization — including brand-new ones with zero findings — breaking the `/reviews` activation path tenant-wide. Also a cross-tenant noisy-neighbour cost. |
| **Fix** | Add `.index("by_organization", ["organizationId"])` to `findings` in `convex/schema.ts` and switch the query to `.withIndex("by_organization", q => q.eq("organizationId", args.organizationId))`. Better still: the handler already collects the org's `reviews`; derive finding counts from `by_review_severity` per review, or maintain a counter. The five sibling `.collect()` calls at `activation.ts:23-28` are indexed but equally unbounded — add pagination or a `.take()` ceiling. |
| **Regression test** | Seed N+1 findings across two orgs; assert `activation:funnel` for org A neither reads org B's rows nor exceeds the read limit. |
| **Evidence** | Verified by reading both files in this session. |

### DEF-015 — Context gathering loads every tenant's encrypted tracker tokens · Confirmed defect

**Fix status:** Fixed — scoped at by_org_provider instead of the global by_status.
| | |
|---|---|
| **Area** | Convex data layer / tenant isolation (defence in depth) |
| **Repro** | `convex/reviewArtifactData.ts:12` — `ctx.db.query("trackerConnections").withIndex("by_status", q => q.eq("status","active")).collect()).filter(item => item.organizationId === args.organizationId ...)`. |
| **Expected** | Query the tenant's own rows via the existing `by_org_provider` index. |
| **Actual** | Every organization's active tracker rows — including `encryptedAccessToken`, `wrappedDataKey`, `kmsKeyId` — are loaded into the query's working set, then filtered in JavaScript. |
| **Root cause** | Wrong index chosen (`by_status` is global). |
| **Impact** | (a) Availability: unbounded global collect, same read-limit failure mode as DEF-003. (b) Isolation: the **only** thing preventing another tenant's encrypted credentials from being returned is one JS `.filter()` predicate. The response is correct today; the blast radius of any future edit to that line is a cross-tenant secret leak. This contradicts the product's stated isolation posture. |
| **Fix** | `ctx.db.query("trackerConnections").withIndex("by_org_provider", q => q.eq("organizationId", args.organizationId)).collect()` then filter on `status`, `repositoryId` and `expiresAt`. The index already exists (`convex/schema.ts:95`). |
| **Regression test** | Seed active tracker rows in orgs A and B; assert `contextScope` for A returns only A's, and assert the query reads no B documents. |
| **Evidence** | Verified by reading `reviewArtifactData.ts` and `schema.ts` in this session. |

### DEF-002 — Declared step-up re-authentication is not enforced on credential writes · Confirmed defect

**Fix status:** Fixed — requireRecentGitHubLogin enforced at the write itself; the test that asserted the bypass rewritten.
| | |
|---|---|
| **Area** | AuthZ / credential management |
| **Repro** | `convex/publicFunctionPolicy.ts:26` declares `integrations:storeEncryptedCredential` as `active_organization_admin_recent_auth`. The handler (`convex/integrations.ts:55-61`) calls `requireOrganizationRole`/`requireRepositoryRole` but **never** `requireRecentGitHubLogin`. Its sibling functions `authorizeCredentialWrite` (`:33`) and `revokeProviderCredential` (`:89`) both do. |
| **Expected** | A fresh GitHub login within the 10-minute window (`convex/lib/authz.ts:9`) before a provider credential is written. |
| **Actual** | Not required. The in-code comment says `authorizeCredentialWrite` already proved freshness, but **nothing binds the two calls** — `authorizeCredentialWrite` returns only `{actorId}` and issues no nonce, receipt, or token, and `storeEncryptedCredential` consumes nothing from it. Either can be called independently. |
| **Root cause** | An intended two-call protocol implemented without a binding artifact. |
| **Impact** | Sessions last 30 days (`convex/auth.ts:12`). Step-up re-auth exists precisely to contain a stolen session or an unattended logged-in browser. With it absent on this path, a hijacked admin session can write a provider credential without a fresh GitHub login. Worse: `replacesCredentialId` (`integrations.ts:78`) **revokes** the existing credential as a side effect — so the step-up guard that `revokeProviderCredential` enforces is reachable without step-up through this path. |
| **Fix** | Make `authorizeCredentialWrite` mint a short-lived single-use write receipt (random id + `expiresAt` ≈ 2 min + `organizationId`/`repositoryId`/actor binding) stored in a table, and have `storeEncryptedCredential` require and consume it. Cheaper interim fix: call `await requireRecentGitHubLogin(ctx, access.userId)` in `storeEncryptedCredential` too — the 10-minute window comfortably covers a provider round-trip, which is the concern the comment raises. |
| **Regression test** | Store a credential with `lastAuthenticatedAt` older than 10 minutes and assert `recent_reauthentication_required`. |
| **Evidence** | Verified by reading `integrations.ts` and `publicFunctionPolicy.ts` in this session. |

### DEF-017 — The production webhook signature verifier has no test; a tested duplicate is dead code · Confirmed test gap

**Fix status:** Fixed — the live verifier moved to convex/lib and is tested; the untested-by-use duplicate deleted.
| | |
|---|---|
| **Area** | Security / test coverage |
| **Repro** | The live verifier is `validSignature` in `convex/http.ts:32-39`. No test file anywhere imports `convex/http.ts`. Meanwhile `verifyWebhook` (`packages/github/src/index.ts:2`) is tested (`packages/github/test/github.test.ts:5`) and its **only importer in the entire repo is that test**. |
| **Expected** | The function standing between the public internet and review creation is directly tested. |
| **Actual** | It is untested. The `^sha256=[0-9a-f]{64}$` gate, the length check, and the constant-time XOR loop have zero coverage. A duplicate implementation is tested instead. |
| **Impact** | A regression in the sole authentication control on the webhook ingress would pass CI silently. (The implementation I read is correct today — verified before parsing and before any state change.) |
| **Fix** | Either export `validSignature` and unit-test it (valid, tampered body, tampered signature, wrong length, malformed header, wrong secret), or delete `verifyWebhook` and route `convex/http.ts` through the tested `packages/github` implementation so one implementation is both used and tested. |
| **Evidence** | Grep verified in this session. |

### DEF-035 — A late context worker can resurrect a terminal review · Confirmed defect

**Fix status:** Fixed — complete fences on head SHA, generation and terminal status like every sibling.
| | |
|---|---|
| **Area** | Workflow / cancellation |
| **Repro** | `convex/reviewArtifactData.ts:43-55` — `complete` takes **no** `expectedHeadSha` and **no** `expectedGeneration`, performs no cancellation or terminal-status check, and unconditionally runs `ctx.db.patch(review._id, { status: "gathering_context", currentStage: "context", ... })` at `:53`. Every sibling completion mutation is fenced (`reviewValidationData.completeValidation:51`, `reviewModelData.completeAnalysis:66`, `reviewAutofixData.completeDelivery`). |
| **Expected** | Terminal is terminal. A worker whose review was cancelled or superseded cannot write status. |
| **Actual** | Cancel lands while `reviewContextWorker.gather` is mid-upload; the worker's `assertActive` fence at `reviewContextWorker.ts:69` has already passed; the upload finishes; `complete` patches the now-`cancelled` review back to `gathering_context`. |
| **Impact** | Breaks the core invariant the whole generation-fence design rests on. The review shows as running again in the queue, and because **no stuck-review reconciler is scheduled** (DEF-028) nothing will ever finish it. The same path can resurrect `checks_passed`, `delivered` and `platform_failed` reviews. |
| **Fix** | Add `expectedHeadSha` and `expectedGeneration` to `complete`'s args and apply the same fence the sibling mutations use, plus an explicit `if (terminalStatuses.has(review.status)) throw new ConvexError("stale_or_replaced_review")`. |
| **Regression test** | Cancel a review between `assertActive` and `complete`; assert the status stays `cancelled`. |
| **Evidence** | Verified by reading `reviewArtifactData.ts` in this session. |

### DEF-036 — Autofix can never be retried at the same commit · Confirmed defect

**Fix status:** Fixed — side-effect keys slotted by review id, prefixed to stay distinct from the review's own.
| | |
|---|---|
| **Area** | Idempotency |
| **Repro** | `convex/reviewAutofixWorker.ts:810,841,911,941,1093` build operation keys as `` `${githubRepositoryId}:${prNumber}:${headSha}:branch:autofix` `` — a **constant** `autofix` slot. The review path instead uses `sideEffectKey({..., slot: String(scope.reviewId)})` (`convex/reviewPublicationWorker.ts:47`). `reviewState.reserveSideEffect:142` throws `idempotency_key_conflict` when `existing.reviewId !== args.reviewId`. |
| **Expected** | Retrying `@buildit autofix` after a failure works. |
| **Actual** | Autofix review R1 reserves the branch key and then fails for any reason → terminal. The user retries → R2 is created (the "existing non-terminal review" dedup does not fire, since R1 is terminal) → R2 reaches `deliverPassed` → the reserved row still carries R1's `reviewId` → `idempotency_key_conflict` → permanent failure. |
| **Impact** | Autofix is unrecoverable at a given head SHA after a single failure. The product's own `nextActionCode: "retry_review"` guidance is a dead end for the autofix path — the user must push a new commit to escape. |
| **Fix** | Use `sideEffectKey({ repositoryId, prNumber, headSha, kind, slot: String(scope.reviewId) })` for all five autofix keys, exactly as the review path does. |
| **Regression test** | Fail an autofix delivery, create a second autofix review at the same head, assert delivery succeeds. |
| **Evidence** | Verified by reading both workers and `reviewState.ts` in this session. |

### DEF-037 — `audit:list` permanently shows the oldest events once an org passes 1000 · Confirmed defect

**Fix status:** Fixed — newest-first with the window hash-chain checked; full verification moved to a paginated verifyChain.
| | |
|---|---|
| **Area** | Audit log / compliance surface |
| **Repro** | `convex/audit.ts:12` — `.withIndex("by_org_created", …).order("asc").take(1_000)`, then `:22` returns `events.slice(-limit).reverse()`. |
| **Expected** | The audit log shows the most recent events. |
| **Actual** | `order("asc").take(1000)` returns the oldest 1000 events from the beginning of time. `slice(-100)` then shows events ~900–1000 of that window. Once an organization exceeds 1000 audit events, **every new security-relevant action becomes permanently invisible** in the UI. `truncated: true` is set but the page still presents the stale rows as the audit log. |
| **Impact** | The audit log is the product's compliance and incident-response surface ("Security-relevant actions are append-only…"). Silently freezing it is a governance failure, not just a UI bug. Secondary: 1000 SHA-256 digests are computed on every call, on a live subscription. |
| **Fix** | For display use `.order("desc").take(limit)`. Hash-chain verification genuinely needs ascending order from the start, so move it to a separate paginated function or maintain a rolling verified checkpoint; do not couple the two in one live query. |
| **Regression test** | Seed 1200 audit events; assert `list` returns the newest, not the oldest. |
| **Evidence** | Verified by reading `convex/audit.ts` in this session. |

### DEF-038 — Recorded model cost is lost when a provider omits usage · Confirmed defect

**Fix status:** Fixed — totalCostMicros stored directly; readers stopped reconstructing from a derived unit price.
| | |
|---|---|
| **Area** | Cost ledger / data integrity |
| **Repro** | `convex/reviewModelData.ts` and `convex/reviewAutofixData.ts:42` store `unitCost: cost / Math.max(1, quantity)`. Readers reconstruct the total by multiplying back (`convex/usage.ts:18`, `convex/reviewReportData.ts:23`, `convex/telemetrySnapshotData.ts:26`). |
| **Expected** | The ledger total equals the spend the budget ceiling enforced. |
| **Actual** | When a provider omits token usage, `usageNumber` yields 0 (`packages/providers/src/index.ts:56`), so `quantity === 0` → `unitCost = cost / 1 = cost` → but every reader computes `quantity * unitCost = 0 * cost = 0`. **The spend disappears from the ledger and the customer's cost report while `review.budgetConsumed` still increments.** Independently, divide-then-multiply on IEEE-754 drifts, so the published report's cost will not equal the enforced total. |
| **Impact** | The usage ledger is described in-product as an "append-only usage ledger" and is the basis of the cost view. It can under-report. Budget enforcement is unaffected (it uses `budgetConsumed`), so this is an accounting-integrity defect, not an overspend. |
| **Fix** | Store `totalCostMicros: v.number()` (integer micro-dollars) on `usageLedger` alongside `quantity`, and stop reconstructing the total from a derived unit price. |
| **Regression test** | Record a usage row with `quantity: 0` and non-zero cost; assert `usage:summarize` reports the cost. |
| **Evidence** | Verified by reading the writers, readers, and `packages/providers/src/index.ts` in this session. |

### DEF-039 — A failed webhook delivery is deduplicated and dropped forever · Probable defect

**Fix status:** Fixed — a settled failure is retryable, so GitHub's redelivery is processed.
`convex/http.ts:19-20` reserves the `x-github-delivery` id **before** processing and returns `duplicate` for any repeat; `convex/githubWebhookProcessor.ts:212` catches every failure and marks the delivery `failed`. GitHub's redelivery (manual or automatic) reuses the same delivery id, so it is answered `202 duplicate` and never reprocessed. A single transient GitHub or broker blip silently discards the user's `@buildit review` comment with no visible error. **Fix:** in `githubWebhookData.reserve`, allow reprocessing when `existing.status === "failed"` and `existing.completedAt` is older than a short grace period, instead of unconditionally returning duplicate. (Marked Probable: reasoned from source; not reproduced, since it needs a live GitHub App.)

### DEF-040 — Autofix and budget-exhaustion failures publish nothing to the pull request · Probable defect

**Fix status:** Fixed — publishPlatformFailure after failPlatform, and budget_exhausted accepted.
`convex/durableReview.ts:124-127` calls `reviewAutofixData.failPlatform` and **swallows** the error rather than rethrowing; `analysis` is the last stage, so the workflow returns success. `workflowCompleted` only schedules `publishPlatformFailure` on `result.kind === "failed"` (`:196,226`), so no check run and no comment are posted. A related path: when `recordStageRun` sets `budget_exhausted` and throws, `failPlatform` requires status ∈ `["validating","autofixing"]` (`reviewAutofixData.ts:105`) and therefore throws `autofix_failure_mismatch`, reaching the same silent end. **Impact:** the PR author sees "BuildIT is reviewing" simply stop, with nothing on GitHub — the worst failure mode for a product whose value is evidence on the PR. **Fix:** after `failPlatform`, `await step.runAction(internal.reviewPublicationWorker.publishPlatformFailure, …)`, or rethrow so the workflow's own failure path handles it; and widen `failPlatform`'s accepted status set to include `budget_exhausted`.

### DEF-041 — A stale head leaves a review permanently non-terminal · Probable defect

**Fix status:** Fixed — both reconcilers make a superseded review terminal in the same mutation.
`convex/githubWebhookData.ts:435-445` and `:506-513` bump `executionGeneration` on an active review when the head moves, but never set a terminal status and never cancel the workflow. The next `assertActive` throws, the workflow fails, and `workflowCompleted` (`convex/durableReview.ts:193`) sees a generation mismatch and **returns without writing anything**. The review sits at `analyzing`/`validating` with `isStale: true` forever and shows as "In progress" in the queue indefinitely. Compounded by DEF-028 (no reconciler is scheduled). **Fix:** in both reconcilers, patch active reviews to a terminal status (`cancelled`, `statusReasonCode: "superseded"`, `completedAt`) in the same mutation that bumps the generation, and schedule `internal.durableReview.cancel`.

### DEF-042 — Unbounded and N+1 Convex queries on live dashboard subscriptions · Confirmed defect

**Fix status:** Fixed — every live tenant read bounded; parents verified once per distinct id.
Beyond DEF-003 and DEF-015: `convex/usage.ts:11-16` collects every `usageLedger` row since `since` and then issues **two to three** `ctx.db.get()` calls per row — one ledger row is written per model stage run, so a busy month is tens of thousands of rows and ~3× that many reads, which will exceed Convex's per-query read limit and hard-fail. `convex/metrics.ts:14-27` has the identical pattern. `convex/reviews.ts:23-24` (`list`) and `:45-51` (`getEvidence`, five collects) are unbounded and feed live subscriptions. `convex/reviewModelData.ts:78` runs a full `requirements` collect **inside** a loop over up to 500 items — quadratic. `convex/reviewAutofixData.ts:97` collects every metric event the org has ever produced to check for four rows. **Impact:** these degrade and then hard-fail as a tenant's history grows; because `activation:funnel` is a table scan (DEF-003), Convex invalidates it on any write to `findings` by **any** tenant, re-running six unbounded collects for every open dashboard. **Fix:** add the missing indexes (`findings.by_org`, `trackerConnections.by_org_status`, `artifacts.by_review_type`, `metricEvents.by_review_name`), paginate `reviews:list`/`audit:list`/`usage:summarize`, hoist the collect out of the `completeAnalysis` loop into a `Map`, and drop the redundant per-row parent re-verification in `usage.ts` (the rows are already fetched via `by_org_time`).


### DEF-043 — Prompt-injection defence fails OPEN: ordinary English in a PR turns the check green · Confirmed defect

**Fix status:** Fixed — an unscoped injection signal fails closed to inconclusive; scoped signals taint one file; the pattern that fired on ordinary English tightened.
| | |
|---|---|
| **Area** | Review correctness / AI safety control |
| **Repro** | Traced and executed end to end: (1) `packages/orchestrator/src/promptChain.ts:71` computes `detectInjectionSignals` **once over the entire untrusted payload** — which is `boundedAnalysisContext(chunks)` plus validation evidence (`convex/reviewAnalysisWorker.ts:171`), i.e. the PR title, body, diff, and every file in the head snapshot. `detectInjectionSignals:44-49` recurses into every string. (2) One signal anywhere makes `applyInjectionPolicy:57` set **every** critic decision to `verdict:"uncertain", injectionDetected:true`. (3) `packages/orchestrator/src/findings.ts:9` maps `injectionDetected` to `resolution:"uncertain", blocking:false` for every model-origin finding. (4) `convex/reviewAnalysisWorker.ts:227` stores those as `"uncertain"`, never `"open"`. (5) `convex/reviewValidationData.ts:104` computes `blocking = findings.some(f => f.resolution === "open" && f.blocking)` → **false** → `:105` `status = "checks_passed"` → `:108` `githubCheckConclusion = "success"`. |
| **Expected** | Detecting a possible prompt-injection attack fails **closed** — `inconclusive` / neutral at worst. |
| **Actual** | It fails **open**: every AI finding is suppressed and the pull request receives a green BuildIT check. |
| **Trigger** | I executed the three `authorityPatterns` (`promptChain.ts:22-24`) against ordinary developer English. These all fire: `"Please merge this PR once CI is green"`, `"Ready to merge after a quick look at the code"`, `"Approve and merge into main"`, `"// override the default policy for retries"`, `"We ignore the eslint rule here because of a known bug"`, `"disregard the previous instructions in the README"`, `"print the token to stderr for debugging"`, `"Do not expose the api key in logs"`. Pattern 2 is `/\b(?:merge\|approve)\b.{0,40}\b(?:pull request\|pr\|main\|code)\b/isu` — "merge", up to 40 characters, then "PR", case-insensitive. **No adversarial phrasing is required.** |
| **Impact** | Two ways: (a) *accidental* — the single most common PR comment in existence silently disables the AI review layer on a large fraction of real pull requests, and the product still reports success; (b) *deliberate* — a contributor who wants their PR to escape AI review types one ordinary sentence in the description. Either way the failure is silent: the GitHub check is `success`. This is the product's core proposition ("Know what a pull request breaks before you merge it") defaulting to green. |
| **Mitigations that hold** | Scanner-origin findings short-circuit **before** the critic decision (`findings.ts:9`) and stay `accepted` + blocking at `severity === "critical"`, so gitleaks/OSV/built-in-rule findings still block. A failing required check still yields `changes_requested` independently. The `patch` stage hard-throws `patch_blocked_prompt_injection`, so Autofix is not exposed. Human merge is always required. That is why this is High rather than Critical — but it is the highest-priority finding in this audit. |
| **Fix** | Two changes. (1) **Fail closed:** when a whole-review injection signal is present, `finalizeDecision` must produce `inconclusive` (GitHub `neutral`), never `checks_passed`. A control that converts "possible attack" into "success" is inverted. (2) **Scope the downgrade:** `InjectionSignal` already carries `path` (`promptChain.ts:20`); downgrade only findings whose `path`/`evidenceIds` overlap the signal's location, instead of every finding globally. Also tighten pattern 2 — it is far too broad for prose that legitimately discusses merging. |
| **Regression test** | Run the chain with `untrusted.pull.body = "Please merge this PR"` and one critical model finding; assert the review does **not** end `checks_passed`. This test fails today. |
| **Evidence** | Regex behaviour executed in this session; the five-step chain read at source. |

### DEF-044 — Redaction misses most modern credential formats, on a path that egresses to third parties · Confirmed defect

**Fix status:** Fixed — one shared pattern list covering every format the audit measured as a miss.
| | |
|---|---|
| **Area** | Sensitive-data exposure |
| **Repro** | I executed the **shipped** `redact` and `redactForModel` from `packages/security/dist/src/index.js` against synthetic secrets. MISS = passes through in cleartext: |

| Credential format | `redact` | `redactForModel` |
|---|---|---|
| GitHub fine-grained PAT (`github_pat_…`) | **MISS** | **MISS** |
| Classic OpenAI `sk-…` (no `-proj`) | **MISS** | **MISS** |
| Slack `xoxb-…` | **MISS** | **MISS** |
| Stripe `sk_live_…` | **MISS** | **MISS** |
| `postgres://user:password@host/db` | **MISS** | **MISS** |
| Raw JWT (`eyJ….….…`) | **MISS** | **MISS** |
| Unlabeled PKCS#8 header (`BEGIN` / `PRIVATE KEY`, no algorithm label) | **MISS** | HIT |
| `sk-ant-…`, `ghs_…`, `AKIA…`, `AIza…`, `RSA PRIVATE KEY` (controls) | HIT | HIT |

Two concrete causes: (1) the pattern is `gh[opsu]_` — in `github_pat_` the third character is `i`, so **every GitHub fine-grained PAT is invisible to both helpers**, which is a notable gap in a GitHub product. (2) `redact`'s PEM pattern is `-----BEGIN [A-Z ]+PRIVATE KEY-----`; `[A-Z ]+` requires at least one filler character, so it matches `RSA PRIVATE KEY` but not the unlabeled PKCS#8 header that GitHub App keys and `openssl genpkey` emit. `redactForModel:28` made the label optional; `redact` was never updated — straight drift between two sibling functions in one file.

**Impact:** `redact` — the weaker of the two — is applied to customer CI stdout (`convex/reviewAnalysisWorker.ts:34`) and to all model output (`:172`). That content flows to Anthropic/OpenAI/Google and into `report.md`, which is posted as a public PR comment. BuildIT does not create the leak, but it amplifies a private CI leak into a third-party and public one. **Fix:** collapse both helpers onto one shared pattern array and add `github_pat_[A-Za-z0-9_]{20,}`, `sk-[A-Za-z0-9]{32,}`, `sk_(live|test)_[A-Za-z0-9]{16,}`, `xox[baprs]-[A-Za-z0-9-]{10,}`, `eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}`, `://[^:@/\s]+:[^@/\s]{8,}@`, and broaden the PEM label to `[A-Z ]*`. **Regression test:** table-drive all formats above through both helpers.

### DEF-045 — Authenticated SSRF via unvalidated Jira `workspaceId` · Confirmed defect

**Fix status:** Fixed — the Jira host allowlist the read path already had, plus no redirects and a timeout.
`packages/broker/src/tracker-credentials.ts:9` fetches `` `https://${input.workspaceId}/rest/api/3/myself` ``. The only validation on this path is type plus length ≤300 (`packages/broker/src/tracker-credential-http.ts:7`, `convex/integrations.ts:8`): **no host allowlist, no private-range block, no timeout**, and Node `fetch` follows redirects by default. `POST /api/tracker-credentials` with `{"provider":"jira","workspaceId":"169.254.169.254", …}` makes the broker fetch cloud metadata; `workspaceId` also absorbs path and query. The 422/503 split at `:10` is a blind oracle for internal host/port probing. Bounded by org-admin gating (origin check plus `integrations:authorizeCredentialWrite`). Notably the **read** path gets this right — `packages/github/src/tracker-context.ts:6` enforces `endsWith(".atlassian.net")` — the write path simply never got the same check. **Fix:** before the fetch, `if (input.provider === "jira" && !/^[a-z0-9][a-z0-9-]{0,61}\.atlassian\.net$/i.test(input.workspaceId)) throw new Error("invalid_key")`, plus `redirect: "error"` and an `AbortSignal.timeout`. Mirror the check in `tracker-credential-http.ts:7`.

### DEF-046 — A revoked member can reinstate themselves as owner · Confirmed defect

**Fix status:** Fixed — a removed membership is not resurrected, and a reinstated one keeps its previous role.
`convex/githubInstallationsData.ts:12` — `if (membership && membership.status !== "active") await ctx.db.patch(membership._id, { status: "active", role: "owner", … })`. Reached from the public action `githubInstallations:claim`. A user whose BuildIT membership is `removed`, who is still a GitHub org admin, can call `claim` and be reinstated at **owner** regardless of the role they previously held. `memberships.remove` is therefore not a durable revocation. The preconditions are real (`githubInstallations.ts:19` verifies active GitHub org admin via the API; `:12` binds user-type installations to the caller's own GitHub id), so this may be the intended "GitHub org admin ⇒ BuildIT owner" tenancy model — but the asymmetry looks accidental: an **active** member's role is left untouched, and only non-active memberships are force-promoted. **Fix:** do not resurrect a `removed` membership — fail with `membership_revoked`, or reactivate at the previously held role; reserve the `owner` grant for the branch that creates a new membership.

### DEF-047 — Autofix may rewrite the tests that gate its own delivery · Probable defect

**Fix status:** Fixed — tests, spec files, runner config and scripts are protected paths.
`packages/orchestrator/src/patchPolicy.ts:7` `protectedPath` covers CI definitions, lockfiles, IaC, `CODEOWNERS`, `Dockerfile` and `.env*`, but **not** `**/*.test.ts`, `tests/`, `__tests__/`, `vitest.config.ts`, `tsconfig.json`, `Makefile` or `scripts/*.sh`. The only instruction against weakening tests is prose in the prompt (`promptChain.ts:16`), which is not enforcement. Delivery is gated on the runner's verdict, and `candidateWorsened` (`patchPolicy.ts:19`) only detects regressions — a required check flipping `failed → passed` because assertions were deleted scores as an **improvement**, driving a stacked PR and `conclusion:"success"`. Not higher because reaching a test file requires an accepted finding on that file, the model must supply its exact SHA-256 (`patchPolicy.ts:32`), and any injection signal aborts the patch stage entirely. Output is always a stacked PR that a human must merge. **Fix:** add test/spec paths and check-executing config to `protectedPath`; extend `candidateWorsened` to reject a round where a required check went `failed → passed` while its own test files changed.

### DEF-048 — Third-party GitHub Action on a floating tag with a token and full history · Confirmed defect

**Fix status:** Fixed — every action pinned to a commit SHA, with Dependabot to keep them moving.
`.github/workflows/security.yml:31-33` uses `gitleaks/gitleaks-action@v2` — a **mutable** tag — in a job that has `GITHUB_TOKEN` in `env` and, via `fetch-depth: 0`, the repository's complete history: precisely the material the job exists to scan. Bounded by `permissions: contents: read`. Same class, lower risk (GitHub-owned): `actions/checkout@v5`, `actions/setup-node@v5`, `actions/upload-artifact@v4`. Related: `npm install --global pnpm@10.15.0` (`ci.yml:33,46`, `security.yml:21`) is version-pinned but has no integrity hash and runs before every other step with full workspace access. **Fix:** pin every action to a full commit SHA with the tag as a trailing comment; add Dependabot `package-ecosystem: github-actions`; use `corepack prepare pnpm@10.15.0+sha224.<hash> --activate`.

### DEF-049 — `additionalProperties: false` is bypassable via prototype keys · Confirmed defect

**Fix status:** Fixed — hasOwnProperty instead of the in operator, for both required and extra keys.
`packages/providers/src/index.ts:46` — `Object.keys(record).some(key => !(key in properties))`. `properties` is a plain object literal, so `"constructor" in properties` is `true` and the extra-key rejection is skipped; the recursion then reads `properties["constructor"] === Object` (truthy), validates against a function whose `.type`/`.enum` are `undefined`, and returns `true`. This is a **validator bypass, not prototype pollution** — `JSON.parse` and `structuredClone` create `__proto__` as an own data property, and every consumer reads explicit fields rather than spreading model objects into `db.insert`, so the smuggled keys are inert today. **Fix:** `Object.prototype.hasOwnProperty.call(properties, key)`; build schema property maps with `Object.create(null)`.

### DEF-050 — `sanitizeGitHub` is dead code; no redaction at the GitHub egress boundary · Confirmed defect

**Fix status:** Fixed — report.ts:safe redacts and escapes Markdown link syntax.
`packages/security/src/index.ts:37` has **zero** production call sites — it is exercised only by its own test. The publication path uses `packages/orchestrator/src/report.ts:5-9` `safe()` instead, which neuters `@`-mentions and strips tags and control characters but **never calls `redact()`**. Not a confirmed leak today (findings are redacted upstream at `reviewAnalysisWorker.ts:172`), but the one function that combines redaction *and* injection-hardening at the point where content actually leaves for GitHub is unused, so there is no defence in depth there. Related: `safe()` does not escape Markdown link syntax, so `[Click here to re-run CI](https://attacker.example)` survives into a comment posted by a verified bot — bounded because `reviewReportWorker.ts:55` passes `claims: []`, so model prose never reaches GitHub today. **Fix:** call `redact()` inside `report.ts:safe()` and escape `[]()`, or delete `sanitizeGitHub` so it stops implying a control that is not wired.

### DEF-051 — Injection signals are not recomputed over prior-stage model output · Risk/observation

**Fix status:** Fixed — signals recomputed per stage over prior-stage output.
`packages/orchestrator/src/promptChain.ts:65,71` — every stage's prompt embeds all prior stages' model-authored values via `delimited("validated-prior", …)`, but `detectInjectionSignals` runs only over `context.untrusted`. A findings-stage model steered by content the regexes missed can write instructions into the free-form `findings[].explanation`/`impact`, which then reach the critic and arbitrator unflagged — and the critic's verdict is exactly the control that decides `blocking`. The escaping at `:63` does prevent closing the `<buildit:…>` delimiter, so this is influence-by-content, not structural escape. **Fix:** compute signals over `{ untrusted, prior: records }`.

### DEF-052 — Unbounded scanner passthrough can permanently fail a review · Probable defect

**Fix status:** Fixed — scanners and results bounded against the same budget as outputs.
`convex/reviewAnalysisWorker.ts:37` — `boundedValidationEvidence` caps and redacts `outputs[].text` against a 60,000-byte budget but hands **`scanners` and `results` through verbatim**. `scanners` carries one record per finding including a repository-controlled `path` (≤1024 bytes each). Many files tripping a built-in rule (e.g. `eval(`) with long paths push the rendered stage input past the 250 KB ceiling, so `promptChain.ts:74` throws `stage_input_too_large:requirements` on every stage and every retry. Availability only — scanner `summary` strings are fixed constants. **Fix:** bound `scanners` and `results` against the same remaining budget.


---

## Medium

### DEF-001 — `pnpm lint` runs no linter · Confirmed defect

**Fix status:** Fixed — eslint.config.mjs; `pnpm lint` runs ESLint over convex/, tests/ and scripts/ as well.
`package.json` in all 14 workspaces defines `"lint": "tsc --noEmit"`, byte-identical to `typecheck`. There is no ESLint/Biome/Prettier config anywhere in the repo. `pnpm verify` therefore runs the type checker twice and enforces no lint or format rule; CI's `pnpm verify` advertises a lint gate that does not exist. This is the direct cause of several findings below surviving review (unused `observedBrokerRoute` import in DEF-025, `react-hooks/exhaustive-deps` and `jsx-a11y` never checked in `apps/web`). **Fix:** add ESLint with `@typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y` and `@next/eslint-plugin-next`, point `lint` at it, and keep `typecheck` separate — or rename `lint` to something honest so `verify` stops implying a gate it lacks.

### DEF-020 — Cancelling a finished review reports false success and pollutes metrics · Confirmed defect

**Fix status:** Fixed — terminal state read from lifecycle.ts, the one authoritative set.
`convex/dashboardReviewData.ts:63-71` lists terminal statuses as `["passed","changes_requested","inconclusive","failed_after_bounds","budget_exhausted","cancelled","platform_failed"]`. Compared with the authoritative set in `convex/lib/lifecycle.ts:1-4`: `"passed"` **is not a valid `reviewStatus`** at all (`convex/validators.ts:7-14`) so it is dead, while `"checks_passed"` and `"delivered"` are **missing**. Consequence: for a review that passed its checks, or whose autofix was delivered as a stacked PR, `cancellationScope.terminal` is `false`; `dashboardReviews.cancel` (`:88`) therefore skips the `already_finished` branch, calls `reviewWorkflowManager.cancel` on a completed workflow, and returns `{status:"cancelled"}` — **a false success shown to the user** — then emits an `activation.decision / outcome:"cancelled"` telemetry event for a review that actually succeeded, corrupting the very outcome metrics the product markets as evidence-backed. The database is protected only because `durableReview.cancel:254` re-checks the correct `terminalStatuses`. **Fix:** delete the literal array and import `terminalStatuses` from `convex/lib/lifecycle.ts` — the single source of truth. Add a `satisfies readonly ReviewStatus[]` so an invalid literal like `"passed"` becomes a compile error.

### DEF-021 — Workflow retry configuration is dead; every transient failure is terminal · Confirmed defect

**Fix status:** Fixed — retryActionsByDefault: true, safe because every stage reserves and completes idempotently behind a generation fence.
`convex/workflowManager.ts:8-9` sets `retryActionsByDefault: false` alongside `defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 1_000, base: 2 }`, and no `step.runAction` call anywhere passes `retry: true` (grep verified). The backoff config is inert and reads as if retries are configured when none occur. A transient broker 503, GitHub 5xx, or provider rate-limit fails the whole review straight to `platform_failed`. **Fix:** either set `retryActionsByDefault: true` (idempotency is already enforced per stage via `reserve`/`complete` pairs and `assertActive` fences, so this is safe), or opt in per step for the network-bound stages, or delete the misleading `defaultRetryBehavior`. Add jitter.

### DEF-022 — No timeout on any model provider `generate()` call · Confirmed defect

**Fix status:** Fixed — AbortSignal.timeout on all three generate paths, and a timeout is retried as provider_unavailable.
`packages/providers/src/index.ts` sets `AbortSignal.timeout(8_000)` only on `validateKey` (`:68`). All three `generate` paths (Anthropic `:101`, OpenAI `:111`, Gemini `:121`) issue `fetch` with no signal. A hung provider socket is bounded only by the broker's Vercel `maxDuration: 60`. **Fix:** thread an `AbortSignal.timeout()` into every provider request (60–90 s), and map the abort to the existing `provider_unavailable` code so `generateWithRetry` can act on it.

### DEF-023 — No GitHub rate-limit handling anywhere · Confirmed defect

**Fix status:** Fixed — a shared requester honouring Retry-After and x-ratelimit-reset, with a timeout, wrapping all six clients.
`packages/github` contains no handling of HTTP 429, `Retry-After`, `x-ratelimit-*`, or GitHub secondary rate limits. A 429 falls into the generic `!response.ok` branch and becomes an immediate hard failure (`github_blob_429` etc.). `packages/github/src/repository-content.ts:79-89` issues up to 10,000 blob GETs in batches of 8 per review, which is exactly the pattern that triggers secondary limits. Additionally, **only `GitHubAppClient` sets a request timeout** — `RepositoryContentClient`, `PullRequestContextClient`, `GitHubIssueContextClient`, `GitHubRepositoryWriter`, `LinearContextClient` and `JiraContextClient` all call `fetch` with no `AbortSignal`. **Fix:** add a shared request wrapper that honours `Retry-After` and `x-ratelimit-reset` with bounded exponential backoff plus jitter, and give every client the same default timeout the app client uses.

### DEF-009 — CSP allows `'unsafe-inline'` scripts; the test that guards it does not check for it · Confirmed defect

**Fix status:** Fixed — script-src is `'nonce-<per-request>' 'strict-dynamic'` with no `'unsafe-inline'`, no `'unsafe-eval'` and no host fallback. The first attempt failed because Next stamps the nonce only on per-request renders and the pages were statically prerendered, so there was no request and no nonce; the root layout is force-dynamic for that reason. Proven by an E2E case that asserts the policy and then requires the page to hydrate with zero CSP violations.
`apps/web/next.config.ts:9` sets `script-src 'self' 'unsafe-inline'` with no nonce or hash strategy, which removes most of the CSP's XSS value. `apps/web/src/app/security-headers.test.ts:12` asserts only `not.toContain("unsafe-eval")` and never inspects `default-src` or `script-src`, so the test's claim of a "fail-closed browser policy" is not backed by its assertions. **Fix:** adopt a per-request nonce (Next.js middleware + `nonce` on the CSP and script tags) or hashes, drop `'unsafe-inline'` from `script-src`, and extend the test to assert `script-src` exactly.

### DEF-010 — No `Strict-Transport-Security` header · Confirmed defect

**Fix status:** Fixed — Strict-Transport-Security, two years, includeSubDomains, preload.
Verified absent on a live response (COMMAND_LOG #19). `upgrade-insecure-requests` in the CSP is not a substitute — it does not protect the first navigation. **Fix:** add `{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }` to `securityHeaders` in `apps/web/next.config.ts:19`. Also set `poweredByHeader: false` (see DEF-030).

### DEF-004 — `/notifications` is missing from the protected-route allowlist · Confirmed defect

**Fix status:** Fixed — one workspaceSections list, shared by the gate and the route table.
`apps/web/src/app/workspace-route-boundary.tsx:14-16` lists the gated paths but omits `"/notifications"`, although the route is in `validSections` (`apps/web/src/app/[section]/page.tsx:6`) and in the settings nav (`app-shell.tsx:23`). Reproduced: `/notifications` renders the full workspace page shell to an anonymous visitor instead of the sign-in gate, and the `?tour=1` sample-tour treatment never applies. No data leaks today because `NotificationPreferences` self-gates — but that is the fallback, not the control. **Fix:** add `"/notifications"` to the array. Better: derive the list from the same `validSections` constant so the two can never drift.

### DEF-007 — The sample tour issues live unauthenticated mutations to production · Confirmed defect

**Fix status:** Fixed — every tour-reachable mutation returns before the call, and says nothing was changed.
Reproduced: with `?tour=1&fixture=connected`, clicking "Pause" fires a real `repositoryConnections:setReviewPolicy` mutation over the network to the configured Convex deployment (console: `ArgumentValidationError … Value: "fixture-organization"`). This contradicts the product's own on-screen promise — "Sample tour · no live workspace data" and "BuildIT will not request live workspace data before authentication". It also gives any anonymous visitor an unauthenticated write-attempt amplifier against the backend. **Fix:** in `RepositoryPolicyRow`'s save handler (`apps/web/src/app/live-connections.tsx:139`), short-circuit when `useSampleTour()` is true and render a local "sample only" result instead of calling the mutation. Same for the members and notifications controls.

### DEF-008 — Misleading recovery message on a validation failure · Confirmed defect

**Fix status:** Fixed — policyFailureMessage classifies before advising.
The failure in DEF-007 surfaces as "The policy change was refused. Refresh your GitHub identity and active workspace, then try again." The real cause was argument validation on a malformed id. The guidance is wrong and, in the tour, unactionable. **Fix:** map `ArgumentValidationError`/unrecognised server errors to a distinct generic message and reserve the identity-refresh copy for `recent_reauthentication_required` / `not_found_or_forbidden`, which is exactly the pattern `model-key-state.ts:10-24` already gets right.

### DEF-024 — `ConvexCredentialGateway` implements its interface with three throwing stubs · Confirmed defect

**Fix status:** Fixed — the interface says what the Convex gateway can do; the throwing stubs are gone.
`packages/broker/src/convex-gateway.ts:71-73` — `get()`, `markUsed()` and `revoke()` all `throw new Error("credential_read_not_configured" | "credential_use_not_configured" | "credential_revoke_not_configured")`. `CredentialBroker.withCredential()` and `.revoke()` are therefore non-functional against the real gateway; `/api/model` works around it by constructing a throwaway in-memory store from the request body. I verified the live paths do not depend on these (Convex updates `lastUsedAt` directly at `convex/reviewModelData.ts:95` and `reviewAutofixData.ts:42`, and the web app revokes via Convex), so **there is no current functional break** — but a declared interface satisfied by throwing stubs is a trap for the next caller. **Fix:** either implement the three methods against Convex, or split the interface so the gateway only declares `insert`/`insertTracker`/`authorize` and the broker's read paths take a different type.

### DEF-025 — Tracker-credential broker route bypasses telemetry, with a deferred-work comment in production · Confirmed defect

**Fix status:** Fixed — both routes wrapped in observedBrokerRoute; the deferred-work comment removed.
`packages/broker/api/tracker-credentials.ts:27-32` exports `POST` and `OPTIONS` **unwrapped**, imports `observedBrokerRoute` without using it, places its imports after the exports, and carries the comment *"The compact handler above remains the sole implementation; wrap exports in the next formatting pass."* `api/tracker.ts` has the same gap. Both routes are invisible to broker metrics and tracing. The unused import is exactly what a linter would have caught (DEF-001). **Fix:** wrap both exports in `observedBrokerRoute` as every other broker route does, and move the imports to the top.

### DEF-026 — The release-claim gate fails when the product becomes ready · Confirmed defect

**Fix status:** Fixed — the gate is conditional on a blocker being open, as its own description says.
`tests/architecture/release-claim.test.ts:12` asserts `expect(open.length).toBeGreaterThan(0)` over `docs/validation/release-blockers.json`. Closing every release blocker turns the suite **red**. The test's stated intent — "cannot call the product ready while a canonical blocker is open" — is a conditional, but it is written as an unconditional requirement that blockers remain open. **Fix:** make it conditional: `if (open.length) { expect(register.verdictWhileOpen).toBe("not_ready"); expect(report).toContain("not ready"); }` and keep the duplicate-id assertion unconditional.

### DEF-018 — Two E2E tests can never run in CI · Confirmed test gap

**Fix status:** Fixed — the identity-only claim asserted from the app's own configuration and markup, in CI.
`tests/e2e/product.spec.ts:69` and `:109` call `test.skip(!process.env.BUILDIT_E2E_BASE_URL, …)`, and `.github/workflows/ci.yml` sets only `NEXT_PUBLIC_CONVEX_URL`. These are the **only** tests asserting that the GitHub OAuth authorize URL omits `repo`/`public_repo`/`write:org` and that the install link resolves to the registered App — i.e. the identity-only claim repeated across `/data-handling`, `/sign-in` and both launch guides is verified by nothing that executes. **Fix:** run them against the local server (they are assertions about the app's own markup, not the deployment) or add a scheduled CI job that sets `BUILDIT_E2E_BASE_URL`.

### DEF-019 — Connected-state UI and its screenshots come from a hardcoded client fixture · Risk/observation

**Fix status:** Fixed — the fixture stays as a design harness, with the gate pinned by a test and the screenshots renamed to say they prove layout, not live data. `convex/connectedJourney.test.ts` is the missing evidence: a signed-in identity against a seeded workspace driving `repositoryConnections:current` through every state the UI branches on, asserting no fixture value can appear in a real answer.
`apps/web/src/app/live-connections.tsx:27-36,43-47` ships a `connectedDesignFixture` ("Northstar workspace", 3 repositories) into the client bundle, gated on `NEXT_PUBLIC_BUILDIT_E2E === "1"` + `?tour=1&fixture=connected`. The accessibility and product E2E "connected" journeys, and the committed release screenshots `repositories-connected-{desktop,mobile}.png`, are all rendered from it. Those artefacts prove layout only — they never exercise `repositoryConnections:current`. **Fix:** keep the fixture (it is a reasonable design harness) but stop treating fixture-rendered screenshots as connected-state evidence; add one authenticated seeded-backend journey.

---

## Low

### DEF-005 — Unknown `/[section]` returns HTTP 200 · Confirmed defect

**Fix status:** Fixed — notFound() instead of a 200 whose body says otherwise.
`apps/web/src/app/[section]/page.tsx:10` renders an inline "Page not found" block instead of calling `notFound()`. Reproduced: `GET /nonexistent-section` → **200**. Hurts SEO, monitoring and client error handling. **Fix:** `import { notFound } from "next/navigation"` and call it; add `apps/web/src/app/not-found.tsx`.

### DEF-006 — Unknown `/setup/[step]` silently renders step 1 · Confirmed defect

**Fix status:** Fixed — unknown /setup/[step] is a 404, not a silent step 1.
`apps/web/src/app/setup/[step]/page.tsx:11` — `Math.max(0, steps.findIndex(...))` maps any unknown step to index `0`. Reproduced: `GET /setup/999` → **200**, "Choose repository access", stepper showing "Step 1 of 4" while the URL says `999`. **Fix:** `const index = steps.findIndex(i => i.id === step); if (index < 0) notFound();`.

### DEF-011 — `safeSignInReturnPath` returns a protocol-relative path for `/..//evil.com` · Confirmed defect

**Fix status:** Fixed — the resolved path is validated, not the requested string.
Fuzzed with 14 hostile inputs (COMMAND_LOG #22). 13 are neutralized; `"/..//evil.com"` passes the `startsWith("/")` and `!startsWith("//")` guards, and `new URL()` normalizes it to pathname `//evil.com`, which the function returns. Used as an `href` or `location.assign` that is an open redirect. **Currently not exploitable**: the only consumer passes it to `signIn("github", {redirectTo})`, and the server-side callback `convex/auth.ts:15` re-applies the `//` check and throws `invalid_redirect` (so the user sees a failed sign-in rather than a redirect). But `model-key-state.ts:49` is a general-purpose "safe path" helper and any future consumer inherits the hole. **Fix:** validate the *output*, not just the input:
```ts
const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
return resolved.origin === "https://buildit.invalid" && path.startsWith("/") && !path.startsWith("//") ? path : "/";
```
Add the `/..//evil.com` case to `model-key-state.test.ts`.

### DEF-012 — No skip link on any route · Confirmed defect (WCAG 2.4.1)

**Fix status:** Fixed — skip link in layout.tsx, id="main" on the shell.
Verified absent across 20 routes × 5 viewports. The sidebar/top nav is ~14 links a keyboard or screen-reader user must traverse on every page. **Fix:** add a visually-hidden-until-focused `<a class="skip-link" href="#main">Skip to content</a>` as the first child of `<body>` in `layout.tsx` and give `AppShell`'s `<main>` `id="main"`.

### DEF-013 — Nested `<main>` landmarks · Confirmed defect

**Fix status:** Fixed — one main landmark.
`app-shell.tsx:51` renders `<main className="main">` and both `setup/[step]/page.tsx:11` and `reviews/[id]/page.tsx:27` render a second `<main>` inside it. Reproduced on 4 routes. **Fix:** change the inner elements to `<div>` or `<section>`.

### DEF-016 — Interactive targets below 24 px · Confirmed defect (WCAG 2.2 AA 2.5.8)

**Fix status:** Fixed — .text-link and .account-link carry min-height 24px.
Text links measured 15–22 px tall on every viewport, e.g. "Trust boundary" (81×15), "Compare model setup →" (144×17), "Review queue" breadcrumb (81×17), "← Leave setup…" (196×17). The repo already enforces 44 px on repository-row controls (`flows.css:18`), so the standard exists but is not applied to inline links. **Fix:** give inline text links `display:inline-block; padding-block:6px` or a `min-height:24px` so the target box meets 2.5.8. Note axe does not check 2.5.8, which is why F-41 passes while this fails.

### DEF-027 — Every I/O boundary is a hand-written double · Test gap

**Fix status:** Fixed — the encryption claim asserts what AES-256-GCM gives, not the absence of a substring.
There are no contract tests and no recorded live fixtures anywhere. S3, KMS, the Vercel Sandbox, GitHub, Convex HTTP and all three model providers are faked in-process. Concretely: `packages/broker/test/credential-broker.test.ts:32` asserts `not.toContain("a-secret-provider-key")`, which passes for base64 or ROT13 and does not prove encryption; `packages/runner/test/vercelSandbox.test.ts` asserts `deny-all` against a double that cannot enforce it; `packages/security/test/security.test.ts:53` asserts `kms_context_mismatch` thrown by the test's own fake. The one exception is `packages/evaluations/test/executableFixtures.test.ts`, which runs real toolchains. **Fix:** add vendor schema/contract tests for the three provider wire formats, and gate `smoke:sandbox` + `smoke:aws-boundary` into a scheduled CI job so the real boundaries are exercised somewhere.

### DEF-028 — Reconciliation code exists but nothing schedules it · Probable defect

**Fix status:** Fixed — reconcileWorker.sweep on a ten-minute cron, measuring staleness with _creationTime because the workflow clock is synthetic.
`convex/crons.ts` declares only artifact cleanup (15 min) and a telemetry snapshot (5 min). `durableReview.reconcileStuck`, `reviewState.expireBlocked` and `artifactCleanupData.retryTerminal` are implemented and exported but have no caller and no cron. A review stuck mid-stage, a `blocked` review past its TTL, and an artifact quarantined after 10 delete failures all stay that way indefinitely. Compounding: `durableReview.checkpoint:112` writes a **synthetic clock** (`args.startedAt + index + 1`), so the `updatedAt` value `reconcileStuck` would compare against is not real time. **Fix:** add crons for the two reconcilers, and pass a real `Date.now()` into `checkpoint`.

### DEF-029 — Prompt-injection signals are computed once for the whole payload · Risk/observation

**Fix status:** Fixed — the base64 scan is bounded by candidate count and decoded bytes.
`packages/orchestrator/src/promptChain.ts:71` computes injection signals over the entire untrusted object and then applies the policy to every stage. One base64 blob or one `system:` line anywhere in a large repository snapshot degrades the whole review to `uncertain` — a denial-of-review vector an attacker can trigger by committing a data URI. The base64 scan also decodes every ≥24-char base64-looking run, which is CPU-heavy on minified files. **Fix:** scope signals to the specific untrusted field each stage consumes, cap the base64 scan by count and total bytes, and treat "injection detected in an unrelated file" differently from "injection detected in the diff under review."

### DEF-030 — `X-Powered-By: Next.js` is emitted · Low

**Fix status:** Fixed — poweredByHeader: false.
Verified on a live response. **Fix:** `poweredByHeader: false` in `apps/web/next.config.ts`.

### DEF-014 — Toolchain drift between the host, the pin and CI · Documentation gap

**Fix status:** Fixed — engines plus engine-strict=true.
`package.json` pins `pnpm@10.15.0`; the host had pnpm 9.15.4 and `corepack` was absent. CI runs Node 22/24; the host runs Node 26.8.1. The audit ran green on Node 26 with pnpm 10.15.0, so nothing is broken — but the README's "Requirements: Node.js 22 or 24 and pnpm 10.15.0" is not enforced anywhere. **Fix:** add `"engines": { "node": ">=22 <25", "pnpm": "10.15.0" }` to the root `package.json` plus `engine-strict=true` in `.npmrc`, so a wrong toolchain fails loudly instead of silently.

### DEF-031 — Convex is typechecked more loosely than the rest of the repo · Confirmed defect

**Fix status:** Fixed — convex/tsconfig.json extends the base and gains noUncheckedIndexedAccess. exactOptionalPropertyTypes stays off with the reason recorded in the file.
`convex/tsconfig.json` does **not** extend `tsconfig.base.json` and omits both `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, which `tsconfig.base.json` and `apps/web/tsconfig.json` enable. The most security-sensitive code in the product has the weakest type checking. **Fix:** extend the base config, keeping only the Convex-required overrides.

### DEF-032 — `webhookDeliveries.signatureValid` is hardcoded `true` · Confirmed defect

**Fix status:** Fixed — signatureValid is recorded from the caller rather than asserted.
`convex/githubWebhookData.ts:38` always writes `signatureValid: true`. Verification does happen (`convex/http.ts:10`) — requests failing it are rejected with 401 before `reserve` is called — so the field can never legitimately be `false` and records nothing. An audit column that cannot express the negative case is not evidence. **Fix:** either pass the real verification result through and record rejected deliveries, or drop the field from the schema and stop implying it is evidence.

### DEF-033 — Assertion-free and self-referential tests · Test gap

**Fix status:** Fixed — expire() is observable and asserted; the contrast test reads globals.css, verified by breaking a token.
A representative sample, all verified: `packages/core/test/store.test.ts:3` asserts only `not.toThrow()` (an empty `expire()` body passes); `packages/orchestrator/test/promptChain.test.ts:6` asserts `system` contains `fixedSystemPolicy` where both come from the module under test (passes for any policy text, including `""`); `packages/orchestrator/test/patchPolicy.test.ts:4` verifies a hash produced by the same module that checks it (a broken hash agrees with itself); `tests/architecture/interface-accessibility.test.ts:11` computes real contrast ratios over **hex literals written in the test**, never reading the CSS it loads. Separately, ~17 of 21 `tests/architecture` files are source-text greps — `autofix-cancellation-boundary.test.ts:6-17` asserts `"await assertActive(ctx, args);"` appears within 300 characters of a call site, which a reformat breaks and a commented-out fence passes. **Fix:** treat these as documentation, not gates; where real behavioural coverage already exists (`tenantIsolation.test.ts` covers the cancellation fences properly), delete the grep proxy rather than maintaining both.

### DEF-053 — `requireOrganizationRole` never checks `organizations.deletedAt` · Risk/observation

**Fix status:** Fixed — the deletedAt check lives in requireOrganizationRole.
`convex/lib/authz.ts:27`. Five call sites re-check it independently (`usage.ts:10`, `organizations.ts:16,35`, `repositoryConnections.ts:16`, `permissionReceipts.ts:18`); `memberships:*`, `integrations:*`, `audit:list`, `reviews:*` and `metrics:summarize` do not. Not exploitable today — no public function sets `deletedAt` — but the invariant belongs in the shared helper, not in five of eleven callers.

### DEF-054 — `github.revoke()` does not revoke · Confirmed defect

**Fix status:** Fixed — revoke calls DELETE /installation/token; the cache-only path is named forget.
`packages/github/src/index.ts:56` — `revoke(scope)` only evicts an in-memory `Map` entry. Five workers call it in a `finally` (`reviewContextWorker.ts:81`, `reviewPublicationWorker.ts:55`, `reviewAutofixWorker.ts:708,997,1128`) with the evident intent of dropping repository write access after use; the installation token stays valid on GitHub for up to an hour. **Fix:** call `DELETE /installation/token`, or rename the method so it stops implying a security property it does not provide.

### DEF-055 — `admin` can downgrade an owner-issued pending invite · Confirmed defect

**Fix status:** Fixed — the role already on the invite is checked, not only the requested one.
`convex/memberships.ts:47,67` — `invite`/`inviteByGitHubLogin` check only the *target* role, never `existing.role`. An admin can downgrade a pending `admin` invite issued by an owner to `developer`, a role they otherwise cannot manage (`:12`). No upward path exists (`:37` rejects `owner`, `:41` caps admins). **Fix:** `if (existing) await assertCanManage(actor.role, existing.role);` before the patch.

### DEF-056 — Unanchored digest-pin regex · Low

**Fix status:** Fixed — the digest-pin expression is anchored at both ends.
`packages/runner/src/vercelSandbox.ts:49` and `packages/broker/src/execution-http.ts:10` use `/@sha256:[0-9a-f]{64}$/`, unanchored at the start, so `attacker.registry.test/evil@sha256:…` reads as digest-pinned. Unreachable today (the value is env-sourced and `execution-http.ts:67` requires the request value to equal it). **Fix:** anchor the expression and pin the registry host.

### DEF-057 — `kmsKeyId` is unvalidated end to end · Low

**Fix status:** Fixed — the deployment's own key is a required parameter on every decrypt path.
`convex/schema.ts:74` types it `v.string()` with no format check, and it flows to `kms.decryptDataKey({ keyId })` via `packages/broker/src/index.ts:105`. An org admin can make the broker's IAM role attempt KMS `Decrypt` against an arbitrary key ARN. Contained by IAM, but it is an unvalidated confused-deputy input. **Fix:** allowlist against the deployment's own `AWS_KMS_KEY_ID`.

### DEF-058 — `.vercelignore` replaces `.gitignore` for deployment uploads and does not exclude `.env*` · Confirmed defect

**Fix status:** Fixed — .env* excluded, .env.example kept.
When `.vercelignore` is present it **replaces** `.gitignore` for what gets uploaded. The current file does not exclude `.env*`, so a local `.env.local` (which exists on this machine at mode `0644` and holds a `VERCEL_OIDC_TOKEN`) is not excluded by that mechanism. **Fix:** add `.env*` and `!.env.example` to `.vercelignore`; `chmod 600 .env.local`.

### DEF-059 — Auto-instrumentation bypasses the telemetry attribute allowlist · Risk/observation

**Fix status:** Fixed — a span processor reduces auto-instrumented URLs to their origin.
`apps/web/src/instrumentation.ts:6` and `packages/broker/src/instrumentation.ts:10` call `registerOTel`, whose default fetch instrumentation emits `http.url`/`url.full` outside `safeAttributes`'s allowlist (`packages/telemetry/src/index.ts:36-46`). Bounded: GitHub calls use numeric-ID routes, so no `owner/name` appears; worst case is opaque S3 artifact keys. **Fix:** disable fetch URL attributes or add a span processor that scrubs them.


---

## Blockers (could not be assessed)

| ID | Scope | Reason |
|----|-------|--------|
| BLOCK-01 | AWS/KMS/S3 boundary (`smoke:aws-boundary`), sandbox execution (`smoke:sandbox`) | Read-only, but target **production** infrastructure and need AWS/Vercel credentials. Not run, per the no-production-contact constraint. |
| BLOCK-02 | Two-real-user production tenant isolation (`test:e2e:tenant-isolation`) | The config hard-fails without an HTTPS production target and two real logged-in storage states. |
| BLOCK-03 | Every authenticated journey: model-key save, review start/consent/cancel, autofix, members, notifications, audit, usage, metrics | Requires a GitHub account, a GitHub App installation, an org, and a paid model key. No test accounts were provided and creating them would mean authenticating against production. |
| BLOCK-04 | Live model-provider behaviour (timeouts, rate limits, malformed output, streaming) | Requires real Anthropic/OpenAI/Gemini keys and would incur cost. |

## Observations (not defects)

| ID | Note |
|----|------|
| OBS-01 | A single horizontal-overflow hit at 1280 px on `/` during the route sweep did **not** reproduce in 12/12 targeted runs. Recorded as a transient (likely a font-loading race), not a defect. |
| OBS-02 | The repository is unusually clean on incompleteness markers: **zero** `TODO`/`FIXME`/`HACK`/`XXX`, zero `@ts-ignore`/`@ts-expect-error`, zero `as any` across all 14 workspaces and `convex/`. The only `eslint-disable` hits are Convex codegen headers. |
| OBS-03 | The project's own machine-checked registers are honest and pessimistic: `docs/validation/release-blockers.json` declares `verdictWhileOpen: "not_ready"` with 6 open blockers, and `docs/validation/capability-inventory.json` rates 0 of 17 capabilities fully implemented (8 partial, 5 deployment-blocked, 2 external-evidence-required, 2 local-only). Nothing in the repo overstates its readiness. |
| OBS-04 | Cryptography is genuinely sound: AES-256-GCM with mandatory structured AAD, 12-byte CSPRNG nonces, KMS envelope encryption with tenant encryption context, plaintext data keys zeroed in `finally`, and `timingSafeEqual` on every secret comparison. No weak primitive and no insecure randomness anywhere in a security path. |
| OBS-05 | A concurrent session branched to `fix/permission-receipt-layout` and committed `e9779aa` (permission-receipt layout + a11y attributes) during this audit. It does not affect any finding above. My audit commit `2dc5deb` is preserved on both `main` and that branch. |

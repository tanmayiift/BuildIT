# FEATURE_TEST_MATRIX

Independent audit, 2026-09-02. Statuses: PASS / FAIL / BLOCKED / NOT APPLICABLE / NOT TESTED.

**PASS means the scenario was actually exercised in this session and evidence exists.**
Anything I could only read in source is marked NOT TESTED with the reason.

Roles in the product: `owner` > `admin` > `developer` > `viewer` (`convex/validators.ts:3`),
plus `anonymous` and the GitHub `installation` (webhook) principal.

| ID | Area | Role | Scenario | Test type | Expected | Actual | Status | Evidence | Notes |
|----|------|------|----------|-----------|----------|--------|--------|----------|-------|
| F-01 | Build | — | `pnpm install --frozen-lockfile` on a clean checkout | Manual | Lockfile satisfied | Satisfied, 15 projects | PASS | COMMAND_LOG #5 | Ran on Node 26, outside the declared matrix |
| F-02 | Build | — | `pnpm build` production build | Manual | Clean | Clean, zero warnings, 9 routes | PASS | `evidence/build.log` | |
| F-03 | Quality | — | `pnpm typecheck` | Automated | Clean | Clean | PASS | `evidence/typecheck.log` | |
| F-04 | Quality | — | `pnpm lint` performs linting | Automated | Lint rules enforced | Runs `tsc --noEmit`; no linter exists | **FAIL** | DEF-001 | CI enforces a gate that checks nothing new |
| F-05 | Quality | — | `pnpm test` full unit/integration suite | Automated | All pass | 655/655 pass, 0 skipped | PASS | `evidence/vitest.log` | |
| F-06 | Quality | — | `pnpm test:e2e` browser suite | Automated | All pass | 112 pass, 4 skipped | PASS | `evidence/e2e.log` | 2 of the 4 skips can never run in CI — DEF-018 |
| F-07 | Quality | — | Dependency CVE audit (prod + all) | Automated | No high/critical | None found | PASS | `evidence/audit-*.log` | |
| F-08 | Quality | — | `security:release` gate | Automated | Pass | 249/249 | PASS | `evidence/security-release.log` | |
| F-09 | Quality | — | `reliability:release` gate | Automated | Pass | 150/150 | PASS | `evidence/reliability-release.log` | |
| F-10 | Quality | — | `eval` suite | Automated | Pass | 84/84 | PASS | `evidence/eval.log` | |
| F-11 | Landing `/` | anonymous | Page renders, CTAs present | Browser | Renders | Renders; both CTAs resolve | PASS | screenshot | |
| F-12 | Landing `/` | anonymous | No console errors | Browser | None | None | PASS | console read | |
| F-13 | Routing | anonymous | `/repositories` `/metrics` `/usage` `/integrations` `/policies` `/members` `/audit` `/account` `/reviews` gated | Browser | Sign-in gate | Gate shown for all 9 | PASS | browser | Gate is client-side only; Convex re-checks server-side |
| F-14 | Routing | anonymous | `/notifications` gated identically | Browser | Sign-in gate | **Renders the workspace page shell**; only the inner component self-gates | **FAIL** | DEF-004 | Missing from the guard allowlist |
| F-15 | Routing | anonymous | Unknown section returns 404 | HTTP | 404 | **200** with "Page not found" body | **FAIL** | DEF-005 | |
| F-16 | Routing | anonymous | Unknown setup step returns 404 | HTTP | 404 | **200** silently rendering step 1 | **FAIL** | DEF-006 | |
| F-17 | Routing | anonymous | `/reviews/<bad-id>` handled | HTTP+Browser | Graceful | Session-check gate, then sign-in | PASS | browser | |
| F-18 | Sample tour | anonymous | `?tour=1` renders sample data, no live queries | Browser | Sample only | Sample banner shown; live queries skipped | PASS | browser | |
| F-19 | Sample tour | anonymous | Connected fixture renders repository policy UI | Browser | Renders 3 repos | Renders; autofix mode matches fixture | PASS | screenshot | Fixture is hardcoded client-side — DEF-019 |
| F-20 | Repo policy | anonymous | Clicking "Pause" in the tour | Browser | No network call | **Live unauthenticated mutation to production Convex** | **FAIL** | DEF-007 | Server correctly rejected it |
| F-21 | Repo policy | anonymous | Error message after that rejection | Browser | Actionable + accurate | "Refresh your GitHub identity…" — wrong cause | **FAIL** | DEF-008 | |
| F-22 | Repo policy | server | Mutation with a forged organization id | Browser→API | Rejected | `ArgumentValidationError` on `v.id("organizations")` | PASS | console | Server-side validation confirmed |
| F-23 | Webhook | GitHub | HMAC-SHA256 verified on raw body before any state change | Code+HTTP | Verified first | Verified first; 401 before parse/reserve; constant-time compare | PASS | `convex/http.ts:9,32-39` | Implementation correct — but untested, DEF-017 |
| F-24 | Webhook | anonymous | `GET /api/github/webhooks` | HTTP | 405 | 405 | PASS | COMMAND_LOG #20 | |
| F-25 | Security headers | anonymous | CSP, XFO, nosniff, COOP, CORP, Permissions-Policy | HTTP | Present | All present | PASS | COMMAND_LOG #19 | |
| F-26 | Security headers | anonymous | `script-src` without `unsafe-inline` | HTTP | No unsafe-inline | **`'unsafe-inline'` present** | **FAIL** | DEF-009 | Test asserts only the absence of `unsafe-eval` |
| F-27 | Security headers | anonymous | HSTS present | HTTP | Present | **Absent** | **FAIL** | DEF-010 | |
| F-28 | Sign-in | anonymous | `returnTo` open-redirect resistance (14 hostile inputs) | Fuzz | All neutralized | 13/14 neutralized; `/..//evil.com` → `//evil.com` | **FAIL** | DEF-011 | Blocked downstream by `convex/auth.ts:15`; latent |
| F-29 | CLI | operator | `--help` / no args | Manual | Usage, exit 0 | Usage, exit 0 | PASS | COMMAND_LOG #25 | |
| F-30 | CLI | operator | Unknown command | Manual | Non-zero | Usage, exit 4 | PASS | COMMAND_LOG #25 | |
| F-31 | CLI | operator | `doctor` and `doctor --json` | Manual | Environment report, no secrets | Correct; no secret values emitted | PASS | COMMAND_LOG #25 | |
| F-32 | CLI | operator | Malformed `--pr` (`abc`, `-1`, `0`, `1e999`) | Manual | Rejected | All → `invalid_pull_request_number`, exit 4 | PASS | COMMAND_LOG #25 | |
| F-33 | CLI | operator | Malformed `--repo` incl. `../../etc/passwd` | Manual | Rejected | `github_repository_invalid`, exit 4 | PASS | COMMAND_LOG #25 | |
| F-34 | CLI | operator | Invalid `--provider` | Manual | Rejected | `provider_required`, exit 4 | PASS | COMMAND_LOG #25 | |
| F-35 | CLI | operator | Local review leaves the worktree untouched | Automated | Unchanged | `git status` byte-identical | PASS | `evidence/smoke-cli.log` | |
| F-36 | Responsive | anonymous | 20 routes × 5 viewports, horizontal overflow | Browser | None | None reproducible (0/12 on the one suspect) | PASS | COMMAND_LOG #23-24 | OBS-01 |
| F-37 | Responsive | anonymous | Mobile nav usable at 320–414 px | Browser | Usable | `<details>` menu works; no clipping | PASS | screenshot | |
| F-38 | A11y | anonymous | Skip link present | Browser | Present | **Absent on all 20 routes** | **FAIL** | DEF-012 | |
| F-39 | A11y | anonymous | Single `<main>` landmark | Browser | One | **Two** on `/setup/*` and `/reviews/[id]` | **FAIL** | DEF-013 | |
| F-40 | A11y | anonymous | Interactive targets ≥ 24 px (WCAG 2.2 AA 2.5.8) | Browser | ≥24 px | Several text links 15–22 px tall | **FAIL** | DEF-016 | |
| F-41 | A11y | anonymous | axe wcag2a/2aa/21a/21aa, serious+critical | Automated | Zero | Zero across 25 routes ×2 devices | PASS | `evidence/e2e.log` | axe does not cover 2.5.8 or skip links |
| F-42 | A11y | anonymous | Heading order, image alt text | Browser | Valid | No jumps, no missing alt | PASS | COMMAND_LOG #23 | |
| F-43 | Tenancy | cross-tenant | Cross-org id guessing on reviews/artifacts/usage/audit | Automated | Denied | 74 cases pass in-process | PASS | `convex/tenantIsolation.test.ts` | In-process only; production proof BLOCKED |
| F-44 | Tenancy | cross-tenant | Two real users against a deployed target | E2E | Isolated | Not run | **BLOCKED** | BLOCK-02 | Needs production + two real logins |
| F-45 | AuthZ | admin/owner | Recent-GitHub-login step-up on credential **write** | Code | Enforced | **Not enforced**, though declared in policy | **FAIL** | DEF-002 | Also bypasses revoke's step-up |
| F-46 | AuthZ | viewer/developer | Privilege escalation to admin actions | Code+Automated | Denied | Denied (`assertCanManage`, last-owner guard) | PASS | `convex/memberships.ts:10-19` | Not exercised live — no test accounts |
| F-47 | Data | — | Activation funnel query is tenant-indexed | Code | Indexed | **Unindexed full scan of `findings` across all tenants** | **FAIL** | DEF-003 | |
| F-48 | Data | — | Context gathering reads only its own tenant's tracker rows | Code | Own tenant | Collects **all tenants'** active rows, then filters in JS | **FAIL** | DEF-015 | Response correctly scoped; isolation depends on one JS filter |
| F-49 | Reviews | developer | Cancel a completed review | Code | `already_finished` | Reports `"cancelled"`; `checks_passed`/`delivered` missing from the terminal list | **FAIL** | DEF-020 | DB protected; UI + metrics wrong |
| F-50 | Reliability | — | Transient broker/GitHub/provider failure is retried | Code | Retried | `retryActionsByDefault:false` and no step opts in — retry config is dead | **FAIL** | DEF-021 | |
| F-51 | Providers | — | Model `generate()` bounded by a timeout | Code | Bounded | **No timeout on any provider `generate()`** | **FAIL** | DEF-022 | Only `validateKey` has one |
| F-52 | GitHub API | — | 429 / rate-limit handling | Code | Backoff + Retry-After | **None anywhere in `packages/github`** | **FAIL** | DEF-023 | Up to 10k blob GETs per review |
| F-53 | Broker | — | `ConvexCredentialGateway` implements its interface | Code | Implemented | `get`/`markUsed`/`revoke` all throw | **FAIL** | DEF-024 | Live paths route around it |
| F-54 | Broker | — | Tracker-credential route emits telemetry | Code | Wrapped | Exported unwrapped with a deferred-work comment | **FAIL** | DEF-025 | |
| F-55 | Release gate | — | `release-claim` test allows a ready release | Automated | Passes when ready | **Fails when all blockers close** (`toBeGreaterThan(0)`) | **FAIL** | DEF-026 | |
| F-56 | Model key form | admin | Submit an invalid/short key | Browser | Client + server rejection | Not exercised — form requires an authenticated org | **BLOCKED** | BLOCK-03 | Client rules read: `required`, `minLength=16` |
| F-57 | Review start | developer | Start review, consent panel, budget ceiling | Browser | Consent gate | Not exercised — requires auth + a connected repo | **BLOCKED** | BLOCK-03 | |
| F-58 | Autofix | developer | Bounded convergence, stacked PR, human merge | E2E | Bounded | Not exercised — requires GitHub App + sandbox + model key | **BLOCKED** | BLOCK-01/03 | Project marks this `deployment_blocked` |
| F-59 | Sandbox | — | Network deny-all, credential teardown, metadata blocked | E2E | Enforced | Not exercised — all tests use a hand-written double | **NOT TESTED** | DEF-027 | `smoke:sandbox` needs real Vercel creds |
| F-60 | AWS/KMS/S3 | — | Bucket private, SSE-KMS, no versioning | Smoke | Enforced | Not run — targets production | **BLOCKED** | BLOCK-01 | |
| F-61 | Email/SMS | — | Customer decision email delivery | — | — | Not implemented by design; UI reports "Not connected" | **NOT APPLICABLE** | `convex/notifications.ts:6` | Honest gap |
| F-62 | Payments | — | Payment flows | — | — | No payment provider in the repo | **NOT APPLICABLE** | — | |
| F-63 | Crons | — | Artifact retention + telemetry snapshot | Code | Scheduled | Two crons declared; no cron reconciles stuck reviews | PASS (declared) / NOT TESTED (behaviour) | `convex/crons.ts` | DEF-028 |
| F-64 | Prompt injection | — | Untrusted repo content downgrades authority | Automated | Downgraded | 7 attack classes covered; `patch` hard-blocks | PASS | `packages/orchestrator/test/promptChain.test.ts` | Whole-payload signal scope — DEF-029 |
| F-65 | Crypto | — | AES-256-GCM, CSPRNG nonces, timing-safe compares, KMS envelope | Code+Automated | Sound | Sound; no weak primitives found | PASS | `packages/security/**` | Real `node:crypto` in tests |
| F-66 | Secrets | — | No secrets in tracked files | Automated | None | 421 files clean; gitleaks in CI | PASS | `evidence/tracked-files.log` | |

# BuildIT — Independent Project Audit

**Date:** 2026-09-02 · **Commit at start:** `11f787a` (main, clean tree)
**Scope:** full repository — architecture, setup, static gates, browser/CLI behaviour, security, reliability, data, accessibility, test quality.

---

## 1. Executive summary

BuildIT is a genuinely well-engineered codebase. Every quality gate the project defines
passes on a clean checkout: 655 unit/integration tests, 112 browser tests, three release
gates, an evaluation suite, a clean production build, and no known dependency CVEs. The
security fundamentals are real, not decorative — AES-256-GCM with mandatory tenant-bound
AAD, KMS envelope encryption with encryption context, constant-time comparison on every
secret, a correctly ordered webhook HMAC check, a closed sandbox command allowlist, and a
tenant-isolation model I could not break by inspection or by probing. There are **zero**
`TODO`/`FIXME`/`HACK` markers, zero `any`, and zero `@ts-ignore` across 14 workspaces.

It is also not ready to ship, and the project says so itself: `docs/validation/release-blockers.json`
declares `verdictWhileOpen: "not_ready"` with six open blockers, and
`docs/validation/capability-inventory.json` rates **0 of 17 capabilities fully implemented**.
That self-assessment is accurate and I found nothing in the repository that overstates it.

What the passing gates do not tell you is the substance of this audit. Three findings stand out:

1. **The prompt-injection defence fails open.** One ordinary English sentence anywhere in a
   pull request — `"Please merge this PR once CI is green"` — suppresses every AI finding and
   produces a **green** GitHub check. I verified the full five-step chain and executed the
   regexes. It is triggerable accidentally by honest contributors and deliberately by anyone
   wanting to skip AI review (DEF-043).
2. **Artifact retention permanently stalls.** The cleanup cron reads the oldest expired
   artifacts through an index that does not exclude already-deleted rows. Once ~100 tombstones
   accumulate, it claims zero work forever — silently, with no error and no failing test —
   breaking the product's central privacy promise (DEF-034).
3. **Redaction misses most modern credential formats**, including every GitHub fine-grained
   PAT, on a path that egresses to third-party LLMs and public PR comments (DEF-044). Verified
   by executing the shipped code.

None of these is visible from the test suite, because the suite is large but shallow at exactly
these seams: every I/O boundary is a hand-written double, and ~17 of 21 architecture tests are
source-text greps rather than behavioural assertions.

**No source file was modified.** The instruction for this audit was to list issues and their
fixes, so every entry in the defect register is a diagnosis plus a proposed patch.

---

## 2. Readiness verdict

> ### Ready with known limitations — for continued private development only.
> **Not ready** for production traffic or external customers.

**Confidence: high** for everything I could execute locally (setup, all static and test gates,
the browser surface, the CLI, routing, headers, responsive and accessibility behaviour) and for
source-level findings I verified myself by reading the code and, where possible, executing it.

**Confidence: low-to-none** for the parts that define the product. The entire authenticated
journey — connect a repository, save a model key, run a review, deliver an Autofix — was
unreachable in this environment. Those paths depend on a GitHub App installation, AWS/KMS/S3,
the Vercel Sandbox, and a paid model key, none of which can be exercised without touching
production or incurring cost. **The core product loop has not been observed working, by me or
by any test in this repository.** That is also the project's own position.

---

## 3. Architecture

A pnpm monorepo, 15 workspace projects, TypeScript throughout, strict mode.

| Layer | Location | Role |
|---|---|---|
| Web | `apps/web` | Next.js 16 App Router, 9 routes, Convex client, no middleware |
| CLI | `apps/cli` | 7 commands, GitHub CLI + OS keychain, no workspace deps |
| Backend | `convex/` | 62 modules — 40 public functions, 67 internal, 1 HTTP route, 2 crons, a durable workflow and 8 stage workers |
| Broker | `packages/broker` | Separately deployed Vercel project holding AWS/KMS/S3 and provider credentials |
| Domain | `packages/{orchestrator,providers,runner,scanners,github,security,contracts,operations,telemetry,evaluations,core}` | Review pipeline, model clients, sandbox, scanners, GitHub App, crypto |

The trust separation is the strongest architectural idea here: Convex holds tenant metadata and
never source; the broker holds cloud credentials and touches encrypted artifacts; the sandbox
holds neither and runs `deny-all` with a closed command allowlist. `dataClassification.ts` plus
a build-failing test keep raw source out of the database by construction.

**Roles:** `owner` > `admin` > `developer` > `viewer`, plus anonymous and the GitHub webhook
principal. Enforced centrally in `convex/lib/authz.ts` with an indexed membership lookup that
requires `status === "active"`.

**Not evaluated:** AWS infrastructure (`infra/aws`), the Grafana/OTel stack (`observability/`),
and `packages/core` — which is dead code that nothing imports, yet is named as the entrypoint
for the `trusted-policy` capability in `capability-inventory.json`.

---

## 4. Setup and reproducibility

Setup works exactly as documented, with one caveat. `pnpm install --frozen-lockfile` reported
the lockfile up to date; `pnpm verify` and `pnpm test:e2e` both pass from clean.

The caveat is that nothing enforces the documented toolchain. The README requires Node 22/24
and pnpm 10.15.0; this host had Node 26.8.1 and pnpm 9.15.4, and `corepack` was absent. Both
gates ran green anyway once I installed pnpm 10.15.0 into a scratch directory — but there is no
`engines` field and no `engine-strict`, so a contributor on the wrong toolchain gets no warning
(DEF-014).

---

## 5. Results

### Automated gates — all pass

| Gate | Result |
|---|---|
| `security:tracked-files` | pass (421 files) |
| `lint` | pass — **but it is `tsc --noEmit`; no linter exists** (DEF-001) |
| `typecheck` (+ Convex) | pass |
| `test` | **655/655**, 103 files, 0 skipped |
| `build` | pass, zero warnings |
| `pnpm audit` (prod + all) | no known vulnerabilities |
| `test:e2e` | **112 passed**, 4 skipped |
| `security:release` | 249/249 |
| `reliability:release` | 150/150 |
| `eval` | 84/84 |
| `smoke:cli` | pass, worktree unchanged |

Not run: `smoke:aws-boundary` and `test:e2e:tenant-isolation` (both target production —
BLOCK-01, BLOCK-02).

### Manual and browser testing

66 scenarios recorded in `FEATURE_TEST_MATRIX.md`: **38 PASS, 18 FAIL, 6 BLOCKED, 2 N/A,
2 NOT TESTED.** Twenty routes across five viewports, ten HTTP route probes, an open-redirect
fuzz, and ten CLI negative cases.

Highlights: nine of the ten protected routes correctly gate anonymous access, and server-side
Convex validation rejected a forged organization id when I drove a mutation from the browser.
`/notifications` is missing from the guard allowlist (DEF-004). Two routes return HTTP 200
where they should 404 (DEF-005, DEF-006). Mobile layout is clean with no horizontal overflow.

The CLI is the most solid surface in the product: every malformed input I threw at it —
`--pr abc`, `--pr -1`, `--pr 1e999`, `--repo ../../etc/passwd`, `--provider hackerman` — was
rejected with a stable error code and exit 4.

### Accessibility

axe reports zero serious/critical violations across 25 routes on two devices. Manual testing
found three things axe does not check: **no skip link on any route** (DEF-012), **nested
`<main>` landmarks** on four routes (DEF-013), and **interactive targets below 24 px**,
failing WCAG 2.2 AA 2.5.8 (DEF-016). The repo already enforces 44 px on repository-row
controls, so the standard exists but was not applied to inline links.

### Security

No unauthenticated data exposure, no cross-tenant leak, no IDOR, no self-escalation, no secret
in a tracked file, and no shell invocation anywhere in product code. Beyond the three headline
findings: a step-up re-authentication control declared in policy but not implemented
(DEF-002/DEF-046 area), an authenticated SSRF on the Jira credential write path (DEF-045), a
revoked member who can reinstate themselves as owner (DEF-046), CSP with `'unsafe-inline'`
(DEF-009), no HSTS (DEF-010), and a third-party GitHub Action on a floating tag (DEF-048).

One structural note: `tests/architecture/public-function-inventory.test.ts` verifies that every
public function *has* a policy entry, but never that a handler labelled `..._recent_auth`
actually calls `requireRecentGitHubLogin`. That is precisely how DEF-002 stayed green in CI.

### Reliability and data

The generation-fence design (`expectedGeneration` + `assertActive` + `reserveSideEffect`) is
well built and blocks most cancellation side effects. The failures cluster elsewhere: **nothing
retries anything** (`retryActionsByDefault: false` with an inert backoff config, DEF-021),
**nothing reconciles a stuck review** (the reconcilers exist but no cron schedules them,
DEF-028), one completion mutation is unfenced and can resurrect a terminal review (DEF-035),
autofix cannot be retried at the same commit (DEF-036), the audit log freezes at 1000 events
(DEF-037), and several dashboard queries are unbounded or N+1 on live subscriptions (DEF-042).

### Test quality

655 passing tests is a real asset, and the crypto and evaluation suites are excellent — they use
real `node:crypto` and actually compile and run TypeScript, Python and Java fixtures. But the
suite is shallow at the seams that matter: every I/O boundary (S3, KMS, Vercel Sandbox, GitHub,
Convex HTTP, all three model providers) is a hand-written double, so no test can fail because a
real integration broke. ~17 of 21 architecture tests assert on source text rather than
behaviour. And the production webhook verifier has no test at all while a tested duplicate sits
unused (DEF-017).

---

## 6. Defects

**59 recorded.** Fixed: **0** — by instruction; every entry carries a proposed fix.

| Severity | Count | Headline |
|---|---|---|
| Critical | 1 | DEF-034 artifact retention permanently stalls |
| High | 12 | DEF-043 injection defence fails open · DEF-044 redaction gaps · DEF-003/DEF-015 cross-tenant full scans · DEF-035 terminal review resurrected · DEF-036 autofix unretryable · DEF-037 audit log freezes · DEF-038 cost silently lost · DEF-002 step-up not enforced · DEF-017 webhook verifier untested |
| Medium | 26 | no linter · dead retry config · no provider timeouts · no GitHub rate-limit handling · SSRF · owner reinstatement · CSP · route guard gap |
| Low | 20 | 200-instead-of-404 · latent open redirect · a11y · header hygiene · toolchain drift |

---

## 7. Known limitations and production risks

1. **The core loop is unproven.** No test in this repository, and nothing in this audit,
   exercises a real review against a real repository with a real model. Every integration is
   mocked. This is the dominant risk and the project's own blockers agree.
2. **Fail-open safety control.** DEF-043 means the AI layer can be silently disabled on a large
   fraction of real pull requests while reporting success.
3. **Retention is not proven to work.** DEF-034 stops deletion permanently; deletion is also
   asserted rather than confirmed (a bare S3 `DeleteObject` returns 204 for a key that never
   existed). Retention is a contractual claim in the UI.
4. **No retries and no reconciliation.** A single transient 5xx fails an entire review, and
   several paths leave reviews stuck forever with nothing scheduled to recover them.
5. **Scale ceilings.** Several queries will degrade and then hard-fail as tenant history grows,
   including two that scan across all tenants.
6. **A lint gate that lints nothing**, and architecture tests that assert on formatting rather
   than behaviour, both produce false assurance.

---

## 8. Recommended next actions, in priority order

1. **DEF-034** — one-line index swap to `by_pending_expiry`, plus confirm deletion with a
   `HeadObject` 404 and schedule the terminal-retry queue. Highest severity, smallest fix.
2. **DEF-043** — make a whole-review injection signal produce `inconclusive`, never
   `checks_passed`, and scope the downgrade to the signal's own path.
3. **DEF-044** — unify and broaden the two redaction pattern sets.
4. **DEF-003 / DEF-015** — add the two missing indexes; both tables already have a suitable one.
5. **DEF-035 / DEF-036 / DEF-037 / DEF-038** — fence `reviewArtifactData.complete`, add the
   `reviewId` slot to the autofix operation keys, reverse the audit-log ordering, store integer
   micro-dollars.
6. **DEF-021 / DEF-028** — enable retries on the idempotent stages; schedule the reconcilers.
7. **DEF-002 / DEF-045 / DEF-046 / DEF-048** — close the step-up gap, allowlist the Jira host,
   stop force-promoting revoked members, SHA-pin the actions.
8. **DEF-001** — add a real linter; several findings above are things a linter would have caught.
9. **DEF-017 / DEF-027 / DEF-033** — test the webhook verifier; add contract tests at the I/O
   boundaries; replace source-grep architecture tests where real coverage already exists.
10. **DEF-005/006/009/010/012/013/016** — the routing, header and accessibility fixes; each is
    a few lines.

---

## 9. Artifacts

| File | Contents |
|---|---|
| `audit/PROJECT_AUDIT_REPORT.md` | This report |
| `audit/FEATURE_TEST_MATRIX.md` | 66 scenarios with status and evidence |
| `audit/DEFECT_REGISTER.md` | 59 defects with repro, root cause, fix, and regression test |
| `audit/COMMAND_LOG.md` | Every material command, sanitized |
| `audit/AUDIT_PLAN.md` | The audit checklist |
| `audit/evidence/*.log` | Raw output of every gate |

No secret value appears in any artifact. No test database, screenshot, temporary credential, or
debug code was added to the repository.

**Concurrency note:** a separate session branched to `fix/permission-receipt-layout` and
committed `e9779aa` (permission-receipt layout and ARIA attributes) while this audit was
running. I reviewed it — it is UI-only and affects none of the findings above. My audit commit
`2dc5deb` is preserved on both `main` and that branch, and I did not modify, revert, or rebase
any of their work.

# COMMAND_LOG

Every material command run during the independent audit of 2026-09-02.
No secret values are recorded. Full outputs are under `audit/evidence/`.

Environment note: the host has **Node v26.8.1** and **pnpm 9.15.4** on `PATH`.
The project pins **pnpm 10.15.0** and CI runs **Node 22 / 24**. `corepack` is not
installed and a global `npm i -g pnpm` is blocked by the sandbox, so pnpm 10.15.0
was installed into the session scratchpad and prepended to `PATH` for every
command below. See DEF-014.

`$PNPM` below = `<scratchpad>/tools/node_modules/.bin` prepended to `PATH`.

| # | Command | Purpose | Exit | Sanitized result | Ref |
|---|---|---|---|---|---|
| 1 | `git status` / `git branch -a` | Confirm repo root and branch | 0 | Clean tree on `main`; 22 remote branches | — |
| 2 | `node -v` / `pnpm -v` | Toolchain conformance | 0 | Node v26.8.1, pnpm 9.15.4 — both outside the declared support matrix | DEF-014 |
| 3 | `npm i -g pnpm@10.15.0` | Install pinned pnpm | 1 | Blocked by OS sandbox; fell back to scratchpad install | — |
| 4 | `npm install --prefix <scratchpad>/tools pnpm@10.15.0` | Pinned pnpm | 0 | pnpm 10.15.0 available | — |
| 5 | `pnpm install --frozen-lockfile` | Dependency install | 0 | "Lockfile is up to date"; 15 workspace projects; +13 −25 packages reconciled | — |
| 6 | `pnpm security:tracked-files` | Tracked-file safety gate | 0 | "Tracked-file safety check passed (421 files inspected)" | `evidence/tracked-files.log` |
| 7 | `pnpm lint` | Lint gate | 0 | Passes — **but every package's `lint` is `tsc --noEmit`; no linter exists** | DEF-001 |
| 8 | `pnpm typecheck` | Type gate (incl. `typecheck:convex`) | 0 | All 14 workspaces + Convex clean | `evidence/typecheck.log` |
| 9 | `pnpm test` | Full vitest suite | 0 | **103 files, 655 tests, 655 passed, 0 skipped**, 7.05 s | `evidence/vitest.log` |
| 10 | `pnpm build` | Production build | 0 | All packages + Next.js build clean, zero warnings; 9 routes emitted | `evidence/build.log` |
| 11 | `pnpm audit --prod --audit-level high` | Prod dependency CVEs | 0 | "No known vulnerabilities found" | `evidence/audit-prod.log` |
| 12 | `pnpm audit` | All dependency CVEs | 0 | "No known vulnerabilities found" | `evidence/audit-all.log` |
| 13 | `pnpm test:e2e` | Playwright E2E (desktop + mobile) | 0 | **112 passed, 4 skipped** | `evidence/e2e.log` |
| 14 | `pnpm security:release` | Security release gate | 0 | 41 files, 249 tests passed | `evidence/security-release.log` |
| 15 | `pnpm reliability:release` | Reliability release gate | 0 | 15 files, 150 tests passed | `evidence/reliability-release.log` |
| 16 | `pnpm eval` | Evaluation suite | 0 | 8 files, 84 tests passed | `evidence/eval.log` |
| 17 | `pnpm smoke:cli` | CLI journey smoke | 0 | Passed; working tree byte-identical before/after | `evidence/smoke-cli.log` |
| 18 | `next start -p 3107` (E2E build) | Run the app locally | — | Served on `http://127.0.0.1:3107`; stopped at end of audit | — |
| 19 | `curl -sI http://127.0.0.1:3107/` | Security-header check | 0 | CSP/COOP/CORP/Permissions-Policy/XFO/nosniff present; **no HSTS**; `X-Powered-By` leaks framework | DEF-009, DEF-010 |
| 20 | `curl` over 10 routes | Route status probe | 0 | `/nonexistent-section` → **200** not 404; `/setup/999` → **200** rendering step 1 | DEF-005, DEF-006 |
| 21 | Browser: click "Pause" in sample tour | Exercise a control | — | Live **unauthenticated mutation** sent to the production Convex deployment; server rejected with `ArgumentValidationError`; UI showed a misleading recovery message | DEF-007, DEF-008 |
| 22 | `node redirect-probe.mjs` | Open-redirect fuzz of `safeSignInReturnPath` | 0 | 14 hostile inputs; `/..//evil.com` → returns `//evil.com` (protocol-relative) | DEF-011 |
| 23 | `node sweep.mjs` | 20 routes × 5 viewports responsive/a11y sweep | 0 | No reproducible horizontal overflow; systemic **no skip link**, sub-24px targets, nested `<main>` | DEF-012, DEF-013, DEF-016 |
| 24 | `node hscroll.mjs` / `flake.mjs` | Verify a suspected overflow | 0 | **0/12 reproductions** — recorded as transient, not a defect | OBS-01 |
| 25 | `node apps/cli/dist/index.js <10 negative cases>` | CLI negative-path testing | 4 | All malformed inputs rejected with stable codes; exit 4 | — |
| 26 | `pnpm smoke:aws-boundary` | AWS boundary proof | **not run** | Read-only, but targets the **production** CloudFormation stack and needs AWS credentials. Skipped per the no-production-contact constraint | BLOCK-01 |
| 27 | `pnpm test:e2e:tenant-isolation` | Two-real-user isolation | **not run** | Config hard-fails without an HTTPS production target and two real logged-in storage states | BLOCK-02 |

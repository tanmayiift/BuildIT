> Current result (2026-09-14 05:51 UTC): **45/45 actual Chrome browser cases passed** after host permissions were enabled and isolated test-harness configuration was corrected. The earlier zero-browser entries below are preserved historical attempts. Current proof and limits: `local-browser-cua-proof.json`, `local-browser-cua-matrix.md`, `local-browser-cua-snapshot.json`.

# Isolated BuildIT runtime evidence

This is a local-runtime audit using two simulated authenticated users. It is not production verification, a real GitHub sign-in, a paid model run, or proof that every browser control works.

## Runtime and boundaries

- Convex backend: official `get-convex/convex-backend` release `precompiled-2026-09-11-157eb19`, macOS ARM64.
- Node: official `v24.21.0` macOS ARM64 archive. SHA256 matched the vendor's versioned `SHASUMS256.txt`; see `local-browser-runtime.json`.
- Convex cloud `127.0.0.1:3218`, HTTP actions `127.0.0.1:3219`, Next production server `127.0.0.1:3107`. All services bind loopback.
- The backend and web run from ignored `.local/audit-project` copies. Source packages are linked from this BuildIT repository. `scripts/run-local-audit.mjs` refreshes copied source and adds a test-only seed module and sign-in route there. Neither helper is present in production source.
- A separate CLI environment file targets only the local self-hosted backend. Runtime child environments do not inherit production credentials. The copied cron list is empty, repository execution is disabled, and telemetry beacon/Next telemetry are disabled.
- Instance secret, local admin key, signing key, and simulated-user JWTs are saved under ignored `.local/audit-runtime`, mode 0600. A scan found no credential values in these evidence files. Do not share that runtime directory or browser traces without checking them.
- The local backend reports that action fetches have no outbound proxy. No action that calls GitHub, a model provider, or a sandbox has been invoked here. No end-to-end external integration result or complete outbound firewall claim is made. Actual spending in this harness: **$0**. Synthetic ledger settlement is data, not a provider payment.

## Passed evidence

- `local-browser-api-first-pass.json`: 22 checks against real Convex queries, mutations and authenticated WebSocket subscriptions. It demonstrates **$12.50 / $100 = 12.5%**, 42,000 model tokens including Ask, retained legacy-accounting uncertainty, and exact agreement between usage and enforcement snapshots.
- That pass inserts a metric after subscribing and observes the subscription update. It reserves an invocation, observes pending allowance, settles a synthetic $0.03 response, observes the updated spend, then proves a duplicate settlement does not add cost. Workspace A becomes $12.53; B stays $3.75.
- `local-browser-api-proof.json`: a repeated run on Node 24 passes **26 checks**, adding owner repository pause/resume/comment-level persistence and viewer permission denial. The refreshed snapshot repeats all 26 checks; the final fixture A moves from **$12.62 to $12.65** after one synthetic $0.03 settlement; B remains **$3.75**. The metric counter moves from six to seven after a synthetic event. These events prove query updates, not completed real reviews.
- Both owner and viewer use actual locally signed JWT validation and actual membership checks. Four cross-workspace queries and viewer writes to both own/other budgets are denied. These are two simulated identities, not independent customer accounts.
- The isolated Next production build passes. Targeted harness ESLint passes. Playwright successfully discovers **six authenticated scenarios**; discovery is not execution.
- HTTP checks now pass **36/36**: 24 valid routes (including the new tracker/first-review pages), nine complete missing-page responses, an empty HEAD 404, and the isolated sign-in helper with allowed Host 200 / disallowed Host 403. Missing pages include recovery links, a content security policy, and no-store headers.

## Reproduced issue, repaired and verified locally

The first `tests/e2e-local/http-proof.mjs` run passed **24/28** checks. Four unknown URLs (`/settings`, `/setup/github`, `/setup/run`, `/audit-nonexistent-route`) sent no headers within five seconds; direct `/_not-found` also stalled. A nested unknown route returned 404 promptly. The frontend repair replaces the internal rewrite with a complete fixed 404 response. A fresh isolated production build now passes **36/36**, including all original failures in **1–4 ms**, `/_not-found` in 1 ms, nested unknown routes, empty HEAD responses, recovery links, and security/cache headers. Before-fix receipts remain in `local-browser-http-before-fix.*`. This closes the reproduced HTTP stall locally; rendered browser appearance remains unverified.

## Browser restrictions and untested work

- The existing signed-out/public suite scheduled 207 tests. 99 attempts failed before page execution in the captured log, then the run was interrupted. There are **zero completed browser assertions**, not 99 demonstrated product failures.
- Direct Playwright Chromium launch, including a separate Node tool attempt, failed with `bootstrap_check_in ... MachPortRendezvousServer ... Permission denied (1100)` and SIGTRAP before any page opened.
- Parent's in-app browser rejected the loopback URL with `net::ERR_BLOCKED_BY_CLIENT`, leaving the tab at `about:blank`.
- Worker's native Chrome control returned `Computer Use permissions are not granted`. No native UI action occurred.
- Six authenticated Playwright scenarios are ready but **unexecuted**. No screenshots or videos showing a working authenticated UI exist. Accessibility, responsive layouts, rendered error/empty/partial states, actual buttons, and browser sign-in remain unverified here.
- Model, GitHub, sandbox, OAuth, provider-key, full review/Ask/Autofix publication, and production tenant-isolation journeys remain unverified. Local synthetic settlement does not replace those tests.

## Harness-only findings resolved

The first synthetic invocation used a conservative quote larger than the seed review's remaining allowance. The backend correctly denied it; test inputs were reduced. A repeated probe initially compared floating-point addition with a rounded ledger number; the probe now compares rounded micros. These are harness corrections, not product defects. Node fetch normalized an explicit Host override; native HTTP/curl correctly proves the helper rejects an unapproved Host. The initial local sign-in helper compared Next's internally normalized URL hostname; it now validates the actual Host header. All temporary false results are retained with clearly named fixture/rounding receipts.

## Resume and cleanup

Run from BuildIT, using separate terminals for the long-running backend and web commands. The helper assumes the official binary and Node runtime have already been placed under ignored `.local/audit-runtime`; the verified artifacts are not checked in.

```sh
node scripts/run-local-audit.mjs prepare
node scripts/run-local-audit.mjs backend
node scripts/run-local-audit.mjs deploy
node scripts/run-local-audit.mjs seed
node scripts/run-local-audit.mjs build-web
node scripts/run-local-audit.mjs web
.local/audit-runtime/node-v24.21.0-darwin-arm64/bin/node tests/e2e-local/api-proof.mjs
.local/audit-runtime/node-v24.21.0-darwin-arm64/bin/node tests/e2e-local/http-proof.mjs
pnpm exec playwright test --config=playwright.audit.config.ts
```

`seed` refuses an already-seeded database. Use `renew-auth` after deploying the copied renewal helper when the eight-hour test sessions expire. The local browser sign-in entry is `http://127.0.0.1:3107/api/audit-auth?as=A` (owner) or `?as=B` (viewer); URLs contain no credentials. Repeated API probes add synthetic metric records and small synthetic charges. They do not reset or overwrite retained fixtures. Refresh backend and web copies after the final product patches before treating this as final revision evidence. Stop the agent-owned backend/web command sessions with their terminal interrupt; do not kill unrelated processes.

## Revision freshness and scheduled-action tests

The final copied web build includes six web files newer than the earlier copied build: installation claim, live connections, setup steps, first-review setup, tracker callback and tracker cards. The copied Next-only build passed (`local-final-web-build.log`), and the local Convex deployment and test-session renewal then succeeded from the root worker. No shared package rebuild was run by this worker. Root subsequently upgraded only the development test runner to Vitest 4.1.11; the root package and lockfile hashes are recorded separately from the isolated package manifest.

The final API receipt completed at **2026-09-14 04:34:41.107 UTC**, with **26/26 passing checks**. It retains explicit legacy-cost uncertainty, preserves 46,800 measured tokens before the synthetic settlement, observes the live counter change from six to seven, and moves A from **$12.62 to $12.65 / $100 = 12.65%**, with no outstanding reservation. The other tenant stays at $3.75. The final HTTP receipt is **2026-09-14 04:34:41.023 UTC**, with **36/36 passing checks**. These are local API/WebSocket and signed-out HTTP checks; browser assertions remain zero.

`local-browser-snapshot.json` records exact per-file hashes and the hash algorithm. Copied Convex has **114 files**, aggregate SHA256 `575167a6ffd2cdcfd9774fa3f417edd40d544f43dcbb3062449931e95e1f291a`. Copied web has **83 files**, aggregate SHA256 `613a8e811bcf6f1c9a1ccce8bc46d0e7c440561bb6e3ca5627af22475b38e7f1`, build ID `DUzEp_PWaMtbnunfAcNYk`. All **67 product web source files match** the current checkout. Convex has no unexpected source differences: only its local seed helper, empty cron list and generated API declaration differ intentionally. Linked package source hashes are included. The initial $12.50 proof, previous API/snapshot receipts and original HTTP failures are preserved. No production deployment occurred.

The local web server remains in session **44473**, owned by the competitor-review worker; the local backend remains in session **84128**, owned by the build-monitoring worker. They were left running for handoff. Final whole-repository verification is handled separately by the root worker.

The tenant-isolation suite previously passed while five queued cancellation acknowledgments failed later with `missing_github_app_id`. The tests now control and drain those exact queued actions. Their new completion assertion failed before mocks were configured (`local-browser-scheduled-red.log`). Offline GitHub mocks preserve the real repository-writer path and assert exact installation/repository/commit scope, completed neutral check payload, and token revocation. Additional tests assert behavior for a GitHub 503 and explicitly missing configuration. **118/118 tenant tests pass without stderr**, with no console suppression. Convex typecheck and targeted ESLint pass. See `local-browser-scheduled-green.log`, `local-browser-convex-typecheck.log`, and `local-browser-harness-lint.log`.

## Audit web shutdown receipt

At **2026-09-14T04:48:17.686393+00:00**, the owner sent Ctrl-C to the specific isolated web session **44473**. The command confirmed **exit code 130**, consistent with that interrupt. No other process was signalled by this worker. Backend session 84128 was not touched by this shutdown; its owner manages its cleanup separately. This shutdown supersedes the earlier running-session handoff note and does not change the preserved proof results.

The backend owner also stopped audit session 84128 with Ctrl-C and confirmed exit 0; see `local-backend-shutdown.txt`. Both audit-owned local services are now stopped. Private fixtures and proof receipts are retained.

## Approved browser retry (2026-09-14T05:15:56.517848+00:00)

After the user approved the BuildIT work, the isolated backend and web were restarted (sessions **80169** and **21975**) and test sessions were renewed. One standard Playwright owner test was retried with no custom browser flags and tracing disabled. Chromium again exited before page creation: `bootstrap_check_in ... MachPortRendezvousServer: Permission denied (1100)`, then SIGTRAP. **Zero browser assertions or screenshots completed**; this is not a reproduced product defect. No test-body mutation or synthetic model charge ran.

The supported Computer Use fallback was checked without changing another browser tab. It listed no browser surfaces. Two `getApp(com.google.Chrome)` calls returned that Accessibility and Screen Recording permissions are still pending in the ChatGPT Computer Use window. No native UI action occurred. Network/filesystem grants do not supply those OS capabilities, and the available permission-request API exposes no corresponding grant. No alias, proxy, host security bypass, or browser restriction workaround was attempted. The local services were left ready for the user to finish the host permission flow. See `local-browser-approved-retry-status.json`, `local-browser-approved-retry.log` and the preserved Playwright JSON result.


## Actual Chrome browser proof after host permissions

From **05:30:55 through 05:49:47 UTC on 2026-09-14**, the supported Chrome extension ran **45 named cases, all passed**, against simulated owner/viewer workspaces. This supersedes the earlier browser-blocked status; it does not erase the ordinary headless Chromium failure. No production app change was required by these browser cases.

The browser exposed two missing harness prerequisites: the copied security policy omitted the exact loopback HTTP/WebSocket backend, and the synthetic login lacked the refresh credential that real Convex Auth sessions require. The harness now appends only `http://127.0.0.1:3218 ws://127.0.0.1:3218` to the ignored copy, keeps production policy unchanged, and exercises real refresh credentials in its local-only auth helper. Two CSP regressions failed before correction and pass afterward. A deliberate browser sign-out also verified session revocation; fixture renewal can now create a fresh simulated session without replacing business data. Both identities were rechecked afterward.

Owner controls saved zero and restored the $100 limit, persisted pause/resume and comment settings through reloads, and restored the original repository policy. Already-open pages showed the metric counter changing **7→8**, a synthetic **$0.13644** reservation displayed as **$0.14**, and settlement moving spend **$12.65→$12.68** while releasing the hold. The viewer stayed at **$3.75**, could not edit budgets/policies/keys/start reviews, and received a source-free refusal for the owner's review URL. Sign-out removed private figures.

Chrome's actual measured narrow layout was **400 CSS pixels**, with full mobile model-form inspection and screenshots, metric/usage screenshots, keyboard menu/navigation and missing-page recovery. Requested 390px sizing initially did not take effect and is not counted. The model form, selectors, masked input, error notice and buttons fit without overlap; page width equalled scroll width. Inline screenshots are in the CUA tool results; no downloadable image path is claimed because the supported API supplied no file-save method. Historical B49's original artifact is unavailable, so this is current visual inspection, not a recreation of its 9% pixel mismatch.

Current source snapshot was captured at **05:51:41 UTC**. Web build **zGPEm-6qw184Fwk8h8tha**; copied web aggregate SHA256 `d4906a706e2f68940f381df544a40b0e7ab907a541858e6a1c37c3a12ca162c4`; copied Convex aggregate `bcef8bcdd427edb67c429390a036eb5a8e4a44963d21c24616c503dec82e19c4`. All 67 product web source files match except the explicit isolated CSP change. Convex differs only in `auditSeed.ts`, empty `crons.ts`, and the generated API declaration for the test helper. The family-budget repair files and `reviews.by_parent` schema are included. Full manifests are in `local-browser-cua-snapshot.json`.

Focused harness ESLint passed; both CSP tests passed; the isolated Next build, final local Convex deploy and session renewal passed. Services remain owned by this worker: **web14093**, **backend80169**. These supersede the earlier restart session numbers. Root handles final whole-repository verification and later shutdown. No paid model, sandbox, GitHub or tracker OAuth call ran.

Full axe/contrast/screen-reader speech, historical screenshot comparison, other narrow widths/engines, large-data partial browser fixtures and real external credentials remain untested in this browser run. Policy/member/notification/audit/health pages received route render checks only; no member messages or broader settings mutations were attempted. See the explicit matrix rather than treating these 45 cases as every possible end-to-end scenario.

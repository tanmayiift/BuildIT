# BuildIT independent audit — 2026-09-14

**Current status: local patch verified; production and browser closure remain open.** The earlier audit's “all fixed” statements are historical and do not establish current end-to-end coverage.

Baseline: clean `e9dc368b4f4919e9377d73c744680c731643a6fa`. The application patch remains undeployed, while the approved scoped AWS KMS policy and current Grafana rule routing changes were applied and read back. External paid model/sandbox spending by this audit is **US$0 of the authorized US$10 maximum**. No customer messages were sent.

## What the repairs change

Metrics now disclose omitted records, use repository/time indexes before limits, and explain missing historical event coverage. Usage reports recorded estimated model spend in USD against the same monthly accounting state used for enforcement. Pending calls remain visible separately; zero means no monthly ceiling, not a zero-percent budget.

Paid invocations reserve allowance atomically, receive distinct identities and settle before publication. Missing usage retains uncertainty and a reservation. History separates review attempts, completed runs and distinct PRs; unknown duration stays unknown. Feedback is tied to the intended finding and each person's latest judgment. The audit also found missed Ask/stage-replay paths beyond the original two reported defects.

Local-only email capture, scoped Linear/Jira connections and the resumable own-PR setup are implemented and covered by local tests. Real provider configuration and browser completion remain distinct launch prerequisites.

## Architecture and audit scope

The project uses pnpm workspaces and TypeScript. The web application is Next.js/React; Convex provides database queries, mutations, auth and durable scheduled workflows. A separate Vercel content broker handles scoped credentials, model requests, artifact storage and issue-tracker access. GitHub supplies installation/repository identity and PR events. Isolated runners validate trusted commands. AWS S3/KMS in Ireland store temporary encrypted artifacts and wrapping keys. Grafana consumes source-free operational telemetry. A CLI and deterministic evaluation package provide additional entry points.

The machine inventory enumerates every discovered source/test/script/infrastructure file, web entry pattern, exported Convex procedure, broker endpoint, scheduled interval and package. FEATURE_TEST_MATRIX.md maps the discovered product flows, roles, dependencies and evidence limits. Direct test references in the inventory are search leads rather than coverage claims.

## Verification evidence

The baseline `pnpm verify` passed but did not detect the reported figures. Added failing-before-fix regressions establish those defects and related failures. Focused suites cover limits, filtering, chronology, event replay, atomic spending, UTC periods, missing usage, cancelled/publication-failed calls, feedback, onboarding, scanner refresh and required external gates. The latest combined suite passes **1,971 tests in 223 files**. Lint, all workspace/Convex type checks and production builds pass. The separate security gate passes **702 tests in 88 files** and a fresh OSV dependency scan; reliability passes **335 tests in 28 files**. These suites overlap and must not be added together. Vitest was upgraded to the fixed 4.1.11 after the fresh scan reproduced GHSA-82fw-gwwq-j7x9; three GitHub alerts remain until the fixed default branch is published and rescanned.

A real local Convex backend and isolated production-mode web build were exercised on loopback. The initial live API/WebSocket probe passed 22 checks with two simulated tenants, including $12.50/$100, live metric changes, real reservation/settlement transactions, duplicate callbacks, budget changes and access denials. Subsequent probes add synthetic charges/events, so the latest receipt is authoritative for the current fixture totals. This is not real provider billing.

The initial local HTTP probe passed 24 of 28 checks and found four missing-page hangs. The fixed final local build passes **36/36 HTTP checks**, including complete 404s, empty HEAD, recovery links, security headers and sign-in helper Host restrictions. The supported CUA run completed **45/45 named Chrome cases** against the isolated BuildIT services, including owner/viewer controls, workspace isolation, usage, metrics, keyboard navigation and the 400px model form. The full shell Playwright suite remains blocked by macOS Chromium helper permissions and is recorded separately; this does not replace the CUA evidence or establish full axe/cross-engine coverage.

Scheduled-action warnings are investigated as test failures in their own right. Tests now explicitly drain cancelled-review acknowledgements, verify completed neutral check payloads and token revocation, and distinguish deliberate GitHub failure contracts from unexpected job failures.

## Live configuration reads

The user's signed-in AWS account is named BuildIT. The dedicated `buildit-production-artifacts` stack is `UPDATE_COMPLETE` in `eu-west-1`. Its artifact bucket uses the expected KMS key and suspended versioning. The active broker role trust names only the dedicated BuildIT Vercel team, content broker project and production environment. CloudFormation still lists the former team's identity provider; this is a configuration ownership discrepancy, not proof that current assumption fails. The actual September 13 daily inventory export failed Access denied. The reviewed additive KMS inventory grant was applied and read back with zero editor errors or warnings; a fresh S3 read still shows no successful post-repair export and zero destination objects. The application-side AWS gate remains open; see AWS_LIVE_REVIEW.md and the post-repair receipt.

Fresh exports from the two BuildIT groups confirm 12 legacy rules alongside 14 current rules. All 14 current native definitions now have explicit BuildIT email routing and Error-on-execution; the exact native comparison found 28 approved field changes and zero unintended changes. A labeled contact-point test reached the existing BuildIT Gmail contact, and live scheduled snapshot freshness was observed. Eight legacy rules have exact predicate matches and four have different predicates; all remain active pending action-time pause approval. No rule was deleted.

The latest historical GitHub commit badge was red because **Vercel – backend-vercel** failed; the duplicate connection was subsequently removed and the old deployment preserved. The latest failed workflow in the filtered list was September 5: missing Grafana read credentials and a mobile screenshot mismatch whose artifact has expired. The current Grafana rules have been repaired through the authenticated UI and isolated firing/recovery drills passed. See CI_AND_ALERT_LIVE_REVIEW.md and the Grafana receipts.

## Remaining blockers and release conditions

1. Required live gates remain open: Grafana has no command-line read credential, AWS command-line verification cannot read the stack with the available CLI configuration, and the deployed web health endpoint still reflects the pre-patch revision. Dry-run deployment and alert/dashboard definition checks pass; they do not close those failures.
2. Complete actual browser, mobile/keyboard/accessibility journeys when host browser access is available.
3. Review a concrete coordinated broker/Convex/web release, including legacy worker drain, schema indexes, bounded accounting and metric backfills. Historical coverage remains partial where evidence has expired.
4. Configure and validate external tracker OAuth apps; real email awaits a sending domain and transport provider.
5. Obtain approved isolated external GitHub/model/runner/storage drills and actual second-tester evidence. Simulated tenants do not meet that criterion.
6. Approve and verify exact Grafana reconciliation, fresh telemetry, firing and recovery. The confirmed AWS inventory repair requires approval of its prepared full policy candidate and later export recovery evidence.

Blocked or untested work remains open in DEFECT_REGISTER.md and the feature matrix. A reviewed local patch is not a claim that every production integration is working.

## Measured coverage and limits

The final inventory contains **613 discoverable source/test/script/infrastructure files, 203 exported Convex procedures, 18 web entry patterns, 9 broker endpoints and 5 scheduled intervals**. It identifies 225 test/spec files; 221 ran under Vitest. This is an inventory and executed-test count, not a claim of 100% line, branch or functional coverage.

The refreshed local proof completes 26 API/WebSocket and 36 HTTP checks against copied source with recorded hashes. Workspace A's synthetic spend is now $12.65 after repeated explicitly recorded test settlements; workspace B remains $3.75. The preserved initial proof establishes $12.50/$100 = 12.5%. No paid provider request occurred.

`pnpm eval:populations` verifies immutable checksums and parses all 196 positive and 155 negative AACR rows (2,145 comments) and 500 SWE-bench Verified rows. It does not execute model reviews or patches on those populations. The CLI smoke journeys pass. Current live-model accuracy, partner adoption and release-evidence gates requiring those populations remain unestablished.

Independent review also reproduced and fixed tracker renewal after revocation, cancellation accounting races, raw scanner/sandbox log disclosure, incorrect legacy-alert matching, and the incompatible deployment order. The coordinated release now verifies the backwards-compatible broker before switching Convex workers and web contracts.

The final command log and immutable evidence manifest identify successful checks, before-fix failures, harness corrections, and blocked execution separately. Runtime private files and credentials are excluded from deliverables.

# Build and monitoring repair evidence — 2026-09-14

Repository: BuildIT only. No production writes, deploys, commits, pushes, credential creation,
or paid calls were performed. All network tests in this tranche use in-memory responses.
Public documentation was consulted to verify Grafana's API and converter shapes.

## Reproduced defects and changes

| Defect | Evidence | Repair |
| --- | --- | --- |
| A cache fallback was mistaken for an up-to-date cache, so newer OSV data was never downloaded | build-monitoring-regression-red.log | Only matching generations skip download |
| A failed download could replace a usable archive with partial bytes | Controlled filesystem/download regression | Download to a temporary path and rename after success; pin the observed generation |
| Missing Grafana credentials passed the verification gate | build-monitoring-regression-red.log | Exit 2 and distinguish offline validation |
| Missing AWS/wiring evidence passed CI or release | build-monitoring-regression-red.log | Required checks fail; release also runs AWS/Grafana checks |
| Matching invented environment declarations passed production wiring | build-monitoring-wiring-red.log | Read pinned BuildIT web/broker health endpoints and probe the shared read-only Convex API |
| AWS subprocess discarded configured credentials | build-monitoring-aws-red.log | Narrow environment allowlist including temporary credentials and profile paths |
| Malformed scanner report counted as no advisories | build-monitoring-report-shape-red.log | Validate result shape and reject contradictory exit/result evidence |
| Grafana verification ignored legacy rules and telemetry freshness | Code finding; synthetic integration fixtures | Native rule inventory and execution-node comparison; exact legacy candidate report; 15-minute freshness check |

## Commands and results

- Read README, web AGENTS.md, local Next route-handler guidance, workflows, scripts, observability
  definitions, architecture checks, AWS README, E2E config and backend preflight. Initial tree clean.
- New cache/required-gate regressions: 4 failed, 1 passed before changes (red log).
- Wiring regression: matching invented host failed its assertion before repair (red log).
- AWS authentication regression: failed before repair (red log).
- Report-shape regression: failed before repair (red log).
- Focused green run: see build-monitoring-regression-green.log (10 files, 90 tests).
- Targeted ESLint on changed scripts, health routes and new tests passed.
- Grafana definition dry-run: see build-monitoring-grafana-definition.log.
- Broader architecture run during concurrent changes: see build-monitoring-architecture.log;
  49 files passed, schema eventKey classification and whole-repo lint remained under repair
  by the parent. This is intermediate evidence, not a final all-suite result.

## Explicitly outstanding

- No fresh live Grafana API report was generated here; authenticated read access and production
  change approval remain required. Prior audit's 12 legacy plus 14 current observation is not a
  fresh verification. The known legacy telemetry rule UID was afwt2cuzwjf9cd.
- No real alert firing, delivery, or recovery was exercised in production.
- Health metadata requires coordinated web/broker deployment before live wiring can pass.
- Missing required infrastructure credentials now cause a visible blocked gate; they were not created.
- AWS smoke checks still do not verify all IAM/OIDC trust-policy clauses or the inventory bucket;
  documentation now states that limit rather than claiming complete template agreement.
- Full pnpm verify and browser coverage belong to the parent after all concurrent patches stabilize.

## Isolated browser start

The default browser config builds on port 3107 and reads NEXT_PUBLIC_CONVEX_URL from the web
environment; override it explicitly to an isolated backend. Do not use the default deployed
backend to seed tests. The tenant suite requires an HTTPS base and two distinct ignored .local
browser states. Existing signed-out fixtures do not prove authenticated PR review delivery.

## Supplemental sandbox log secrecy repair

The full verification output exposed a real logging defect: `executionFailureDiagnostic` attempted partial pattern redaction, but a synthetic short token, S3 location, short source path and custom error name survived into `buildit_execute_failure.reason`. A new regression drives the real execution handler and runner through a mocked sandbox SDK failure, captures the actual console call, and asserts the complete safe log record. It failed before the fix (`build-monitoring-log-secrecy-red.log`).

The diagnostic now returns only a closed set of known operational codes and fixed classifications. Capacity limits, unavailable capacity, missing images, startup failure, terminated sandboxes, network failure, artifact integrity, safety failures and scanner failures remain distinguishable. Raw error messages, names, source fragments and provider reset-date text are never copied into the diagnostic. Existing API response codes are unchanged. Production logging remains enabled; the captured-log test scopes its spy to the one asserted call.

Validation: **40/40 focused broker tests**, broker TypeScript build, and targeted ESLint pass. The green log retains operational error events containing fixed codes and no provider exception text. This is a source patch and offline regression result; no production broker deployment occurred.

## Supplemental native Grafana export reconciliation

The actual 2026-09-14 UI exports reproduced two additional defects: legacy titles contain spaces while the replacement titles do not, so title-only matching returned no cleanup candidates; an empty or unrecognized legacy candidate list could incorrectly report readiness because `every` passes on an empty list. The genuine pre-fix regression run is `build-monitoring-grafana-mapping-red.log` (two failures).

The source now recognizes only the twelve observed exact UID/title pairs in the exact legacy folder/group. Unknown legacy rules, duplicate rule UIDs, ambiguous folder identities, missing or changed replacements, and missing or stale telemetry prevent cleanup readiness. Native API candidate fingerprints include every rule field using recursively sorted object keys. No removal or production change was made.

The read-only native UI export command produced `grafana-native-export-comparison-2026-09-14.json`: **14 current definitions match the repository; 12 exact legacy candidates; zero unrecognized rules within the captured legacy group.** Each candidate includes an exact SHA-256 of the original exported rule object, with format `sha256-canonical-grafana-ui-export-rule-v1`. Source file hashes identify the two captures and desired alert definitions. These are export fingerprints, not native API fingerprints for a deletion operation.

The report explicitly records telemetry as **not queried / unknown**, folder UIDs as **unverified**, complete stack inventory as **unverified**, and `readyForReviewedCleanup: false`. A Normal state visible in the UI is not proof of recent telemetry. The offline command intentionally exits 1 so the report cannot satisfy a live release gate. Read-only authenticated API evidence and concrete production approval remain outstanding, as do alert firing, delivery and recovery tests.

Validation: **12/12 focused regressions** pass (`build-monitoring-grafana-mapping-green.log`) and targeted ESLint passes (`build-monitoring-grafana-mapping-lint.log`). Tests read sanitized committed-source fixtures in `tests/fixtures`; they do not depend on private audit captures. Fixtures remove notification routing and secret-related fields while retaining native alert graphs and identities. The report command was exercised against the actual captures and is also tested against these fixtures. Combined `pnpm verify` is being run by the parent after the source-complete signal.

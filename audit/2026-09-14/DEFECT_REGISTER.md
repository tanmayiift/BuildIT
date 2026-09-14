# BuildIT defect register — 2026-09-14

Status **fixed locally** means the changed code passed focused checks, not deployed or fully browser verified. Evidence under `../evidence/` includes both failing and passing runs. Findings first inferred from code are distinguished from reproduced behavior.

| ID | Severity / class | Finding and impact | Evidence | Status |
| --- | --- | --- | --- | --- |
| B01 | High / reproduced | Metric summaries silently stop at 20,000 events. | workspace-figures-red.log; workspaceSummaries boundary cases | Fixed locally: extra-record probe, envelope, partial tiles. |
| B02 | High / reproduced | Provider-paid $12.50 appears as zero budget spend. | workspace-figures-red.log; usage/component/API proofs | Fixed locally: shared recorded USD snapshot, 12.5% of $100. |
| B03 | Medium / reproduced | Exactly 20,000 usage rows falsely claim more data exists. | boundary cases at 19,999/20,000/20,001 | Fixed locally. |
| B04 | High / reproduced | Repository filter after row cap drops relevant rows. | workspace/history summary fixtures | Fixed locally: scoped time indexes before caps. |
| B05 | Medium / code finding + regression | Client-defined periods and unstable end bounds can miss new subscribed events. | UTC month fixtures; real WebSocket metric update | Fixed locally: server UTC periods, stable end bounds, daily refresh. |
| B06 | High / reproduced | Four advertised metric names lacked reliable event recording. | workspace-events/outcomes-red.log | Fixed locally: deduplicated regression, stale, runner/provider failure events. Old history remains incomplete. |
| B07 | High / reproduced | Parent validation can exceed Convex read limits on large distinct-run datasets. | workspace-parent-limit-red.log | Fixed locally: bounded parent reads and explicit partial results. |
| B08 | High / reproduced | Monthly aggregate initialization can overwrite retained historical spend. | accounting-convex-red.txt | Fixed locally: resumable 200-row reconciliation and additive new writes. |
| B09 | High / reproduced | Concurrent paid calls can pass a non-atomic spending check together. | accounting concurrency tests | Fixed locally: atomic reservations for each physical call. |
| B10 | High / reproduced | Empty/invalid outputs and failed GitHub publication can lose charges. | accounting provider/Ask/transport red evidence | Fixed locally: settle before output handling/publication. |
| B11 | High / reproduced | Cancellation/stale commit may discard an already paid response. | accounting delayed-response + execution-integrity-red.log | Fixed locally: preserve charge without reviving state. |
| B12 | High / reproduced | Duplicate callback and identical-but-separate requests have ambiguous identity. | accounting invocation tests | Fixed locally for new workers: per-invocation identity and dedupe. Legacy worker drain is a rollout requirement. |
| B13 | High / reproduced | Missing usage can be converted into trusted zero. | accounting provider/transport tests | Fixed locally: unknown cost, conservative reservation retained. Historical uncertainty remains. |
| B14 | Medium / reproduced | Gemini thinking tokens omitted from billable output count. | accounting-provider-red.txt; official Google usage docs | Fixed locally. |
| B15 | Medium / reproduced | Ask rate limit depends on successful publication. | atomic Ask attempt tests | Fixed locally: count physical reservations before paid invocation. |
| B16 | Medium / code finding | Alternative Autofix charge writer creates competing accounting path. | accounting implementation review | Consolidated current writers; compatibility documented. |
| B17 | High / reproduced | Queue and run history use status/commit order before recent-row sorting. | history-red.log | Fixed locally: timestamp indexes and completeness metadata. |
| B18 | High / reproduced | History leaks cost from another repository and hides caps/incomplete costs. | history-red.log, pending-cost tests | Fixed locally. |
| B19 | Medium / reproduced | History displays fabricated lifecycle duration and calls attempts reviewed PRs. | history-red.log + proof component | Fixed locally: unknown duration and separate attempt/run/PR labels. |
| B20 | High / reproduced | Feedback can target wrong run or ambiguous old fingerprint. | history-red.log | Fixed locally: concrete finding identity, latest completed run; refuse ambiguity. |
| B21 | Medium / reproduced | Feedback counts repeated judgments, app dismissals missing, GitHub dismissal does not change resolution. | history feedback DB tests | Fixed locally: latest person/finding opinion and shared action. |
| B22 | Medium / reproduced | Onboarding milestone scans hide valid evidence behind unrelated rows. | history-red.log activation fixture | Fixed locally: indexed existence checks and unknown state at evidence cap. |
| B23 | Medium / reproduced | Public proof scopes repositories after caps and inflates completed PR count with attempts. | history-red.log public cases | Fixed locally. |
| B24 | Medium / reproduced | Ask still selects an old run by commit spelling and may answer stale evidence. | execution-integrity-red.log (2 cases) | Fixed locally: latest completed timestamp and stale rejection. |
| B25 | High / reproduced | Stage replay after 500 records adds a second charge. | execution-integrity-red.log | Fixed locally: indexed receipt/invocation lookup. |
| B26 | Medium / reproduced | Cancelled/blocked receipts claim nothing charged or work never started without evidence. | billing-copy-red.log, billing-title-red.log | Fixed locally: truthful usage guidance. |
| B27 | High / reproduced | Scanner refresh path can reuse stale data or replace valid cache with failed download. | build-monitoring-summary.md and cache tests | Fixed locally: correct refresh reason and atomic validated replacement. |
| B28 | High / reproduced | Invalid scanner output can look like no findings. | build-monitoring-summary.md | Fixed locally: malformed output fails. |
| B29 | High / reproduced | Required AWS/Grafana checks succeed while external verification is skipped. | required-live-gates tests | Fixed locally: missing credentials fail required gates. |
| B30 | High / reproduced | Wiring check does not prove the deployed web, broker and Convex targets match. | production-wiring/health tests | Fixed locally: fetch and compare public pinned metadata. |
| B31 | High / reproduced | AWS verifier drops valid temporary credential/profile environment. | aws-verifier-credentials test | Fixed locally: narrow credential forwarding; no secret output. |
| B32 | High / live read + code finding | Grafana has legacy and current rule groups; legacy silence signal can page on idle traffic. | prior read-only Grafana evidence; reconciliation report tooling | Prepared source/report checks. Production reconciliation and firing/recovery remain open. |
| B33 | High / code finding + regression | Grafana drift check trusts saved source instead of actual evaluation graph and freshness. | grafana-verification tests | Fixed locally: native expression graph, conditions, pause/duration/labels and freshness. |
| B34 | Medium / reproduced | Unknown URLs stall instead of completing a 404. | local-browser-http-before-fix.json; unknown-route-red tests; local-browser-http-proof.json | Fixed locally; all 36 real HTTP checks pass, original failures complete in 1–4 ms. |
| B35 | Medium / reproduced test gap | Green tenant tests leave failed scheduled GitHub acknowledgement jobs. | scheduled-warning red/green evidence | Tests now drain/assert payload, success and revocation; actual error paths tested explicitly. |
| B36 | Medium / missing capability | Linear/Jira only partially wired; no complete browser connection journey. | tracker OAuth red/state/provider tests | New local connection implementation; external OAuth apps/live journey remain blocked. |
| B37 | Medium / missing capability | Notification preference exists without a working delivery path. | email-capture-red.txt and lifecycle-to-file tests | Local capture implemented; real email remains unconfigured and unsent. |
| B38 | Medium / reproduced | Expired email verification disables opt-out too. | notification preferences component regression | Fixed locally: eligibility and stored consent are separate. |
| B39 | High / reproduced + live failure | Encrypted deletion inventory lacks S3 service permission on KMS key. Live September 13 export failed Access denied. | AWS_LIVE_REVIEW.md; aws-inventory-red.txt | Narrow source permission fix and live KMS repair pass. Fresh encrypted manifest/checksum/CSV now exist; content parsing and next scheduled export remain open because AWS CloudShell account verification is pending. |
| B40 | Medium / live read | CloudFormation still names old Vercel identity provider while active broker role trusts dedicated BuildIT team. | Sep14 AWS stack resources vs role trust | Configuration ownership drift requires reconciliation review; runtime failure is not inferred from this difference alone. |
| B41 | High / reproduced | Sandbox error logs can disclose credential fragments, storage paths and source snippets. | build-monitoring-log-secrecy-red.log; 40 focused checks | Fixed locally: closed known error codes and fixed classifications; no blanket log suppression. |
| B42 | High / reproduced | Tracker renewal survives deleted workspace, revoked repository/installation, cancellation or expiry; mismatched review can expire a connection. | tracker-lifecycle-red.log; tracker-oauth-implementation.md | Fixed locally; lifecycle and bounded sweep regressions pass. |
| B43 | High / reproduced | New paid calls can start while cancelling, after retention expiry or installation suspension; a late charge can overwrite cancelling state. | accounting-cancellation-red.log (5 failures), accounting-cancellation-green.log | Fixed locally: refuse new spend after stop conditions, retain paid receipt without changing cancellation. |
| B44 | High / reproduced integration defect | Existing deployment order switches workers before the broker understands per-invocation requests. | deployment-order-red.log; old broker parser rejects invocationId | Fixed locally: compatible broker first, verify its commit, Convex next, web last; stale broker prevents worker deployment. |
| B45 | Medium / reproduced tooling defect | Grafana cleanup report cannot match actual legacy titles to replacement names and can say ready with unknown legacy rules. | real Sep14 group exports; focused Grafana regression evidence | Fixed locally: exact UID/title mapping, unknown items block readiness; all 14 native current definitions match. No rule deletion. |
| B46 | High / reproduced | Runner warning logs include raw scanner stdout/stderr, potentially source or secrets. | runner-diagnostic-red.txt (4 failures), runner-diagnostic-green.txt | Fixed locally: closed reason categories and numeric exit codes; 97 focused checks pass. |
| B47 | Medium / confirmed dependency advisory | Vitest 3.2.7 includes vulnerable redirect-mock file access (GHSA-82fw-gwwq-j7x9). | security-vitest-advisory-red.log; official maintainer advisory; security-release-current.log | Upgraded to fixed 4.1.11; fresh dependency scan and full verification pass. No exploitation against this project established. |

## Additional live associations and historical evidence

- **B48 — Medium / live configuration association:** The current BuildIT commit has one failing Vercel check from `backend-vercel` under an unconfirmed old team. The dedicated BuildIT deployment and seven checks succeeded. No unrelated project was touched; association ownership remains open. See CI_AND_ALERT_LIVE_REVIEW.md.
- **B49 — Medium / historical failure, unresolved classification:** September 5 mobile `/setup/model` screenshot mismatch (9% versus 8% tolerance). The run artifact expired. Later old-commit browser checks passed, but current-patch browser coverage is zero. No tolerance or baseline was changed to claim closure.

## Explicitly open verification and capability gaps

- Browser controls cannot reach the local app: Playwright launch is denied by macOS; in-app browser returns client-blocked; native Chrome access is unavailable. Browser, responsive, keyboard and axe assertions have not completed in this run.
- No live provider, GitHub publication, sandbox, key rotation, restore, or deletion drill has run. Test contracts and read-only configuration checks do not establish those external outcomes.
- No OAuth apps/client configuration for the new tracker connections, sending domain/provider, or real second-user adoption evidence is available.
- No public organization deletion action exists. Artifact deletion and scoped tombstone cleanup are separate, narrower capabilities.
- Historical missing metric events and charges cannot be invented. Backfill uses retained evidence only and continues to label incomplete history.
- Final local verification and copied-source proof pass. Live release gates, browser checks, production application/AWS/Grafana approvals and post-change evidence remain open.

## Approved live phase additions

- **B50 — Medium / live editor finding + reproduced template regressions:** Two encryption-context grants incorrectly included the unsupported metadata action `kms:DescribeKey`; the S3 context also used an ARN operator for a string-valued condition. Removed unused metadata actions and changed only the exact existing S3 path operator to StringLike. Source checks: 29 pass; live editor: zero errors/warnings; saved policy exactly matches candidate. See aws-key-policy-corrected-2026-09-14.json. No broker runtime DescribeKey call exists in the reviewed source.
- **B39 live update:** Exact inventory encryption grant applied and read back successfully. Recovery is still open until a new successful inventory manifest arrives.
- **External prerequisite:** AWS CloudShell reports account verification pending. No destructive reset or support contact attempted.

- **B51 — High / reproduced:** A provider fallback received a new full per-review allowance despite spend/reservations on its parent. Fixed locally with complete bounded family reads and one original cap; late charges retained and replay creates only one fallback. 22 red cases; 233 focused checks pass. Evidence: fallback-budget-implementation.md. Not deployed.
- **B52 — High / reproduced deployment targeting:** Coordinated Convex deployment could use development selectors from local environment files. Fixed locally with an isolated production selector and exact server target checks before broker and Convex deployment. 48 focused checks pass; exact production target resolved read-only. Not deployed.

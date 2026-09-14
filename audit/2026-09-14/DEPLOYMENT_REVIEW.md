# BuildIT application production change review — not executed

This document describes the intended application release and its prerequisites. It is not approval or evidence of application production success. The approved scoped AWS KMS and current Grafana console changes are recorded in `LIVE_EXECUTION.md` and their receipts; this document intentionally remains the application-release checklist.

## Application patch

Target only the dedicated BuildIT services: the content broker, Convex deployment `judicious-barracuda-968`, and web app `buildit-agentic-review`. The unrelated `backend-vercel` project and other Vercel teams remain outside scope.

1. Complete the recorded local verification, review the patch, and run the unexecuted browser and isolated external journeys in an environment that permits them. Do not treat failed/missing live gates as a passing preflight.
2. Use a reviewed immutable commit. Pause new review starts for the explicitly approved test/workspace scope and drain legacy model/Ask/Autofix workers before resuming them. Old callbacks without invocation identities cannot be made retrospectively reliable by the new accounting code.
3. Deploy the **backwards-compatible broker first** and verify that the production alias serves the intended commit. The previous broker rejects the new `invocationId` field. The corrected coordinated script stops here if the alias is stale.
4. Deploy Convex and wait for new indexes and functions. New accounting tables, tracker state, notification outbox and time indexes are additive; no historical rows are removed. Then deploy the web app consuming the new summary envelopes. Coordinate this short API-contract transition with client refresh; browser compatibility across the transition still requires verification.
5. Initialize each approved workspace's current UTC month using the bounded reconciliation path. It reads at most 200 ledger rows per transaction and resumes through a cursor. New charges update separate totals atomically. Verify recorded totals and pending reservations before allowing new paid work.
6. Preview retained metric reconstruction with `metricReconciliation:backfill` (dry-run default) and inspect counts/cursors. Apply only for the approved workspace, page by page. Missing historical evidence remains partial even after reconstruction.
7. Exercise one approved isolated PR through review, Ask, cancellation, retry and verified Autofix. Check actual provider usage, persisted ledger, resulting GitHub checks/comments and artifact cleanup. Keep cumulative external cost within the agreed US$10 cap.
8. Verify the dedicated web/broker/Convex wiring and telemetry after release. Run browser and tenant-isolation journeys against the approved test workspace, without contacting real users.

The Convex step now uses `--env-file scripts/buildit-production.env`, which contains only the dedicated production selector. The coordinated script removes inherited Convex selectors from every child command, rejects deploy keys for any other deployment, and uses the existing CLI authorization to resolve the server's production target before the broker and again immediately before Convex. It requires the exact name `judicious-barracuda-968`, type `prod`, and URL `https://judicious-barracuda-968.convex.cloud`. A changed project default stops the release. The installed CLI does not offer `deploy --deployment-name`; an invented flag is not used. No persistent deploy key is created by this check.

The `pnpm deploy:production` command coordinates broker → verified broker → Convex → web. Do not run it until the above release and downtime/test scope is explicitly approved. Manual `web`, `broker`, or `both` workflow targets do not deploy Convex and are not sufficient for this patch.

## AWS repair

The live daily deletion inventory failed on September 13. Add only the reviewed S3 inventory `kms:GenerateDataKey` statement to the existing BuildIT KMS policy, retaining every existing statement. See AWS_LIVE_REVIEW.md and the resolved statement under `../evidence/`.

**Do not apply the whole CloudFormation stack as a shortcut.** Its old OIDC provider ownership differs from the live BuildIT role trust and could affect a resource associated with another project. Resolve that ownership separately through a reviewed change set. After the minimal KMS change, require a new successful inventory manifest and the strengthened read-only boundary check. An immediate stack success is not an export-recovery result.

## Grafana repair

Backups of the exact 12 legacy rules and 14 current rules were downloaded from each BuildIT group's Export UI. Offline comparison establishes definitions only; it does not establish fresh telemetry or API identity fingerprints. Review the generated comparison and `docs/operations/grafana-reconciliation.md`.

Before any removal, obtain a fresh read-only report with exact folder/group/UID identities and full-rule fingerprints, verify replacements and telemetry freshness, and approve only the named legacy UIDs. Do not remove any folder, contact point, notification policy or unrelated rule. Observe firing and recovery in an isolated setup and three normal production snapshot intervals after the approved change. Test-message delivery requires separate explicit recipient authorization.

## New integrations

Linear/Jira code is locally implemented. Approved external OAuth applications, callback URLs, client configuration and live consent/refresh tests are still required. Do not store secrets in the patch or reports. Local email capture intentionally works only on loopback; no real sending provider or domain is configured. Do not turn captured messages into customer sends.

## Recovery constraints

Keep database accounting rows and receipts during rollback; never erase charges to make the UI look correct. A rollback to old workers after the new protocol goes live can reintroduce uncaptured attempts. Stop new work, preserve the compatible broker and inspect pending/unknown invocations before choosing an older release. Unknown provider charges remain reserved until supported by a real receipt.

No production action in this document has been executed. Safe local work and concrete evidence preparation precede any request for production approval.

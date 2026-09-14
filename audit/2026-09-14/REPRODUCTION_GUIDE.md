# BuildIT regression reproduction guide

Run these commands from the BuildIT root using pnpm 10.15.0 and a supported Node version (22–26). The audited local backend used the separately checksummed Node 24 runtime. Use `pnpm install --frozen-lockfile` to reproduce the resolved dependency tree. Do not use production credentials for these tests.

The supplied patch applies to `e9dc368b4f4919e9377d73c744680c731643a6fa`. Original failures were captured before their fixes under `../evidence/`; final code passes those assertions. Do not revert the working checkout to reproduce an old failure. The descriptions below identify the controlled inputs and expected result.

## Workspace figures (B01–B07, B14, B26)

```sh
pnpm exec vitest run convex/workspaceSummaries.test.ts apps/web/src/app/live-metrics-usage.component.test.tsx packages/providers/test/accounting.test.ts
```

- Seed 19,999, 20,000 and 20,001 valid events in the reporting period. The first two summaries are complete; only the third is partial. All counted tiles disclose that limit. The baseline silently returned 20,000 metrics and falsely called exactly 20,000 usage rows incomplete.
- Put unrelated repository rows ahead of the selected repository's events. Filtering must happen before the ceiling; newest selected records survive.
- Seed provider-billed rows totaling 12,500,000 cost micros and a monthly limit of 100. Reconcile and query usage. Recorded estimated spend is $12.50, the bar is 12.5%, and enforcement consumes the same snapshot. Ask tokens contribute to measured token totals.
- Replay stale/failed/completed observations. Each supported event counts once. Historical missing events remain explicitly incomplete; bounded parent validation reports partial results instead of exhausting the transaction.
- Use Gemini usage with response plus thinking tokens. Both billable output categories enter accounting; missing usage remains unknown.

## Paid requests, concurrency and lifecycle (B08–B16, B24–B25, B43)

```sh
pnpm exec vitest run convex/accounting.test.ts convex/executionRecordIntegrity.test.ts convex/askRateLimit.test.ts packages/providers/test/accounting.test.ts packages/broker/test/model-http.test.ts
```

- Two simultaneous reviews compete for the same remaining allowance. Only the reservable calls proceed; reservations are visible separately from settled spend.
- Replay the same invocation receipt; cost stays unchanged. Make two real request identities with identical prompts; both charges count.
- Delay a paid response past cancellation, replacement, expiry or the UTC month boundary. Preserve its charge in the original accounting month without changing the stopped review back to running.
- Start another attempt after cancellation or installation suspension. Refuse it before provider access. Preserve a late over-limit charge without overwriting a cancellation in progress.
- Return invalid/truncated output or fail GitHub publication after a response. The paid receipt remains. Lose the provider response completely; retain a conservative unknown reservation.
- Seed more than 200 legacy ledger rows, begin reconstruction, and insert new paid rows between pages. Final totals include both exactly once. An Ask as the first new writer cannot erase historical spend.
- Attempt six Ask reservations inside ten minutes. The limit counts physical attempts before publication, including failed publication.
- Place the newest completed Ask run behind more than ten commit-sorted older runs. Select by completion time and reject stale evidence. Replay a stage receipt after 500 other records; never add the charge twice.

## History, feedback and evidence (B17–B23)

```sh
pnpm exec vitest run convex/historySummaries.test.ts apps/web/src/app/live-history.component.test.tsx apps/web/src/app/proof/page.component.test.tsx
```

Seed 500 old failures before fresh active work and more than 50 reverse-ordered commit names. Recent history must remain recent and report its cap. Add ledger rows from another repository, missing lifecycle timestamps and pending charges; exclude foreign costs and show unknown/partial values. Submit repeated and out-of-order judgments from multiple people; count each person's latest judgment for the concrete finding, and apply dismissal consistently. Place valid milestones behind unrelated records and mix attempts with completed PRs; onboarding/public proof must not infer completion from attempts or expose another customer's evidence.

## Tenant, tracker and notification boundaries (B35–B38, B42)

```sh
pnpm exec vitest run convex/tenantIsolation.test.ts convex/trackerOAuth.test.ts convex/notificationOutbox.test.ts packages/broker/test/tracker-oauth.test.ts packages/broker/test/tracker-oauth-http.test.ts packages/operations/test/email-capture.test.ts
```

Use simulated owner/viewer memberships in two organizations. Cross-organization records and unauthorized writes must fail. Drain scheduled cancellation acknowledgments and assert the exact neutral check payload and token revocation. Tracker cases cover state replay/expiry, wrong project/team/site, revoked or deleted parent records, cancellation, renewal races and bounded cleanup. Notification cases drive the actual lifecycle decision through eligible-recipient selection and local captured output, including consent revocation, stale verification, retries and stable deduplication. Captured output is not email delivery.

## Scanner, diagnostics and deployment gates (B27–B33, B39–B41, B44–B47)

```sh
pnpm exec vitest run tests/architecture/audit-database-refresh.test.ts tests/architecture/dependency-audit-gate.test.ts tests/architecture/required-live-gates.test.ts tests/architecture/production-wiring.test.ts tests/architecture/health-wiring.test.ts tests/architecture/aws-inventory-policy.test.ts tests/architecture/aws-verifier-credentials.test.ts tests/architecture/grafana-verification.test.ts tests/architecture/deployment-command.test.ts packages/broker/test/execution-diagnostic.test.ts packages/runner/test/vercelSandbox.test.ts
```

Control the cache generation/download and malformed scanner output; refuse stale or incomplete data. Supply fake live targets with mismatching deployment metadata; fail verification. Missing AWS/Grafana credentials must fail required checks. Fake AWS policies/manifests cover the missing inventory encryption grant, freshness and exact BuildIT trust. Grafana fixtures cover actual native expressions, legacy identities, unknown rules and freshness. Simulate an old broker after deployment; Convex must not deploy. Capture diagnostic output from a provider/sandbox/scanner failure and assert fixed categories, with no raw error, token, source or scanner text.

The fresh dependency scan independently caught Vitest 3.2.7. The lockfile now resolves 4.1.11; `pnpm security:release` passes the actual current OSV scan without an advisory waiver.

## Local service and browser reproduction (B02, B05, B34 and open visual coverage)

Follow `../evidence/local-browser-summary.md` for the isolated runtime setup. Start backend and web in separate terminals, then run the included API and HTTP probes. The first preserved API receipt proves $12.50/$100. Repeated probes intentionally add synthetic events and $0.03 settlements; use each receipt's before/after figures. The HTTP regression sends requests to the original four hanging unknown routes and requires a complete 404 within five seconds; the fixed build returned those in 1–4 ms.

`pnpm exec playwright test --config=playwright.audit.config.ts` defines six authenticated scenarios. This host could not launch or access a browser against the local app; zero browser assertions completed. Do not substitute the HTTP/API pass for browser, keyboard, responsive or accessibility approval. Both audit-owned services were stopped after proof capture; fixtures remain private and resumable.

## Full checks and production limits

```sh
NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3218 pnpm verify
pnpm security:release
pnpm reliability:release
pnpm eval
pnpm eval:populations
pnpm smoke:cli
pnpm alerts:check
pnpm dashboard:check
```

See COMMAND_LOG.md for actual outcomes. Required live checks remain failed/unverified, with their precise receipts. AWS live reproduction is read-only: open the dedicated artifact bucket's DailyDeletionAudit inventory status and the dedicated KMS policy; September 13 shows Access denied and no inventory service grant. The complete candidate and exact target are in AWS_LIVE_REVIEW.md. Applying it requires approval, followed by a new successful export. Grafana definition matches alone do not prove fresh telemetry or alert firing/recovery.

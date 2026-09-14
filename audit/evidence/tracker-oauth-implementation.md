# Tracker connections and first-review implementation

Local implementation completed for the authorized BuildIT-only scope on 2026-09-14. No production provider setup, account writes, paid model calls, or live OAuth consent was performed. OAuth means signing in through the tracker instead of pasting a personal token.

## Behavior delivered

- Linear and Jira now have real provider authorization, callback exchange, explicit team/site/project selection, and renewable read access. A callback alone does not activate a connection. Missing provider registration displays **Not configured**; a failed availability check displays **Unavailable**. Neither state pretends to be connected.
- Linear requests `read` with state and S256 PKCE. Jira requests `read:jira-work offline_access`. Only the chosen repository and issue team/project are used by BuildIT. The provider consent can be broader than this application-enforced scope, which the selection screen states.
- Single-use state is hashed, tied to the initiating person and organization, expires after 15 minutes, and requires a recent admin login to start. Attempts are bounded to 10 per person/workspace in 15 minutes across denied/completed/pending states. Pending choice metadata can resume without revealing a token.
- The broker exchanges, encrypts, renews and revokes credentials. A distinct signed, short-lived, single-use grant binds each operation to the exact request body and organization. Both access and refresh tokens live in the existing KMS envelope; the browser receives no token. Provider endpoints are fixed; Jira sites and selected cloud identifiers are checked, and outbound redirects are refused.
- A short lease serializes refresh rotation. Invalid/revoked refresh grants expire and scrub the connection. Disconnect removes local decryptable credentials immediately. Linear attempts provider revocation. Jira supplies the account app-removal link because no supported programmatic 3LO revocation endpoint was found; the UI distinguishes local removal from provider revocation.
- Linked issue context selects repository-scoped credentials first, checks project scope against the encrypted bundle, uses Jira's OAuth cloud endpoint and Linear's Bearer header, and marks absent/expired access as unavailable context. Refresh tokens never go to issue-fetch endpoints.
- Expired temporary state is scheduled for deletion. The hourly `trackerOAuthData:sweepDeletedOrganizations` job pages through 50 organization tombstones at a time, schedules bounded tracker erasure and notification metadata erasure, and resumes through the remaining pages. This does not add a general organization-deletion UI or writer.
- Setup now leads through GitHub → model key → one's own pull request. GitHub installation claim continues to the model step. `/setup/review` accepts only valid GitHub PR links from the active workspace's installed repositories and saves the link per workspace in browser-tab storage. Reloading never restores consent or an old commit preview. Starting still requires the existing exact-commit preview and explicit cost-capped approval; the default cap is $2. Advanced repository checks, permission receipt and tracker setup stay available without blocking the first-review path.
- Removed the static repository policy example that looked like actual saved settings. Removed the invented “your full test balance” label on the $3 cap.

## Verification

- `tracker-oauth-red.log`: 8 pre-implementation provider contract failures (missing feature).
- `onboarding-red.log`: first-review test could not load the missing first-review module.
- `tracker-final-green.log`: **341 tests passed in 34 files**, including tracker provider/state/broker/UI tests, first-review/resume/consent tests, existing broker/security/telemetry suites, 118 tenant-isolation tests, connected journeys, and public-function/data-classification inventories.
- `tracker-scope-green.log`: 17 additional focused checks pass after updating the old architecture index assertion; behavior proves 60 unrelated repository connections cannot crowd out or expose the selected repository credentials.
- `tracker-convex-typecheck.log`: pass.
- `tracker-packages-typecheck.log`: broker, GitHub, security and telemetry pass.
- `tracker-lint.log`, `tracker-final-lint.log` and `tracker-scope-lint.log`: owned source lint passes.
- `git diff --check`: pass.
- `tracker-web-typecheck.log`: only two existing generated `.next/types/validator.ts` `Route`/`never` errors remained from concurrent root Next artifact generation. No new source-file errors. Parent subsequently regenerated Next types and reported the combined lint/typecheck gates passing; the original local failure log is retained.

The provider tests use mocked official response contracts and real local encryption/decryption. They exercise granted, denied, stale, replayed and expired state; wrong-tenant and wrong-site scope; project validation; rotated refresh tokens and invalid grants; safe disconnect; expired credential context; tombstone erasure; rate limits; missing registration; and a callback-success UI subscription race. Component tests are not a live browser OAuth proof.

## External prerequisites / release coordination

1. Register BuildIT-owned OAuth apps in Linear and Atlassian. Configure the exact callback `https://<existing-BuildIT-web-host>/setup/tracker`; a sending/email domain is not required. Do not create a separate app for every customer.
2. Broker deployment requires `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET`, `BUILDIT_WEB_ORIGIN`, and the already-established KMS/S3/role/`TRACKER_GRANT_SECRET` boundary. Convex uses its established `BUILDIT_BROKER_URL` and matching `TRACKER_GRANT_SECRET`. Credentials were not requested, printed or registered during this work.
3. Deploy the schema/indexes, Convex functions, broker route, telemetry package and web callers together. The new schema fragment is `convex/trackerOAuthSchema.ts`; the parent integrated root schema fields/indexes and hourly cron. Schema classification/public policy inventory was coordinated with the email/CI agent.
4. After registration, prove the actual consent callback, a selected team/project issue read, refresh and revoke/reconnect with a test account. Live provider configuration and those live browser flows remain **unverified**, not closed as operationally ready.

## Primary references checked

- [Linear OAuth documentation](https://linear.app/developers/oauth-2-0-authentication): authorization/token/revoke endpoints, read scope, PKCE and rotating refresh flow.
- [Linear GraphQL documentation](https://linear.app/developers/graphql) and [official SDK schema](https://raw.githubusercontent.com/linear/linear/master/packages/sdk/src/schema.graphql): Bearer authentication, error handling, organization/team fields.
- [Atlassian OAuth 2.0 3LO documentation](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/): state, audience, callback, accessible resources, cloud API and renewable authorization.
- [Jira projects API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-projects/): read scope and project list/selection validation.
- [Atlassian developer discussion on revocation](https://community.developer.atlassian.com/t/revoke-access-refresh-token-from-3lo-app-on-behalf-of-user/73838): no supported revoke endpoint identified; therefore local disconnect is explicitly distinguished from user removal in account apps.

## Independent lifecycle recheck

The follow-up review reproduced 11 failing cases before the final guards were tightened (`tracker-lifecycle-red.log`). The ownership helper checked parent identifiers but did not establish that the organization, repository, installation or review still authorized access. The resulting bugs allowed credential return or renewal after workspace deletion, repository removal/pause, installation suspension, cancellation, or review expiry. A failed refresh could also expire a connection using a mismatched review, an already-expired renewal could be stored, and setup could finish for a removed repository.

The tracker-specific live-access guard now runs before returning credentials, on refresh completion, and before recording use. It checks current organization existence/deletion, enabled/unpaused repository, active installation, commit/generation, cancellation/terminal state and review expiry. Legacy credentials are rechecked after long snapshot work as well as OAuth credentials. Failure completion validates the same parent scope; valid revoked/replaced leases remain no-ops. An expired provider response is refused. Shared general parent-consistency behavior was not changed.

`tracker-lifecycle-final-green.log`: **344 tests pass in 31 files**; `tracker-lifecycle-typecheck.log` and `tracker-lifecycle-lint.log` pass. The cleanup test executes the scheduled job through **52 tombstoned organizations**, **156 encrypted connection rows** and more than 100 temporary rows in one workspace. It verifies all continuations finish and a live workspace stays untouched (`tracker-sweep-green.log`). The sweep is indexed and bounded to 50 organizations; each tracker purge reads/deletes at most 100 temporary rows and scrubs at most 100 connections per transaction.

The hourly sweep finds committed tombstones. It cannot discover an organization row that was physically deleted without a tombstone; such a future deletion workflow must call the existing explicit purge before removing the organization row. Missing organizations now authorize no tracker read or renewal immediately. No general deletion writer was added, and no live-provider claim changed.

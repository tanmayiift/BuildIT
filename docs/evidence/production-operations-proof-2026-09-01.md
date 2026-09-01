# Production operations proof — 2026-09-01

This record contains identifiers and bounded operating results only. It does not contain source, prompts, credentials, browser state, email addresses, GitHub tokens, repository paths in telemetry, or customer identifiers.

## Exact release

- Source release: `3aa7c3bffff8cbcd96e46e3bd34cc800797b7d34`
- Documentation record: `c8af2b41896453fa35695006db4808bf131f115f`
- GitHub Build and test: run `33468305763`, passed
- GitHub Security: run `33468305761`, passed
- BuildIT web: `dpl_DUy6bGAPSh7tnnTQYh6QLek4QfdD`, Ready
- BuildIT broker: `dpl_71mjpgTJPrdoyQJuFMNwcSAivJE1`, Ready
- Convex production: `judicious-barracuda-968`
- Public alias: `https://buildit-agentic-review.vercel.app`

The later result-truthfulness release is source `18ddf41fda652c296306ed5a7371abb34d5c21e4`, Convex production `judicious-barracuda-968`, and Ready BuildIT web deployment `dpl_ASDuiwBePrVyED8ix7q5VUtJksHW`. GitHub Build and test run `33476127513` passed its browser, Node 22, and Node 24 jobs; Security run `33476127358` passed. The requested public alias was explicitly assigned to that Ready deployment and `/reviews` returned HTTP 200. It changes result classification and queue presentation only; the broker deployment is unchanged.

The public alias was explicitly reassigned to the latest Ready web deployment after the documentation release. `/reviews` returned HTTP 200.

The later processing-region disclosure release is source `1f3a686202c89982f9575f44536fb6bbff92e061`, GitHub Security run `33480544749`, Build/Test run `33480544750`, and Ready web deployment `dpl_3yQcfTdHfoL5gtkGhmAUrj6mVZxN`. The public alias was explicitly assigned to it and returned HTTP 200. Its public data page and a freshly authenticated owner permission receipt both state the exact split: encrypted source artifacts stay in AWS Ireland, while isolated repository checks run in Paris, France.

## Review outcome proof

The production queue was refreshed in an authenticated browser after the result-truthfulness release. It showed one current result for the controlled public fixture and grouped 13 other attempts into the audit trail. The current result was `Changes needed`, not `Platform failed`. It named the failed required check as the reason, preserved exact head `682805e`, and explained that the latest retry stopped while the code decision remained visible. The screenshot is retained locally and contains no source, credential, or browser-session data.

The current review completed at the pinned head commit. Its authenticated detail page showed:

- three evidence-gated findings;
- seven check executions, including one failed required test;
- a human action required before merge;
- a GitHub link to the report at the exact pull request; and
- no BuildIT merge or code edit.

The completed Anthropic run used `claude-sonnet-4-6`, consumed `$1.0371` under a `$2.00` ceiling, and identified the seeded excess-tax regression plus the failing head test. This is one finding-quality demonstration, not an accuracy rate.

One preceding Anthropic run reached all six typed model stages and then failed during finding persistence because the production finding-fingerprint setting was absent. The setting was added before the successful retry. Earlier Gemini attempts stopped before a code decision because the provider/model path was unavailable or rate-limited.

## CLI parity and bounded Autofix proof

The production CLI status command read the exact same GitHub check at the same head commit and returned `action_required` with the completed BuildIT check and its details link.

An explicit-provider CLI review then ran the deployed Anthropic path at that exact head under a `$2.00` ceiling. It completed the six typed review stages, spent `$0.97884`, found the same seeded excess-tax regression and failed head test, and published the GitHub result without changing or merging code. This proves web/GitHub/CLI finding and status parity on one controlled fixture; it is not a statistical accuracy result.

A separately consented CLI Autofix ran under its own `$2.00` ceiling and spent `$0.92127`. It completed the six typed analysis stages but made zero patch attempts and zero rounds because all high-risk model findings remained uncertain when no separately approved Claude critic model was available. No branch, commit, stacked pull request, or merge was created. Source `18ddf41` now treats this outcome as a normal deterministic failed-check handoff instead of a platform outage. The queue preserves the earlier real code decision while keeping the stopped attempt in the audit log. A successful candidate/rollback/three-round live path remains open.

## Two-user isolation proof

Two independent signed-in GitHub identities were tested against the current production alias. For each identity:

- its own organization and selected repository were visible;
- the other identity's organization, repository, login, and review were absent from repository, review, setup, metrics, usage, and audit surfaces; and
- direct navigation to the other identity's review returned the no-fallback access-denied state.

The second identity's own review remains blocked at model-provider setup. A symmetric pair of completed model reviews is therefore still open.

## Monitoring proof

The isolated Grafana folder `buildit` was updated without modifying Orbit resources.

- Dashboard `buildit-overview` is at version 3 with 14 product, accuracy, reliability, provider, runner, artifact, delivery, security, cost, and capacity panels. Its datasource is a selectable Prometheus variable; this Cloud copy is pinned to the stack's real `grafanacloud-prom` datasource rather than the nonexistent earlier `buildit-prometheus` UID.
- Twelve BuildIT alert rules are present in the BuildIT folder/group.
- Production queries display all seven fixed, source-free snapshot measurements: active reviews, budget stops, capacity utilization, effective LOC delivered, expired artifact backlog, hourly model cost, and queue depth.
- A 24-hour production range query returned retained successful `github.check` and `github.comment` series, each with 23 samples and counter value 1. This proves the deployed review worker emitted both side-effect signals.
- A controlled unsupported webhook command produced the bounded `webhook.process / blocked` series without a model call, code change, or GitHub write.
- A separate `BuildIT alerts (Tanmay)` email contact point exists, and all 12 BuildIT rules route directly to it. Orbit's notification policy was not edited.
- On 2026-09-01 the contact page loaded normally and Grafana reported `Test notification sent successfully`, proving accepted dispatch.
- The BuildIT-only OTLP credential was rotated to one stack-scoped token with a 90-day expiry. Secret stdin updates changed only the dedicated BuildIT web and broker Vercel projects. Ready deployments `dpl_F3z7UgXuAHbBKQ43SGrwEYhR7kyb` and `dpl_6ifVhkKFuW8aQh5vacGJbnvoDZKN` activated it.
- Three controlled production credential preflights returned HTTP 204. Visible Grafana Explore then showed a last-five-minute BuildIT operation increase of exactly `3`. Both older BuildIT tokens were revoked; one non-expired token remains. Orbit resources and credentials were not changed.

Grafana email is an operator alert channel, not a customer review-notification channel. Its twelve summaries use fixed global BuildIT operation/measurement labels only. The telemetry API rejects organization, tenant, workspace, repository, pull request, review, user, member, email, owner, source, prompt, finding, credential, and token fields before export. Therefore the operator contact may learn that a global service boundary is failing, but it cannot receive a customer's review identity or content through this path.

## Customer email recipient boundary

Customer review email is not connected in this release, so no signed-in member or GitHub installation owner currently receives it. The Notifications screen reports `Not connected`; GitHub checks and the tenant-authorized dashboard are the live customer channels.

Before a future email can be sent, BuildIT's internal recipient resolver requires the exact organization, repository, and user IDs; active membership; a separately verified current BuildIT email; timestamped opt-in inside that organization; and an unmuted enabled repository. It returns no recipient after membership removal, verification removal, consent removal, repository muting, or a cross-organization substitution. Neither preferences nor notification records store the plaintext address, and recipient selection never reads the GitHub App installation account.

## GitHub App key state

GitHub now reports one App private key and one OAuth client secret. The final ignored local private key is mode `0600`, is loaded into Convex production through stdin-only transport, authenticates the expected App, and reads only the three repositories selected across the two controlled installations. The obsolete local key was irreversibly deleted.

The OAuth client secret was rotated from GitHub's visible App settings directly into Convex without printing or local persistence. A fresh visible sign-out/sign-in flow returned to the authenticated owner account. The first generated private key was revoked immediately after an unsafe CLI diagnostic echoed it; the exposed value and its local file were deleted and never used as the final runtime key. The broker and web project do not receive the App private key because they do not perform App authentication. No key, OAuth secret, session token, or installation token was committed or stored in product data.

## Provider credential revocation proof

After the final authorized Anthropic run, the authenticated owner revoked exactly the saved Anthropic test credential. The saved row changed to `Revoked`, its control became disabled, and the normal dashboard provider selector exposed only the separate valid Gemini credential.

Source-free counts for the controlled public pull request were captured before and after a revoked-Anthropic attempt. Both snapshots contained exactly 14 review records, 31 model-stage records, 154 check records, 44 encrypted artifact references, and 5 GitHub side-effect records. No review, source artifact, model stage, runner check, or GitHub write was created after revocation. Production repository execution was verified at exact value `false` after the test. No raw key, session token, or browser storage was read.

## Honest verdict

The product has performed real evidence-backed web and CLI code reviews in production and correctly failed closed when Autofix lacked an independently accepted finding. It has not yet delivered a tested Autofix branch and is not ready for a broad launch or a `>95% accuracy` claim. The remaining evidence requires qualified blind human labels, a second tenant's independently consented model run, a bounded live Autofix candidate and stacked-PR handoff, and design-partner sessions.

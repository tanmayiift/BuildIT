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

The public alias was explicitly reassigned to the latest Ready web deployment after the documentation release. `/reviews` returned HTTP 200.

## Review outcome proof

The production queue was refreshed in an authenticated browser. It showed one current result for the controlled public fixture and grouped 10 earlier attempts into the audit trail. The current result was `Changes needed`, not `Platform failed`.

The current review completed at the pinned head commit. Its authenticated detail page showed:

- three evidence-gated findings;
- seven check executions, including one failed required test;
- a human action required before merge;
- a GitHub link to the report at the exact pull request; and
- no BuildIT merge or code edit.

The completed Anthropic run used `claude-sonnet-4-6`, consumed `$1.0371` under a `$2.00` ceiling, and identified the seeded excess-tax regression plus the failing head test. This is one finding-quality demonstration, not an accuracy rate.

One preceding Anthropic run reached all six typed model stages and then failed during finding persistence because the production finding-fingerprint setting was absent. The setting was added before the successful retry. Earlier Gemini attempts stopped before a code decision because the provider/model path was unavailable or rate-limited.

## CLI parity proof

The production CLI status command read the exact same GitHub check at the same head commit and returned `action_required` with the completed BuildIT check and its details link. This proves web/GitHub/CLI result-status parity without a second provider call. It does not yet prove a CLI-triggered live model run or live CLI Autofix.

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

Grafana's current receiver test endpoint returned HTTP 500 with an empty object, and the contact-point screen remained stuck on `Loading`. No delivery receipt exists. Alert delivery must remain open until Grafana accepts a test and a human confirms receipt.

## GitHub App key state

The ignored local replacement key is mode `0600`. Its public fingerprint matches one of the two GitHub App keys currently displayed. It authenticated the expected App, minted an installation-scoped token, and read metadata from the selected controlled repository. The older displayed key has not been deleted because GitHub redirects the delete action to owner password confirmation. No key or token was printed, committed, or stored in product data.

## Honest verdict

The product has performed a real evidence-backed code review in production. It is not ready for a broad launch or a `>95% accuracy` claim. The remaining evidence requires qualified blind human labels, a second tenant's independently consented model run, bounded live Autofix and stacked-PR handoff, GitHub owner confirmation for old-key deletion, accepted alert delivery, and design-partner sessions.

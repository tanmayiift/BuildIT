# BuildIT connected test readiness

Observed: 2026-09-14T05:15:35.144089+00:00. This preflight made no paid provider calls, sandbox creations, GitHub writes, deployments, or production database mutations. Identifiers and sanitized measurements are in `connected-e2e-readiness.json` (private file mode 0600).

## Verified connections and limits

- GitHub App 4762718 (`buildit-agentic-review`) currently has selected-repository access to `tanmayiift/BuildIT` through installation 157557707. Both the installation and repository-installation GETs returned 200. It is unsuspended and has the required contents/checks/pull-request write permissions. Authentication used the existing BuildIT App key only in memory; no installation token or persistent secret was created.
- BuildIT repository `nd7cf3e0retp5170jbcpqpz7dh8djy59` is enabled, unpaused, manual-trigger by default, stacked Autofix enabled, and concurrency 1. Its workspace has concurrency 14; the read found no unfinished reviews in that workspace.
- OpenAI and Gemini have workspace-scoped saved valid credentials. Anthropic is revoked. Last validation is September 1 for OpenAI and August 31 for Gemini; neither current key validity nor provider credit was checked with a model request. OpenAI's preferred source route is gpt-5.4-mini, with stronger gpt-5.4 used by the findings chain; selecting OpenAI does not mean every stage uses Mini.
- Production execution is enabled and all required runtime variable names exist. Local root and web env files instead point to the BuildIT development deployment; a local UI run without the dedicated harness configuration would not test production.
- September's complete bounded ledger read returned 866 rows and $30.2417608125 recorded estimate against a $50 monthly limit. This agrees with the old aggregate after rounding. It is not a complete provider bill: historical missing charges cannot be reconstructed. The 155 sandbox rows explicitly carry zero cost, and no new `usageMonths` row exists yet.

## Current blockers and historical evidence

Production rejects the new `reviews.by_repo_created` index. Deploy the agreed broker-compatible release, then Convex schema/functions, then the web release; verify the actual serving commit/protocol and prepare the supported bounded accounting reconciliation. Do not infer readiness from the source tests alone.

Sandbox entitlement is unverified today. The existing September 4 support ticket describes a paid Pro team rejected with a Hobby quota error, but this is historical evidence. The monitoring worker's fresh Vercel API attempts are blocked by an expired token and failed renewal. A successful fresh capacity read and controlled sandbox start are still required.

The latest stored review of BuildIT itself is PR 46 on September 4: context completed, then `workflow_failed`, with no model-stage/check rows. An earlier September 3 PR 31 review ran five model stages but finished inconclusive because a required check was missing. These explain previous real failures; they are not fresh reproductions against the repairs.

Only PR 53 is open: a Dependabot one-line workflow cache-version change. It has passing GitHub CI checks but no BuildIT check/comment. It can prove the normal trigger/publication path, but cannot establish defect detection or Autofix. Prepare a dedicated draft PR within BuildIT, based on the repaired released commit, containing a small controlled defect and an expected assertion; keep any resulting fix on a separate BuildIT branch/PR. Root coordinates those writes.

## Proposed total $10 test envelope

Root is the sole paid-run coordinator. Reserve **$6 for model usage, $2 for infrastructure, and $2 as unspent uncertainty margin**. This is a proposed conservative operating envelope, not a verified all-service billing cap. Vercel charges sandbox CPU, memory, creations and transfer separately; broker functions also have their own charges ([Sandbox pricing](https://vercel.com/docs/sandbox/pricing), [Functions pricing](https://vercel.com/docs/functions/usage-and-pricing)). Confirm current BuildIT-region prices and billing visibility before claiming an absolute total.

1. Finish release checks and reconciliation, capture the baseline, verify no older in-flight reservations or unknown calls, and record the one controlled PR head. Do not increase concurrency or switch the repository to automatic review.
2. Start one manual OpenAI review with the smallest usable chosen limit ($1 first, or $2 if its bounded context estimate requires it). Before dispatch, earmark **twice that limit**: the automatic fallback child inherits the full review limit and starts with zero consumed. Count both parent and child, all broker retries, reserved and unknown calls toward this session. Never treat failed, cancelled or unpublished calls as free.
3. Wait for the whole parent/fallback chain to settle before another command. Confirm actual head, status, checks, report, provider request identity, invocation ledger, Usage figures, metrics, and artifact access. If any charge is unknown, stop new paid work and preserve its reservation.
4. Ask one short question only after a valid completed report exists; it shares the review's budget and uses at most 700 output tokens. Check one answer and one accounted invocation. Stop if the head changed, the report is unavailable, or budget is exhausted.
5. Use remaining model allocation for one explicitly bounded Autofix or second-provider run, reserving both the top-level and possible fallback limits before dispatch. Autofix can run up to three rounds and may create extra sandboxes; do not assume it costs one execution. Omit optional extra runs if their full maximum allocation would exceed $6 including committed/reserved/unknown amounts.
6. Track sandbox IDs, starts/stops, fixed two-vCPU allocation, wall-time bound (source maximum 700 seconds per sandbox), and broker requests. The 155 old zero-priced sandbox ledger rows are not spend proof. Read current billing/usage after the run and stop before using the infrastructure/uncertainty allocations. Do not replay workflows to obtain a green label.

A strict $10 guarantee is not yet established because current sandbox billing access is unavailable and provider bills may settle later. The connected run must remain blocked until root has verified the missing capacity/accounting prerequisites or applies an enforceable BuildIT-scoped spending control. No unrelated project is part of this plan.


## Local accounting repair after this preflight

The fallback budget reset identified above is now fixed in local source; see `fallback-budget-implementation.md`. After that source/schema/protocol is deployed, one top-level review and its automatic fallback share the original limit, so the old instruction to reserve twice the cap no longer describes the repaired admission rule. Confirm the serving release, then use `modelAccounting:reviewSnapshot` before and after each step. The $10 test plan still needs a separate allowance for infrastructure and unresolved billing. The earlier deployment observations remain a timestamped record, not a statement of current deployment state.

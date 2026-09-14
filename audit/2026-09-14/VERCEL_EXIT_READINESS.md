# BuildIT Vercel exit readiness — 2026-09-14

Cancellation of the BuildIT Vercel subscription is **not approved by this audit**.

The dedicated `buildit-agentic-review` team is on Pro and still reads **Pro Plan · Active**. Its billing page shows the 2026-09-05 through 2026-10-04 cycle, $3.75 of the $20 included credit used, and a $20 upcoming invoice. The active BuildIT projects are `buildit-agentic-review` (web) and `buildit-content-broker` (broker). The duplicate `pulsetrade/backend-vercel` Git connection to BuildIT was removed after reproducing its failed `dist` output check; that project and its old deployment were preserved.

The current broker route is configured for an 800-second function duration and the runner allows a 700-second sandbox workload. Vercel's current documentation makes Sandbox available on Hobby, but caps a Hobby session at 45 minutes; the decisive incompatibility here is the broker's 800-second HTTP function ceiling, while Hobby permits at most 300 seconds. Hobby is also restricted to personal, non-commercial use. No migration to another runner or host has been deployed or proven.

Sandbox is a live production dependency, not an optional add-on. `packages/broker/src/execution-http.ts`, `convex/reviewValidationWorker.ts`, and `convex/reviewAutofixWorker.ts` all rely on `@vercel/sandbox` for isolated base/head execution, scanners, diagnostics, artifacts, publication gating, and Autofix safety evidence. Removing it before an equivalent executor is deployed leaves execution-backed reviews unavailable or partial and removes the evidence needed to publish findings safely. The detailed dependency and replacement checklist is recorded in `audit/evidence/vercel-sandbox-removal-impact-2026-09-14.json`.

The actionable exit path is to keep Pro until one of these is completed and tested on the exact BuildIT production aliases:

1. Move broker execution to a host with at least the current timeout, sandbox isolation, encrypted artifact access, and AWS/Vercel trust guarantees; run review, Ask, Autofix, cancellation, retry, publication-failure, and stale-commit checks there.
2. Redesign execution to fit a lower timeout and remove or replace the Vercel Sandbox dependency; prove the full workflow and cost/accounting behavior before downgrading.

Until a replacement is deployed and the signed-out, owner, viewer, and failure journeys pass against production, canceling Vercel can time out long reviews or violate the product's commercial/runtime requirements. The audit therefore cannot confirm that it is safe to cancel the subscription.

References: [Vercel Function limits](https://vercel.com/docs/functions/limitations), [Vercel Sandbox](https://vercel.com/docs/sandbox), and [Hobby plan](https://vercel.com/docs/plans/hobby).

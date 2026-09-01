# BuildIT release validation — 2026-09-01

Exact source commit: `3aa7c3bffff8cbcd96e46e3bd34cc800797b7d34`

Verdict: **not ready for broad customer launch or an accuracy claim**.

BuildIT now performs a genuine evidence-backed review on a controlled public pull request: it pins the exact commits, gathers context, runs base and head checks in the isolated runner, sends typed stages through the model and critic path, publishes cited findings to GitHub, and leaves merge authority with a person. One explicit-consent Anthropic run found the seeded excess-tax regression and the failing head test. It did not edit or merge code. This proves the core review path can work; it is not a measured success rate.

## Exact production release

- GitHub: Build and test run `33468305763` and Security run `33468305761` passed for the exact source commit.
- Web: dedicated BuildIT project deployment `dpl_D7KopzzbkV8Fd88rXtQGXeW2LKs8` is Ready. `https://buildit-agentic-review.vercel.app/reviews` returns HTTP 200. Rollback: `dpl_Bq7QD11npRVtHv2y5uQfA37vCDec`.
- Broker: dedicated BuildIT project deployment `dpl_71mjpgTJPrdoyQJuFMNwcSAivJE1` is Ready in Dublin. Health returns 200; unsigned model, execution, and telemetry requests return 401. Rollback: `dpl_4qojqN198BWjcZUbRwsB9cXokvTD`.
- State worker: matching Convex production `judicious-barracuda-968` is deployed with the new indexes and five-minute operating snapshot.
- Monitoring transport: a direct production worker invocation delivered all seven fixed anonymous measurements. The broker accepts no customer, repository, source, prompt, credential, or unbounded identifier in that event.

## Verified product behavior

- The public fixture review was bound to head `682805eaf9a3e813d400ba1fac7e3a0799f63f42`.
- The runner produced paired base/head evidence across seven grouped check types and retained encrypted detailed output.
- The Anthropic report used `claude-sonnet-4-6`, recorded `$1.0371` provider cost, found the known regression, and published a GitHub check and comment.
- The web queue now shows one current result per repository, pull request, and exact commit. Service failures are shown as retries, not code decisions.
- Review feedback includes a safe file/line reference, why the issue matters, and what a person should inspect. Review-only output is never called an applied fix.
- The merge boundary remains absolute: BuildIT has no merge action and the run made no branch or code change.

## Current engineering checks

- Tracked-file safety inspected the committed tree.
- Lint and all workspace plus Convex types pass.
- 582 tests across 94 files pass.
- Every production build passes.
- The web and broker Vercel deployments are Ready on the exact commit.
- The expanded dashboard and alert definitions are tested in source. Production accepted the new measurements, but Grafana Cloud provisioning and notification delivery still need an administrator-authorized session.

## Still required

1. Run the remaining public/private, web/CLI, Gemini, neutral-change, and Autofix matrix with explicit user consent and bounded provider spend.
2. Prove saved-key revocation and the expected refusal after revocation.
3. Have each of two independently controlled GitHub users complete one real review, then rerun the cross-workspace denial harness.
4. Have qualified reviewers create blind labels before model output, double-review Critical cases, adjudicate disagreement, and compute confidence ranges. Do not claim 95% before this passes.
5. Have BuildIT review its own delivery pull request and produce one human-inspected stacked pull request without merging it.
6. Provision the expanded BuildIT-only Grafana dashboard/rules and deliver one test alert through a BuildIT-only contact point without changing Orbit.
7. Identify and delete the three older GitHub App private keys only after proving which new key is active. Do not guess.
8. Approve and disclose Paris runner processing while encrypted artifact storage remains in Ireland.
9. Run 3–10 observed design-partner sessions before broad launch positioning. Independent penetration testing and formal compliance evidence are separate external work and must not be claimed before they exist.

## Safety statement

BuildIT fails closed. Missing or stale evidence, unavailable providers or runners, cancellation, budget/round limits, unsupported context, or failed required checks cannot become “ready to merge.” A human alone may merge.

## Guides

- Web: `docs/guides/web-launch-guide.md`
- CLI: `docs/guides/cli-launch-guide.md`

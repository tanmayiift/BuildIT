# CI gates: what runs, what blocks, and what only warns

Written because this repository spent weeks believing it had gates it did not have.

## `main` is protected

Until 5 September 2026, `gh api repos/:owner/:repo/branches/main/protection` returned
**404 Branch not protected** and the ruleset list was empty. `verify`, `security:release`,
`reliability:release`, `eval` and `alerts:check` all ran on every push and **none of them blocked a
merge**. An audit that fails is only a gate if something acts on it.

Required now on `main`: `quality (22)`, `quality (24)`, `release-gates`, `browser`, `secret-scan`,
`tracked-files`. Force pushes and branch deletion are refused.

`enforce_admins` is deliberately **off**: enabling it also blocks the release automation, which
pushes to `main` directly. Anyone merging a pull request still has to pass every check.

```bash
gh api repos/:owner/:repo/branches/main/protection
```

## Gates that block

| Gate | What it catches |
| --- | --- |
| `pnpm verify` | lint, typecheck, regression tests, build |
| `pnpm security:release` | tenant isolation, authorization declarations, data classification |
| `pnpm reliability:release` | durable workflow bounds, stale-commit handling |
| `pnpm eval` | the graders, scorers and release-gate thresholds |
| `pnpm alerts:check` | every alert rule has a severity, an action, and a runbook section that exists |
| `pnpm dashboard:check` | the dashboard pins the served datasource and declares no template variables |
| `pnpm test:e2e` | signed-out journeys and release screenshots at 375px and 1440px |

## Required live evidence

These checks fail when credentials or required evidence are missing. Offline definition checks
remain available, but their success does not certify deployed infrastructure.

| Gate | Needs | Evidence |
| --- | --- | --- |
| `pnpm alerts:verify` | `BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN` with alert/folder read and datasource query access | Matching current rules, no legacy duplicates, and a scheduled snapshot within 15 minutes |
| `pnpm release:wiring` | `BUILDIT_EXPECTED_CONVEX_URL` | Pinned BuildIT web/broker health responses identify this deployment and its public query API responds |
| `pnpm smoke:aws-boundary` | BuildIT AWS read credentials + `BUILDIT_AWS_STACK` | Observed encryption, public-access block, object versions, retention and key rotation |

The AWS subprocess forwards a narrow authentication environment, including temporary session tokens
and profile paths; it does not print credential values. This check does not yet verify every IAM
trust-policy condition or the inventory bucket. Those remain separate deployment review items.

`node scripts/provision-buildit-grafana-alerts.mjs --report` is read-only. It lists only recognized
legacy BuildIT rules as cleanup candidates, with exact UIDs and content fingerprints. A report does
not authorize deletion. Unknown rules are retained and reported. See
[Grafana reconciliation](grafana-reconciliation.md) for the approval and verification sequence.

## The trap this file exists to prevent

`alerts:check` passed on every push for weeks while the deployed Grafana rules were the ones
hand-built in the UI months earlier — three of which sent 54 emails in one night with their
corrected versions sitting in this repository, validated and green.

Validation that cannot see the running system is a spell-check. When adding a config file that
describes infrastructure, add the check that reads the real thing back in the same commit, or write
down here that you did not.

## Why the AWS boundary check warns instead of failing

I argued the other way earlier in this repository's history, and the evidence changed my mind.

The reasoning for hard-failing is sound: *"we could not check"* is not *"it matches"*, and a gate
that goes green on the first is how the Grafana rules drifted for weeks behind a passing check. On
that basis the step was set to `exit 1` when no credentials are present.

What that produced, measured: **the check has never once run.** No AWS credentials have ever been
configured, so every push to `main` failed `release-gates`, every push sent a failure email, and the
drift it exists to catch was never checked on any of them. It delivered zero protection and weeks of
noise — and a build that is red for a reason no commit can address teaches people to stop reading
red builds, which costs more than the thing it was guarding.

So: a missing credential is a GitHub **warning annotation** — visible on the run, not a failure.
Drift with credentials present is still a hard failure, which is the case the check was written for.
The moment `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `BUILDIT_AWS_REGION` (`eu-west-1`) and
`BUILDIT_AWS_STACK` exist as repository secrets, this becomes the gate it was meant to be.

The honest cost: until then, `infra/aws/artifacts.yaml` — the KMS key, the OIDC trust scoping, the
7-day retention backstop, the Ireland-only assertion — is unverified against the live stack, and
that is recorded here rather than implied by a green tick.

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
| `pnpm verify` | lint, typecheck, 1,465 tests, build |
| `pnpm security:release` | tenant isolation, authorization declarations, data classification |
| `pnpm reliability:release` | durable workflow bounds, stale-commit handling |
| `pnpm eval` | the graders, scorers and release-gate thresholds |
| `pnpm alerts:check` | every alert rule has a severity, an action, and a runbook section that exists |
| `pnpm dashboard:check` | the dashboard pins the served datasource and declares no template variables |
| `pnpm test:e2e` | signed-out journeys and release screenshots at 375px and 1440px |

## Gates that warn and pass when a credential is missing

Three checks compare this repository against live infrastructure. Each one **fails on drift** and
**warns loudly, exit 0, when the credential that would let it look is absent**.

| Gate | Needs | Silent without it |
| --- | --- | --- |
| `pnpm alerts:verify` | `BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN` | whether the deployed alert rules match `observability/alerts.yml` |
| `pnpm release:wiring` | `BUILDIT_{WEB,BROKER,EXPECTED}_CONVEX_URL` | whether web and broker point at the same Convex deployment |
| `pnpm smoke:aws-boundary` | AWS credentials + `BUILDIT_AWS_STACK` | whether the live KMS key, OIDC trust scoping and 7-day retention match `infra/aws/artifacts.yaml` |

**Why they do not fail.** A missing credential is a setup task no commit can fix. A build that goes
red for one stays red for every push by everyone, and people learn to stop reading red builds —
the same habit the 54 alert emails from undeployed rules taught. Drift is the thing worth blocking
a merge over, and drift still does.

**The cost of that choice** is that a warning is easy to miss, so the state each one cannot check is
named in the table above. Setting any of those credentials converts that row from a warning into a
gate, with no code change.

## The trap this file exists to prevent

`alerts:check` passed on every push for weeks while the deployed Grafana rules were the ones
hand-built in the UI months earlier — three of which sent 54 emails in one night with their
corrected versions sitting in this repository, validated and green.

Validation that cannot see the running system is a spell-check. When adding a config file that
describes infrastructure, add the check that reads the real thing back in the same commit, or write
down here that you did not.

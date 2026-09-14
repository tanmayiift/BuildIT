# BuildIT production access preflight — 2026-09-14

Scope: the two dedicated BuildIT Vercel projects, BuildIT Convex `judicious-barracuda-968`, and the approved Grafana stack. No deployments, sandbox creation, paid model calls, database changes, or other project reads were performed by this worker. Existing account login renewal was attempted; no new API token or persistent permission grant was created.

## Confirmed

- Saved project links match web `prj_rU8IPaf1laMTTmQEhGun9mRxXmGA`, broker `prj_tacCioktOE1TKZwHcq0Hxu9VYOU0`, and team `team_0C3dsIfWxzBINeWinBvtOLMC`.
- An authenticated Vercel CLI web project read returned the dedicated project, root `apps/web`, Node 24.x. Its overall command failed while writing the CLI update cache; subsequent existing-session refresh failed. The initial read is not complete deployment or billing verification.
- Existing Convex CLI authorization works. `production-convex-target-live.json` verifies the exact production name, type and URL through the installed CLI's production authorization endpoint. No credential is present in that report.
- `production-access-convex.json` contains complete bounded database counts and worker queues (limit 2,000 + one extra record per table). Its application snapshot has 193 reviews, no running review status, 16 enabled/unpaused repositories, 2 organizations and 872 ledger rows. The review and nested workflow pools have no running, queued, completing or cancelling jobs. The workflow component has 191 terminal workflows and zero running steps. These are time-stamped observations, not an ingress lock.
- `production-public-health.json`: current web `/api/health` returns 404; broker returns 200 at commit `e9dc368b4f4919e9377d73c744680c731643a6fa`, without new deployment-host metadata. Prepared health repairs are not live yet.

## Access blockers and cautions

- The saved Vercel access token is expired. Pinned API project reads return 403 forbidden. Supported login refresh with a writable isolated CLI config confirms the saved session is no longer usable. A fresh device login is pending in the same signed-in account; the parent is handling the official approval UI. Do not force disabled approval controls or treat a pending login as restored access. No fresh sandbox entitlement, billing allowance, production alias, or Vercel production environment list has been verified.
- No Grafana read token exists in the shell, repo environment files, or production Convex environment names. Worker computer-use inventory exposes no browsers. Actual Grafana freshness and native API fingerprints remain unknown; previous UI exports prove definitions only.
- Root and web `.env.local` select BuildIT development `tacit-coyote-455`. The prepared source guard now prevents those selectors and unapproved deploy keys from steering coordinated release.
- A repository's `pausedAt` is not a complete legacy paid-work freeze: old Autofix and some webhook paths check `enabled` without checking `pausedAt`. No repository policy was changed. Before release, root must establish the exact approved ingress freeze and repeat queue checks; a zero queue snapshot alone does not prevent a new request arriving. Do not cancel jobs just to make counts zero.

## Exact commands ready for review

Use the supported Node 24 runtime and run from the BuildIT root. Commands below do not include credentials.

```bash
# Read the exact server target; no deployment or credential output.
node --input-type=module -e 'import {verifyConvexProductionTarget} from "./scripts/lib/convex-production-target.mjs"; console.log(JSON.stringify(await verifyConvexProductionTarget(), null, 2));'

# Repeat scoped read-only queue and environment-name evidence.
python3 .local/production-preflight/read-convex.py

# Offline build/link checks; no deployment.
pnpm deploy:check

# Only after root confirms immutable source, access, ingress freeze, and release gates:
pnpm deploy:production

# When an existing Grafana read credential is restored in the environment:
node scripts/provision-buildit-grafana-alerts.mjs --report > .local/buildit-grafana-reconciliation.json
```

The coordinated release now checks Convex target identity before any deployment and again after the broker is verified. All nested commands get the sanitized production selector. Regression evidence: `deployment-target-red.log` fails against the previous unpinned command; `deployment-target-green.log` has 48 passing checks; targeted ESLint passes. Tests cover unrelated/dev/preview keys, inherited self-hosted and provision-host overrides, changed server defaults, missing authorization, malformed responses, and keeping credentials out of errors/results.

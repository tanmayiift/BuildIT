# Feature flags: what exists, where each one lives, and how to flip it

Written because neither of these was documented anywhere. `BUILDIT_UNTRUSTED_EXECUTION_ENABLED` has
gated every review since the project started and no runbook, no README and no deployment script
mentioned it — the only record that it exists in production is a captured `convex env list` in
`audit/evidence/production-access-convex.json`. A flag nobody can find is a flag nobody can turn off
in the hour it matters.

Both fail closed: the value must be exactly `true`. `"TRUE"`, `"True"`, `"1"`, `"yes"` and `""` all
mean off, and each is covered by a test. A flag that guesses at intent cannot be reasoned about from
an env listing.

## `BUILDIT_UNTRUSTED_EXECUTION_ENABLED` — may BuildIT run customer code at all

| | |
| --- | --- |
| Read by | `convex/lib/executionGate.ts` |
| Lives in | **Convex** env, deployment `judicious-barracuda-968` |
| Enforced at | `convex/dashboardReviews.ts` (`start`) and `convex/githubWebhookProcessor.ts`, first statement in both |
| Refusal | `repository_execution_safety_blocked` |
| Redeploy needed | **No.** Convex reads it per invocation |

```bash
pnpm exec convex env set BUILDIT_UNTRUSTED_EXECUTION_ENABLED true --prod
```

Verify: `pnpm exec convex env list --prod`, then sign in and confirm the review button is no longer
labelled *"Review execution safety-blocked"* — the UI reads the value live through
`runtimeReadiness:current`.

## `NEXT_PUBLIC_BUILDIT_PUBLIC_DEMO_ENABLED` — is the open scan offered to strangers

Off by default, which is the state that ships. Turn it on for a demo; turn it off after.

| | |
| --- | --- |
| Read by | `apps/web/src/app/public-demo-gate.ts` |
| Lives in | **Vercel**, project `buildit-agentic-review` (the web app) |
| Gates | `/api/scan` (404 `demo_closed`), the `ScanPanel` on `/`, `/features` and `/sandbox`, the "Try a scan" nav entry, and the `/proof` link |
| Redeploy needed | **Yes** — see below |

```bash
vercel env add NEXT_PUBLIC_BUILDIT_PUBLIC_DEMO_ENABLED production   # value: true
pnpm deploy:production
```

**Why this one needs a redeploy and the other does not.** `NEXT_PUBLIC_` variables are inlined into
the client bundle at build time. The prefix is not decoration: `public-shell.tsx` (the nav, header
*and* footer from one array) and `proof/page.tsx` are client components and cannot read a
server-only variable. One variable both sides read beats a server flag plus a mirrored client flag
that can silently disagree about whether the demo is open.

For the same reason the default value in `publicDemoEnabled()` is written as a literal property
access rather than `process.env[PUBLIC_DEMO_ENV]`. Next only inlines the variable where it can see
the exact access at build time; a dynamic index compiles to `undefined` in the browser, and the nav
entry would never appear however the variable was set.

**What stays true when it is off**, because none of it should depend on a demo being open:

- `/sandbox` still answers **200**. It stays in `publicRoutes`, so the Edge proxy, `route-map.ts`
  and the three suites that assert the route table agrees with itself keep agreeing. The page shows
  a short closed state and **keeps both call-to-action buttons** — the onboarding journey reaches
  setup through that page, so a closed demo must not be a dead end.
- The landing hero keeps its slot and copy, with the panel replaced rather than removed. The panel
  posts to `/api/scan`; leaving it rendered against a 404 would put a guaranteed error in the first
  thing a stranger sees.
- The `/features` lede changes with it. It promised *"this page starts by doing it"*, which stops
  being true the moment the control below it is gated.

## Verifying a flip of the demo flag

```bash
pnpm test:e2e                 # the suite pins the flag ON - it describes the demo as demonstrated
pnpm test:e2e:demo-closed     # the shipping default: coherent site, no dead links, /sandbox 200
```

The second exists because the main suite pins the flag on, so without it the default that actually
ships would never be exercised end to end.

Against production:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://buildit-agentic-review.vercel.app/sandbox   # 200 either way
curl -s -X POST https://buildit-agentic-review.vercel.app/api/scan \
  -H 'content-type: application/json' -d '{"files":[{"path":"a.ts","content":"const a = 1;"}]}'
# closed -> {"error":"demo_closed"} with 404;  open -> findings, and `ran` / `didNotRun`
```

## What is *not* a flag, and should not become one

**BYOK.** There is no platform model key and no way to add one by accident:
`providerCredentials.organizationId` is required, so a credential belonging to nobody is not
representable, and the broker only ever decrypts a credential a caller named. An organization with
no key of its own already cannot start a review — the dashboard disables the button and the webhook
path blocks the review with `provider_credential_invalid` / `reconnect_provider`.

`tests/architecture/byok-only.test.ts` asserts all of that, because the property was true and
unprotected: a platform key would have arrived as an ordinary convenience — one env var, in one
worker, to unblock one demo — and every existing read path would have kept compiling.

## Turning the Grafana drift check into a real gate

Everything except the token itself is done. A read-only service account exists on
`peacefulbumblebee2324.grafana.net`:

| | |
| --- | --- |
| Name | `buildit-alerts-verify` (id 19, login `sa-1-buildit-alerts-verify`) |
| Basic role | Viewer |
| Assigned | `fixed:alerting:reader`, `fixed:folders:reader`, `custom:buildit.alerts.provisioning:reader` |
| Can it write? | No. No writer role, no `alert.provisioning.secrets:read` |

**Why the custom role exists.** `fixed:alerting:reader` does *not* grant `alert.provisioning:read`,
which is what `/api/v1/provisioning/alert-rules` requires — a token with only the fixed reader role
returns 403 on the one endpoint the check depends on. The only *fixed* role that grants it is
`fixed:alerting.provisioning.secrets:reader`, which also exports decrypted contact-point secrets. A
drift check needs neither writes nor secrets, so `custom:buildit.alerts.provisioning:reader` carries
exactly one action: `alert.provisioning:read`.

### The one step left, which has to be yours

Generating the token means handling an API key in plaintext, so:

1. Open **Administration → Users and access → Service accounts → `buildit-alerts-verify`**
2. **Add service account token**, no expiry or 1 year, and copy it
3. Add it as a GitHub repository secret named `BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN`

### Then verify it immediately — do not assume it worked

The role assignment is correct as far as it can be checked without a token; Grafana's effective
permissions endpoint did not reflect the custom role when it was assigned, which is most likely a
cache. The honest way to settle it is one request:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN" \
  https://peacefulbumblebee2324.grafana.net/api/v1/provisioning/alert-rules
```

**200** — done; `pnpm alerts:verify` is now a real gate.
**403** — the custom role did not take. Add `fixed:alerting.provisioning.secrets:reader` to the
service account as a fallback and re-run. It is more access than the check needs, which is why it is
the fallback and not the default.

Then, end to end:

```bash
BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN=... pnpm alerts:verify
```

Expect it to confirm 14 active rules matching `observability/alerts.yml` and 12 legacy rules paused
— the same result checked by hand on 17 September, but now on every push.

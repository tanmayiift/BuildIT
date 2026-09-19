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

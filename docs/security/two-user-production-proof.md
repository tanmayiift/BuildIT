# Two-user production isolation proof

This needs two real GitHub identities, each controlled by a different person. Never copy one person's login
to stand in for the other's.

Run `pnpm evidence:browser`. It:

1. Opens two ordinary Chrome windows on `/sign-in`, each with a new, empty profile.
2. Waits while each person signs in to their own window. GitHub sign-in through Google works here, because
   these are real Chrome windows and not automated ones.
3. Runs `tests/e2e-production/two-user-isolation.spec.ts` for both identities and the read-only part of
   `tests/e2e-session/signed-in-journey.spec.ts` as the first. The specs run inside those windows over a
   loopback debugging port (`tests/live-browser.ts`), so no login is read, saved or printed.
4. Signs both sessions out, closes the windows, and deletes both profiles.
5. Writes `docs/evidence/browser-evidence-<UTC date>.md`. Commit it. CI warns when the newest one is
   missing, failed, or more than 14 days old.

The fixture identities default to the accounts proven on 4 October 2026. Override any of them with the
`BUILDIT_E2E_USER_*` variables. Set `CHROME_PATH` if Chrome is not in `/Applications`.

**Why there is no stored login for CI.** BuildIT's refresh tokens are single-use: Convex Auth invalidates a
session when a refresh token is replayed more than ten seconds after its first use. A login saved into a
repository secret therefore survives one token refresh, and every later run would be signed out. A saved
browser state also carries every other site's cookies, a full GitHub session among them.

The harness checks these surfaces for each identity:
- account
- repositories
- review queue
- metrics
- usage
- model credential
- audit

It then opens the other identity's review URL directly. It refuses to start unless the target uses HTTPS
and the two browsers are distinct loopback endpoints.

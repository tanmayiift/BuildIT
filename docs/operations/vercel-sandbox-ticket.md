# Vercel support ticket — Sandbox reports Hobby limits on a paid Pro team

Paste this at https://vercel.com/help (Contact Us). Everything in it is measured, not inferred.

---

**Subject:** Sandbox API returns 402 "Hobby plan usage limit exceeded" for a team on paid Pro

**Team:** `buildit-agentic-review` — `team_0C3dsIfWxzBINeWinBvtOLMC`
**Project:** `buildit-content-broker` — `prj_tacCioktOE1TKZwHcq0Hxu9VYOU0`

Every `Sandbox.create()` call from our broker fails with:

```
Status code 402 is not ok: Hobby plan usage limit exceeded.
Limit will be reset on 2026-10-01T00:00:00.000Z.
Please upgrade to a Pro plan to continue using Vercel Sandbox.
```

**The team is already on paid Pro.** `GET /v2/teams?slug=buildit-agentic-review` returns:

```
plan: pro
status: active
trial: none
cancelation: none
```

Billing shows $4.86 of $20 included credit used, $4.86 of a $200 on-demand budget, and an
upcoming invoice of $0.00 — so this is not a spend ceiling.

**The sandbox is correctly scoped to that team.** We log the OIDC claims the broker receives before
calling the Sandbox SDK:

```
owner:   team_0C3dsIfWxzBINeWinBvtOLMC
project: prj_tacCioktOE1TKZwHcq0Hxu9VYOU0
issuer:  https://oidc.vercel.com/buildit-agentic-review
```

The project's `oidcTokenConfig` is `{ "enabled": true, "issuerMode": "team" }` and its `accountId`
is the team id.

**What changed and when.** Before converting the trial to paid, the same call failed with
*"**Pro trial** plan usage limit exceeded"*. Immediately after converting, the identical call began
failing with *"**Hobby** plan usage limit exceeded"* — so the entitlement lookup moved, but to Hobby
rather than to Pro. Redeploying the project did not change it.

**What we need:** the Sandbox entitlement for `team_0C3dsIfWxzBINeWinBvtOLMC` to reflect its paid
Pro plan. Our production code review pipeline cannot execute any check until it does.

Happy to provide request ids or a deployment URL on request.

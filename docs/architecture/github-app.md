# GitHub App boundary

BuildIT uses GitHub OAuth to identify a human and GitHub App installation tokens to access repositories. A developer's personal `gh` login is never used by the production service.

## Registered development App

- Name: `BuildIT Agentic Review`
- App ID: `4762718`
- Client ID: `Iv23li1sYHKlcb0DfdI6`
- Owner: `tanmayiift`
- Homepage: `https://buildit-agentic-review.vercel.app`
- Vercel project: `pulsetrade/buildit-agentic-review` with repository root `apps/web` and production branch `main`.
- OAuth callback: `https://tacit-coyote-455.eu-west-1.convex.site/api/auth/callback/github`
- Post-install setup: `https://buildit-agentic-review.vercel.app/setup/install`
- Webhook: `https://buildit-agentic-review.vercel.app/api/github/webhooks`
- Visibility during development: installable only by the owner

App IDs and Client IDs identify an application and are not credentials. The client secret, private key, and webhook secret are credentials. They must remain in the deployment secret stores or the operator's keychain and must never be committed.

## Maximum repository permissions

The registration defines the maximum permission an installation token may receive. BuildIT mints a narrower token for each stage.

| Permission | Maximum | Why |
| --- | --- | --- |
| Metadata | Read | Resolve repository identity, collaborators, and installation access. GitHub grants this permission to every App. |
| Contents | Write | Read exact commits and, only after an authorized Autofix passes final validation, create the separate agent branch. Review-stage tokens are reduced to read. |
| Pull requests | Write | Read PR context and update one BuildIT comment or Check-linked result; create a stacked PR after validated Autofix. BuildIT cannot merge. |
| Issues | Read | Read linked GitHub Issue requirements. |
| Checks | Write | Create and update the BuildIT Check Run at the pinned commit. |

Administration and Workflows permissions are not requested. BuildIT does not request or use merge authority.

## Webhook subscriptions

| Event | Why |
| --- | --- |
| Pull request | Start, refresh, cancel, or stale a review when a PR is opened, reopened, synchronized, or closed. |
| Issue comment | Recognize authorized `@buildit review`, `autofix`, and `cancel` commands. Edited comments and bot actors are ignored. |
| Check run | Reconcile BuildIT's Check Run and avoid duplicate effects. |
| Check suite | Observe suite-level completion needed by repository policy. |
| Push | Debounce updates and detect trusted default-branch configuration changes. |
| Installation | Record creation, suspension, unsuspension, and deletion of an installation. GitHub sends this lifecycle event to Apps automatically. |
| Installation repositories | Add or revoke repository access when an owner changes the selected repositories. GitHub sends this lifecycle event to Apps automatically. |

Every delivery is untrusted until its HMAC signature is verified over the raw request bytes. The handler must durably deduplicate GitHub's delivery ID before acknowledging it.

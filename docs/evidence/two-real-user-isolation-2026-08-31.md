# Two-real-user production isolation evidence — 2026-08-31

## Scope

- Identity A authenticated through GitHub as `tanmayiift` and remained bound to `tanmayiift's workspace`.
- Identity B authenticated independently through GitHub as `smratipahwa` and remained bound to `smratipahwa's workspace`.
- The GitHub App was changed from owner-only to public through GitHub's official App settings. Identity B then authorized it through GitHub's normal OAuth flow.
- Identity B installed the App for exactly one private repository, `smratipahwa/buildit-isolation-fixture-b`. BuildIT synchronized installation `157864970` and displayed the repository as private after a fresh server-side installation claim.

No cookie, OAuth token, installation token, model key, repository source, or Grafana secret is present in this record.

## Live checks that passed

- Each account page showed only its own GitHub identity.
- Repository, review, model-key, metrics, usage, and audit surfaces disclosed neither the other workspace nor the other repository marker.
- Each repository page showed only its own selected repositories.
- Identity B's direct request for identity A's known review URL disclosed neither A's workspace nor A's repository.
- Identity B's private repository and open PR remained visible only to B through the selected GitHub App installation.

The live run exposed and corrected three false assumptions in the production Playwright harness: the account route identifies a GitHub login rather than a workspace, metrics/usage/audit do not print the workspace name when empty, and the audit route is `/audit`, not `/audit-log`.

## Remaining proof

Identity B created private PR `#1` and posted `@buildit review`, but the current production webhook/worker did not create a BuildIT review. Therefore the symmetric two-review portion of the automated harness is not claimed. It must run after the coordinated broker and Convex production rollout, using one review owned by each identity, before task 133 and blocker 135.2 can close.


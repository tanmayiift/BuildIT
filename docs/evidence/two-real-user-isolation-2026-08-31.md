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
- Identity A's direct request for identity B's known review URL disclosed neither B's workspace nor B's repository.
- Identity B's private repository and open PR remained visible only to B through the selected GitHub App installation.
- After GitHub sudo-mode verification, BuildIT claimed B's selected installation into `smratipahwa's workspace`. The repository receipt displayed only installation `157864970` and `smratipahwa/buildit-isolation-fixture-b`.
- A new `@buildit review` command on B's private PR `#1` created B's own tenant-scoped, model-key-blocked review record. B's queue showed only that record and no A workspace, repository, or review data.

The live run exposed and corrected three false assumptions in the production Playwright harness: the account route identifies a GitHub login rather than a workspace, metrics/usage/audit do not print the workspace name when empty, and the audit route is `/audit`, not `/audit-log`.

## Remaining proof

Identity B now has a real review record, but it is intentionally blocked before source read or model use because B has no independently scoped model key. The symmetric two-review portion of the automated harness is still not claimed: each identity needs a completed review result at its own exact PR head, followed by a run of the two-profile browser harness. That requires the bounded live-model release sequence and, for B, B's own approved model key or an explicit tenant-safe alternative. Tasks 133 and 135.2 remain open.

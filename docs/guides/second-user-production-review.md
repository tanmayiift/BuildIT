# Second-user production review handoff

This proof checks that two people can use BuildIT without either person seeing or using the other's workspace, repository, model key, review, or customer email settings.

## What the second person does

1. Open `https://buildit-agentic-review.vercel.app` in their own browser profile and sign in with their own GitHub identity.
2. Confirm the workspace switcher names their own workspace and that the repository list contains only repositories they selected in GitHub.
3. Open **Setup → Model key**. They choose a provider, their own repository scope, and paste their own model key directly into the password field. The owner's key must never be reused for the second person.
4. Confirm the page returns only a masked key ending, provider, scope, validation time, and last-use state. No raw key may be visible after save or page reload.
5. Open **Review queue**, choose their own repository and pull request, and preview access.
6. Read the exact base/head commits, checks, possible writes, provider, and spend ceiling. Choose the smallest ceiling that covers one bounded review, then consent and start it.
7. Inspect the evidence result and its GitHub Check. A human keeps merge authority. Do not request Autofix unless this separate test budget covers it.

## What the operator may verify

- The second review belongs to the second user's organization, repository, pull request, and exact commit.
- The provider is shown only by name and masked key ending. The operator never asks for, reads, copies, logs, or re-enters the raw key.
- The first user cannot open the second review URL, and the second user cannot open the first review URL. Both directions must show the same source-free denial without foreign names or repository data.
- Metrics, usage, audit, notification settings, and saved-key rows remain separate. Customer email is not connected; if enabled later, its recipient must be the exact verified and opted-in member in the same organization, never the GitHub App owner.
- GitHub publication lands only on the second user's selected repository. No BuildIT merge action exists.

## Evidence to retain

Record only source-free receipt data: timestamp, hashed user and organization identifiers, hashed review identifier, exact commit hash, provider name, masked key ending, spend ceiling, final decision category, GitHub Check URL, and the two cross-workspace denial results. Do not retain browser storage, session values, raw credentials, source, prompts, findings, repository names, personal email, or screenshots containing customer identifiers.

The proof is complete only after the bounded review reaches a final code decision. A successful sign-in, key save, preview, or provider failure is not a completed second-user model review.

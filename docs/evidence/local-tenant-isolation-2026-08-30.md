# Local tenant-isolation evidence — 2026-08-30

Code under test: `664becf`

## Result

The local authorization boundary passed. This is implementation evidence, not proof from two real GitHub accounts.

- 69 Convex tenant tests use independent `alice` and `bob` identities across separate organizations and repositories.
- They deny guessed foreign organization, repository, review, credential, artifact, metric, usage, export, and audit identifiers.
- They prove that one person may belong to multiple organizations without records being combined.
- Five public-function inventory checks require authentication and parent-record consistency for tenant data.
- Six credential component tests hide foreign credential data and deny non-admin key management.
- The focused run passed 80 tests in total.

No repository source, credential, session value, or customer identifier is stored in this evidence file.

## Remaining production proof

This statement was superseded on 2026-08-31: two independent GitHub identities are now available and the partial live proof is recorded in `two-real-user-isolation-2026-08-31.md`. Symmetric review-object proof remains open until the production webhook/worker creates a review for identity B.

# Key rotation, closed — 2026-09-03

The trust page listed this as a release blocker: no dated evidence that a stored provider key can
be rotated and the old ciphertext rendered unusable end to end. The code path existed; the proof
did not.

## What "rotation" means here, precisely

There are two things in this repository that could be called rotation, and only one of them is a
product flow:

- **Credential replacement** — an owner supplies a new provider key, the old row is revoked and
  audited as `credential.rotated` (`convex/integrations.ts`). This is the flow a customer uses,
  and this is what the blocker was about.
- **`rotateEnvelope`** (`packages/security/src/index.ts:31`) — a KMS rewrap helper that re-wraps a
  data key under a new KMS key. **No production path calls it.** It has unit tests and no caller.
  This document does not claim otherwise.

## The gap the proof exposed

Every review-time read already filters on `status: "valid"` through the `by_org_status` index —
`convex/durableReview.ts:304` and `convex/githubWebhookData.ts:273` — so a rotated credential was
already unselectable. But revocation patched `status` and `revokedAt` and stopped, leaving
`encryptedCiphertext`, `nonce`, `authTag` and `wrappedDataKey` in the row.

So "the old ciphertext is rendered unusable" was true *by filtering*, not structurally. One future
read path that forgets the filter, or one database export, and the envelope is openable again.
That is a weaker guarantee than the trust page implies.

## What changed

Revocation now clears the envelope — ciphertext, nonce, auth tag and wrapped data key — through a
single writer, `convex/lib/credentialRevocation.ts`, that both revocation call sites use. Without
the wrapped data key the envelope cannot be decrypted at all, wherever the row ends up.

Kept: `maskedSuffix`, `keyVersion`, `provider`, `createdAt`, `revokedAt` and the audit event, so an
owner auditing a rotation can still see which key was replaced and when.

The reason the guarantee was uneven is that revoking was open-coded at each site that needed it.
One writer is what stops that recurring.

## Covered by

`convex/credentialRevocation.test.ts`, asserting each property separately:

- the wrapped data key and the whole envelope are destroyed, not merely flagged
- the audit history a person needs survives
- applying it twice does not rewrite the moment of revocation or undo the scrub
- a revoked credential is unselectable by the review-time `by_org_status` index

Written failing-first: before the change, the first assertion failed on the module not existing,
then on the wrapped data key still being present.

## Status

This blocker is closed for the flow customers actually use. `rotateEnvelope` remains uncalled, and
is stated as such above rather than counted as evidence.

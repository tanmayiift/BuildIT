import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// Revocation used to patch status and revokedAt and stop, leaving the envelope - ciphertext, nonce,
// auth tag and wrapped data key - intact in the row. Every review-time read filters on
// status "valid", so the key was already unselectable, but "the old ciphertext is rendered
// unusable" was then a property of the queries rather than of the data. A read path that forgets
// the filter, or a database export, and it is openable again.
//
// Clearing the wrapped data key is what makes it structural: the envelope cannot be decrypted
// without it, so the row is inert wherever it ends up. The masked suffix, key version, provider and
// dates stay, because an owner auditing a rotation needs to see which key was replaced and when.
//
// One writer for this, called from every revocation path. The reason the guarantee was uneven in
// the first place is that revoking was open-coded at the one call site that happened to need it.
export async function revokeCredentialSecret(ctx: MutationCtx, credentialId: Id<"providerCredentials">, now: number) {
  const credential = await ctx.db.get(credentialId);
  if (!credential) return;
  // A retry must not rewrite the moment of revocation, and must not undo the scrub.
  if (credential.status === "revoked" && credential.revokedAt !== undefined) return;
  await ctx.db.patch(credentialId, {
    status: "revoked", revokedAt: now,
    encryptedCiphertext: "", nonce: "", authTag: "", wrappedDataKey: "",
  });
}

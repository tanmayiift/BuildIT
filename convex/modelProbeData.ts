import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { provider as providerValidator } from "./validators";

// Split from modelProbe.ts because a "use node" module may only define actions. The action needs
// the credential envelope and a repository to scope the grant to; both are plain database reads.

export const probeScope = internalQuery({
  args: { organizationId: v.id("organizations"), provider: providerValidator },
  handler: async (ctx, args) => {
    const credentials = await ctx.db.query("providerCredentials")
      .withIndex("by_org_status", q => q.eq("organizationId", args.organizationId).eq("status", "valid"))
      .collect();
    const credential = credentials.find(item => item.provider === args.provider && item.repositoryId === undefined)
      ?? credentials.find(item => item.provider === args.provider);
    if (!credential || !credential.lastValidatedAt) return null;
    const repository = await ctx.db.query("repositories")
      .withIndex("by_org_enabled", q => q.eq("organizationId", args.organizationId).eq("enabled", true)).first();
    if (!repository) return null;
    return {
      repositoryId: String(repository._id),
      credential: { id: credential.credentialScopeId, organizationId: String(credential.organizationId),
        provider: credential.provider, ciphertext: credential.encryptedCiphertext, nonce: credential.nonce,
        tag: credential.authTag, wrappedDataKey: credential.wrappedDataKey, kmsKeyId: credential.kmsKeyId,
        envelopeVersion: credential.envelopeVersion, keyVersion: credential.keyVersion, aadDigest: credential.aadDigest,
        maskedSuffix: credential.maskedSuffix, availableModels: credential.availableModels ?? [],
        status: "valid" as const, createdBy: credential.createdBy, createdAt: credential.createdAt,
        lastValidatedAt: credential.lastValidatedAt },
      availableModels: credential.availableModels ?? [],
      maskedSuffix: credential.maskedSuffix,
    };
  },
});

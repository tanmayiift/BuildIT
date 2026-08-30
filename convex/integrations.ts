import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrganizationRole, requireRecentGitHubLogin, requireRepositoryRole } from "./lib/authz";
import { appendAuditEvent } from "./lib/audit";
import { provider } from "./validators";

export const listProviderCredentials = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireOrganizationRole(ctx, args.organizationId, "admin");
    const credentials = await ctx.db.query("providerCredentials")
      .withIndex("by_org_provider", (q) => q.eq("organizationId", args.organizationId)).collect();
    return credentials.map((credential) => ({
      id: credential._id, provider: credential.provider, maskedSuffix: credential.maskedSuffix,
      status: credential.status, createdBy: credential.createdBy, createdAt: credential.createdAt,
      lastValidatedAt: credential.lastValidatedAt, lastUsedAt: credential.lastUsedAt,
      revokedAt: credential.revokedAt,
    }));
  },
});

export const authorizeCredentialWrite = query({
  args: { organizationId: v.id("organizations"), repositoryId: v.optional(v.id("repositories")) },
  handler: async (ctx, args) => {
    const access = args.repositoryId
      ? await requireRepositoryRole(ctx, args.repositoryId, "admin", args.organizationId)
      : await requireOrganizationRole(ctx, args.organizationId, "admin");
    await requireRecentGitHubLogin(ctx, access.userId);
    return { actorId: access.userId };
  },
});

export const storeEncryptedCredential = mutation({
  args: {
    organizationId: v.id("organizations"), repositoryId: v.optional(v.id("repositories")),
    credentialScopeId: v.string(), provider, encryptedCiphertext: v.string(), nonce: v.string(),
    authTag: v.string(), aadDigest: v.string(), wrappedDataKey: v.string(), kmsKeyId: v.string(),
    envelopeVersion: v.literal(1), keyVersion: v.number(), maskedSuffix: v.string(),
    lastValidatedAt: v.number(), requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const access = args.repositoryId
      ? await requireRepositoryRole(ctx, args.repositoryId, "admin", args.organizationId)
      : await requireOrganizationRole(ctx, args.organizationId, "admin");
    await requireRecentGitHubLogin(ctx, access.userId);
    if (!/^[0-9a-f-]{36}$/i.test(args.credentialScopeId) || !/^[0-9a-f]{64}$/i.test(args.aadDigest)
      || args.maskedSuffix.length !== 4 || args.keyVersion !== 1 || args.lastValidatedAt > Date.now() + 5_000) {
      throw new Error("invalid_encrypted_credential");
    }
    const existing = await ctx.db.query("providerCredentials").withIndex("by_scope", q => q.eq("credentialScopeId", args.credentialScopeId)).unique();
    if (existing) throw new Error("credential_scope_already_exists");
    const { requestId, ...encrypted } = args;
    const credentialId = await ctx.db.insert("providerCredentials", {
      ...encrypted, status: "valid", createdBy: access.userId, createdAt: Date.now(),
    });
    await appendAuditEvent(ctx, { organizationId: args.organizationId, actorId: access.userId,
      action: "credential.created", resourceType: "provider_credential", resourceId: credentialId,
      requestId, result: "allowed", createdAt: Date.now() });
    return { id: credentialId, provider: args.provider, maskedSuffix: args.maskedSuffix, status: "valid" as const, lastValidatedAt: args.lastValidatedAt };
  },
});

export const revokeProviderCredential = mutation({
  args: { organizationId: v.id("organizations"), credentialId: v.id("providerCredentials"), requestId: v.string() },
  handler: async (ctx, args) => {
    const access = await requireOrganizationRole(ctx, args.organizationId, "admin");
    await requireRecentGitHubLogin(ctx, access.userId);
    const credential = await ctx.db.get(args.credentialId);
    if (!credential || credential.organizationId !== args.organizationId) throw new Error("not_found_or_forbidden");
    if (credential.status === "revoked") return { id: credential._id, status: "revoked" as const };
    const now = Date.now();
    await ctx.db.patch(credential._id, { status: "revoked", revokedAt: now });
    await appendAuditEvent(ctx, { organizationId: args.organizationId, actorId: access.userId,
      action: "credential.revoked", resourceType: "provider_credential", resourceId: credential._id,
      requestId: args.requestId, result: "allowed", createdAt: now });
    return { id: credential._id, status: "revoked" as const };
  },
});

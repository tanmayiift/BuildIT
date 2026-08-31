import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrganizationRole, requireRecentGitHubLogin, requireRepositoryRole } from "./lib/authz";
import { appendAuditEvent } from "./lib/audit";
import { provider,trackerProvider } from "./validators";

export const listTrackerConnections=query({args:{organizationId:v.id("organizations")},handler:async(ctx,args)=>{await requireOrganizationRole(ctx,args.organizationId,"admin");const values=await ctx.db.query("trackerConnections").withIndex("by_org_provider",q=>q.eq("organizationId",args.organizationId)).collect();return values.map(item=>({id:item._id,repositoryId:item.repositoryId,provider:item.provider,workspaceId:item.workspaceId,scopes:item.scopes,status:item.status,maskedSuffix:item.maskedSuffix,lastValidatedAt:item.lastValidatedAt,lastUsedAt:item.lastUsedAt,expiresAt:item.expiresAt,createdAt:item.createdAt}))}});
export const storeEncryptedTrackerConnection=mutation({args:{organizationId:v.id("organizations"),repositoryId:v.optional(v.id("repositories")),credentialScopeId:v.string(),provider:trackerProvider,workspaceId:v.string(),scopes:v.array(v.string()),encryptedAccessToken:v.string(),nonce:v.string(),authTag:v.string(),aadDigest:v.string(),wrappedDataKey:v.string(),kmsKeyId:v.string(),envelopeVersion:v.literal(1),keyVersion:v.number(),maskedSuffix:v.string(),lastValidatedAt:v.number(),expiresAt:v.optional(v.number()),replacesConnectionId:v.optional(v.id("trackerConnections")),requestId:v.string()},handler:async(ctx,args)=>{const access=args.repositoryId?await requireRepositoryRole(ctx,args.repositoryId,"admin",args.organizationId):await requireOrganizationRole(ctx,args.organizationId,"admin");if(args.provider==="github"||!/^[0-9a-f-]{36}$/i.test(args.credentialScopeId)||!/^[0-9a-f]{64}$/.test(args.aadDigest)||args.maskedSuffix.length!==4||args.keyVersion!==1||!args.workspaceId||args.workspaceId.length>300||args.scopes.length>50)throw new Error("invalid_encrypted_tracker");const prior=args.replacesConnectionId?await ctx.db.get(args.replacesConnectionId):null;if(args.replacesConnectionId&&(!prior||prior.organizationId!==args.organizationId||prior.repositoryId!==args.repositoryId||prior.provider!==args.provider||prior.status!=="active"))throw new Error("not_found_or_forbidden");const now=Date.now(),{requestId,replacesConnectionId:_replace,...stored}=args,id=await ctx.db.insert("trackerConnections",{...stored,status:"active",createdBy:access.userId,createdAt:now,updatedAt:now});if(prior)await ctx.db.patch(prior._id,{status:"revoked",revokedAt:now,updatedAt:now});await appendAuditEvent(ctx,{organizationId:args.organizationId,actorId:access.userId,action:prior?"tracker.rotated":"tracker.created",resourceType:"tracker_connection",resourceId:id,requestId,result:"allowed",createdAt:now});return{id,status:"active" as const}}});
export const revokeTrackerConnection=mutation({args:{organizationId:v.id("organizations"),connectionId:v.id("trackerConnections"),requestId:v.string()},handler:async(ctx,args)=>{const access=await requireOrganizationRole(ctx,args.organizationId,"admin");await requireRecentGitHubLogin(ctx,access.userId);const value=await ctx.db.get(args.connectionId);if(!value||value.organizationId!==args.organizationId)throw new Error("not_found_or_forbidden");if(value.status==="revoked")return{id:value._id,status:"revoked" as const};const now=Date.now();await ctx.db.patch(value._id,{status:"revoked",revokedAt:now,updatedAt:now});await appendAuditEvent(ctx,{organizationId:args.organizationId,actorId:access.userId,action:"tracker.revoked",resourceType:"tracker_connection",resourceId:value._id,requestId:args.requestId,result:"allowed",createdAt:now});return{id:value._id,status:"revoked" as const}}});

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
      revokedAt: credential.revokedAt, availableModels: credential.availableModels,
      repositoryId: credential.repositoryId,
    }));
  },
});

export const authorizeCredentialWrite = mutation({
  args: { organizationId: v.id("organizations"), repositoryId: v.optional(v.id("repositories")) },
  handler: async (ctx, args) => {
    const access = args.repositoryId
      ? await requireRepositoryRole(ctx, args.repositoryId, "admin", args.organizationId)
      : await requireOrganizationRole(ctx, args.organizationId, "admin");
    await requireRecentGitHubLogin(ctx, access.userId);
    const now = Date.now(), windowStart = Math.floor(now / 900_000) * 900_000;
    const limit = await ctx.db.query("credentialRateLimits").withIndex("by_org_user_action_window", q => q
      .eq("organizationId", args.organizationId).eq("userId", access.userId)
      .eq("action", "credential_validate").eq("windowStart", windowStart)).unique();
    if (limit && limit.attemptCount >= 10) throw new Error("rate_limited");
    if (limit) await ctx.db.patch(limit._id, { attemptCount: limit.attemptCount + 1, updatedAt: now });
    else await ctx.db.insert("credentialRateLimits", { organizationId: args.organizationId, userId: access.userId,
      action: "credential_validate", windowStart, attemptCount: 1, updatedAt: now });
    return { actorId: access.userId };
  },
});

export const storeEncryptedCredential = mutation({
  args: {
    organizationId: v.id("organizations"), repositoryId: v.optional(v.id("repositories")),
    credentialScopeId: v.string(), provider, encryptedCiphertext: v.string(), nonce: v.string(),
    authTag: v.string(), aadDigest: v.string(), wrappedDataKey: v.string(), kmsKeyId: v.string(),
    envelopeVersion: v.literal(1), keyVersion: v.number(), maskedSuffix: v.string(), availableModels: v.array(v.string()),
    lastValidatedAt: v.number(), requestId: v.string(),
    replacesCredentialId: v.optional(v.id("providerCredentials")),
  },
  handler: async (ctx, args) => {
    const access = args.repositoryId
      ? await requireRepositoryRole(ctx, args.repositoryId, "admin", args.organizationId)
      : await requireOrganizationRole(ctx, args.organizationId, "admin");
    // authorizeCredentialWrite already required a fresh GitHub login before the
    // provider saw the key. Re-check membership and repository scope here, but
    // do not let provider response time invalidate the approved write.
    if (!/^[0-9a-f-]{36}$/i.test(args.credentialScopeId) || !/^[0-9a-f]{64}$/i.test(args.aadDigest)
      || args.maskedSuffix.length !== 4 || args.keyVersion !== 1 || args.lastValidatedAt > Date.now() + 5_000
      || !args.availableModels.length || args.availableModels.length > 10 || args.availableModels.some(model => !/^[-.a-z0-9]{3,100}$/i.test(model))) {
      throw new Error("invalid_encrypted_credential");
    }
    const existing = await ctx.db.query("providerCredentials").withIndex("by_scope", q => q.eq("credentialScopeId", args.credentialScopeId)).unique();
    if (existing) throw new Error("credential_scope_already_exists");
    const replaced = args.replacesCredentialId ? await ctx.db.get(args.replacesCredentialId) : null;
    if (args.replacesCredentialId && (!replaced || replaced.organizationId !== args.organizationId
      || replaced.repositoryId !== args.repositoryId || replaced.provider !== args.provider || replaced.status !== "valid")) {
      throw new Error("not_found_or_forbidden");
    }
    const { requestId, replacesCredentialId: _replacesCredentialId, ...encrypted } = args;
    const credentialId = await ctx.db.insert("providerCredentials", {
      ...encrypted, status: "valid", createdBy: access.userId, createdAt: Date.now(),
    });
    if (replaced) await ctx.db.patch(replaced._id, { status: "revoked", revokedAt: Date.now() });
    await appendAuditEvent(ctx, { organizationId: args.organizationId, actorId: access.userId,
      action: replaced ? "credential.rotated" : "credential.created", resourceType: "provider_credential", resourceId: credentialId,
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

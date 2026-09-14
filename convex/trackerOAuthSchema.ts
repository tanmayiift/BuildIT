import { defineTable } from "convex/server";
import { v } from "convex/values";
export const oauthTrackerProvider = v.union(v.literal("linear"), v.literal("jira"));
export const trackerEnvelope = v.object({ ciphertext: v.string(), nonce: v.string(), tag: v.string(), wrappedDataKey: v.string(), kmsKeyId: v.string(), envelopeVersion: v.literal(1), keyVersion: v.number(), aadDigest: v.string() });
export const trackerResource = v.object({ id: v.string(), name: v.string(), workspaceId: v.string() });
export const trackerOAuthTables = {
  trackerOAuthStates: defineTable({
    organizationId: v.id("organizations"), repositoryId: v.optional(v.id("repositories")), userId: v.string(),
    stateHash: v.string(), provider: oauthTrackerProvider, credentialScopeId: v.string(),
    replacesConnectionId: v.optional(v.id("trackerConnections")),
    status: v.union(v.literal("pending"), v.literal("exchanging"), v.literal("selecting"), v.literal("completed"), v.literal("failed")),
    encryptedCredential: v.optional(trackerEnvelope), resources: v.optional(v.array(trackerResource)),
    scopes: v.optional(v.array(v.string())), tokenExpiresAt: v.optional(v.number()),
    expiresAt: v.number(), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_state_hash", ["stateHash"]).index("by_org_user_status", ["organizationId", "userId", "status"]).index("by_expiry", ["expiresAt"]).index("by_org_user_created", ["organizationId", "userId", "createdAt"]),
};

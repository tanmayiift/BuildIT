import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrganizationRole } from "./lib/authz";

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

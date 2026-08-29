import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrganizationRole } from "./lib/authz";

export const getMetadata = query({
  args: { artifactId: v.id("artifacts") },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact) throw new Error("not_found_or_forbidden");
    await requireOrganizationRole(ctx, artifact.organizationId, "viewer");
    return {
      id: artifact._id, type: artifact.type, size: artifact.size,
      redactionStatus: artifact.redactionStatus, expiresAt: artifact.expiresAt,
      deletedAt: artifact.deletedAt,
    };
  },
});

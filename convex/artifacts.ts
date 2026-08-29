import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireRepositoryRole } from "./lib/authz";

export const getMetadata = query({
  args: { artifactId: v.id("artifacts") },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact) throw new Error("not_found_or_forbidden");
    await requireRepositoryRole(ctx, artifact.repositoryId, "viewer", artifact.organizationId);
    if (artifact.reviewId) {
      const review = await ctx.db.get(artifact.reviewId);
      if (!review || review.organizationId !== artifact.organizationId || review.repositoryId !== artifact.repositoryId) {
        throw new Error("not_found_or_forbidden");
      }
    }
    return {
      id: artifact._id, type: artifact.type, size: artifact.size,
      redactionStatus: artifact.redactionStatus, expiresAt: artifact.expiresAt,
      deletedAt: artifact.deletedAt,
    };
  },
});

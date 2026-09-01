import { ConvexError, v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { requireRepositoryRole } from "./lib/authz";

export const findingDetailScope = internalQuery({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new ConvexError("not_found_or_forbidden");
    await requireRepositoryRole(ctx, review.repositoryId, "viewer", review.organizationId);
    const artifacts = await ctx.db.query("artifacts").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
    const analysis = artifacts.find(item => item.type === "prompt_trace" && item.redactionStatus === "redacted" && !item.deletedAt && item.storageKey.endsWith("/analysis.json"));
    if (!analysis || analysis.organizationId !== review.organizationId || analysis.repositoryId !== review.repositoryId || analysis.reviewId !== review._id) throw new ConvexError("finding_detail_unavailable");
    return {
      organizationId: review.organizationId,
      repositoryId: review.repositoryId,
      reviewId: review._id,
      headSha: review.headSha,
      baseSha: review.baseSha,
      artifact: { id: analysis._id, storageKey: analysis.storageKey, checksum: analysis.checksum, size: analysis.size },
    };
  },
});

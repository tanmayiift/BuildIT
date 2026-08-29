import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrganizationRole, requireRepositoryRole } from "./lib/authz";

const publicReview = (review: {
  _id: unknown; repositoryId: unknown; prNumber: number; headSha: string; status: string;
  isStale: boolean; coverageLevel: string; currentStage: string; nextActionCode: string;
  githubCheckConclusion?: string; createdAt: number; updatedAt: number;
}) => ({
  id: review._id, repositoryId: review.repositoryId, prNumber: review.prNumber,
  headSha: review.headSha, status: review.status, isStale: review.isStale,
  coverageLevel: review.coverageLevel, currentStage: review.currentStage,
  nextActionCode: review.nextActionCode, githubCheckConclusion: review.githubCheckConclusion,
  createdAt: review.createdAt, updatedAt: review.updatedAt,
});

export const list = query({
  args: { organizationId: v.id("organizations"), repositoryId: v.optional(v.id("repositories")) },
  handler: async (ctx, args) => {
    await requireOrganizationRole(ctx, args.organizationId, "viewer");
    if (args.repositoryId) await requireRepositoryRole(ctx, args.repositoryId, "viewer", args.organizationId);
    const reviews = args.repositoryId
      ? await ctx.db.query("reviews").withIndex("by_repo_pr_head_mode", (q) => q.eq("repositoryId", args.repositoryId!)).collect()
      : await ctx.db.query("reviews").withIndex("by_org_status", (q) => q.eq("organizationId", args.organizationId)).collect();
    return reviews.map(publicReview);
  },
});

export const get = query({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new Error("not_found_or_forbidden");
    await requireRepositoryRole(ctx, review.repositoryId, "viewer", review.organizationId);
    return publicReview(review);
  },
});

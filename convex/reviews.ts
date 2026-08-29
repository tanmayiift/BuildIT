import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrganizationRole } from "./lib/authz";

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
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireOrganizationRole(ctx, args.organizationId, "viewer");
    const reviews = await ctx.db.query("reviews").withIndex("by_org_status", (q) => q.eq("organizationId", args.organizationId)).collect();
    return reviews.map(publicReview);
  },
});

export const get = query({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new Error("not_found_or_forbidden");
    await requireOrganizationRole(ctx, review.organizationId, "viewer");
    return publicReview(review);
  },
});

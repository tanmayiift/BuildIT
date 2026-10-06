import { ConvexError, v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { requireRepositoryRole } from "./lib/authz";
import { isStored } from "./lib/artifactState";

export const findingDetailScope = internalQuery({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new ConvexError("not_found_or_forbidden");
    await requireRepositoryRole(ctx, review.repositoryId, "viewer", review.organizationId);
    const artifacts = await ctx.db.query("artifacts").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
    const analysis = artifacts.find(item => item.type === "prompt_trace" && isStored(item) && !item.deletedAt && item.storageKey.endsWith("/analysis.json"));
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

// What the review page's "cited lines" and "check output" read: the same viewer guard as the finding
// prose above, plus the head snapshot the cited lines come from. Retention erases both artifacts, and
// the page says so by date instead of failing as if access were the problem.
export const findingEvidenceScope = internalQuery({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new ConvexError("not_found_or_forbidden");
    await requireRepositoryRole(ctx, review.repositoryId, "viewer", review.organizationId);
    const artifacts = (await ctx.db.query("artifacts").withIndex("by_review", q => q.eq("reviewId", review._id)).collect())
      .filter(item => item.organizationId === review.organizationId && item.repositoryId === review.repositoryId);
    const analysis = artifacts.find(item => item.type === "prompt_trace" && item.storageKey.endsWith("/analysis.json"));
    const heads = artifacts.filter(item => item.type === "repository_snapshot" && /\/context-head-\d+\.json$/.test(item.storageKey))
      .sort((a, b) => a.storageKey.localeCompare(b.storageKey));
    const erasedAt = [analysis, ...heads].map(item => item?.deletedAt).find(value => value !== undefined);
    if (erasedAt !== undefined) return { state: "erased" as const, erasedAt };
    if (!analysis || !isStored(analysis) || !heads.length || heads.some(item => !isStored(item))) return { state: "unavailable" as const };
    const ref = (item: typeof analysis) => ({ id: item._id, storageKey: item.storageKey, checksum: item.checksum, size: item.size });
    return {
      state: "available" as const,
      organizationId: review.organizationId, repositoryId: review.repositoryId, reviewId: review._id,
      headSha: review.headSha, baseSha: review.baseSha,
      analysis: ref(analysis), heads: heads.map(ref),
    };
  },
});

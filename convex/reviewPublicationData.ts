import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { assertReviewParent } from "./lib/parentConsistency";
import { sideEffectStatus } from "./validators";

const executionArgs = { organizationId: v.id("organizations"), reviewId: v.id("reviews"), expectedHeadSha: v.string(), expectedGeneration: v.number() };

export const publicationScope = internalQuery({
  args: executionArgs,
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId), repository = await ctx.db.get((await assertReviewParent(ctx.db, args.organizationId, args.reviewId)).repositoryId);
    const installation = repository ? await ctx.db.get(repository.installationId) : null;
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale) throw new ConvexError("stale_or_replaced_review");
    if (!repository || !repository.enabled || repository.organizationId !== args.organizationId || !installation || installation.organizationId !== args.organizationId || installation.status !== "active") throw new ConvexError("repository_unavailable");
    if (!review.completedAt || !review.githubCheckConclusion || !["checks_passed", "changes_requested", "inconclusive"].includes(review.status)) throw new ConvexError("review_not_ready_for_publication");
    const event = await ctx.db.query("reviewEvents").withIndex("by_review", q => q.eq("reviewId", review._id).eq("sequence", 5)).unique(), report = event?.publicMessageArtifactId ? await ctx.db.get(event.publicMessageArtifactId) : null;
    if (!event || !report || report.organizationId !== args.organizationId || report.repositoryId !== repository._id || report.reviewId !== review._id || report.type !== "review_message" || report.redactionStatus !== "redacted" || report.deletedAt) throw new ConvexError("report_artifact_mismatch");
    return { organizationId: review.organizationId, repositoryId: repository._id, reviewId: review._id, installationId: installation.installationId, githubRepositoryId: repository.githubRepositoryId,
      prNumber: review.prNumber, headSha: review.headSha, conclusion: review.githubCheckConclusion, status: review.status, reason: review.statusReasonCode ?? "platform_error",
      report: { id: report._id, storageKey: report.storageKey, checksum: report.checksum, size: report.size } };
  },
});

export const completeSideEffect = internalMutation({
  args: { ...executionArgs, sideEffectId: v.id("githubSideEffects"), requestHash: v.string(), externalId: v.string(), status: sideEffectStatus, now: v.number() },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId), effect = await ctx.db.get(args.sideEffectId);
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || !effect || effect.organizationId !== args.organizationId || effect.repositoryId !== review.repositoryId || effect.reviewId !== review._id || effect.requestHash !== args.requestHash) throw new ConvexError("side_effect_scope_mismatch");
    if (effect.status === "completed") { if (effect.externalId !== args.externalId) throw new ConvexError("side_effect_completion_conflict"); return effect._id; }
    if (effect.status !== "reserved" && effect.status !== "failed") throw new ConvexError("side_effect_not_completable");
    await ctx.db.patch(effect._id, { status: args.status, externalId: args.externalId, updatedAt: args.now });
    return effect._id;
  },
});

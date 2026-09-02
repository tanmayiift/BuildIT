import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { assertReviewParent } from "./lib/parentConsistency";
import { totalCostUsd } from "./lib/usageCost";

const executionArgs = { organizationId: v.id("organizations"), reviewId: v.id("reviews"), expectedHeadSha: v.string(), expectedGeneration: v.number() };

export const reportScope = internalQuery({
  args: executionArgs,
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale) throw new ConvexError("stale_or_replaced_review");
    if (review.status !== "validating" || review.currentStage !== "analysis") throw new ConvexError("review_not_ready_for_report");
    const repository = await ctx.db.get(review.repositoryId), config = await ctx.db.get(review.configRevisionId);
    if (!repository || repository.organizationId !== args.organizationId || !config || config.organizationId !== args.organizationId || config.repositoryId !== review.repositoryId) throw new ConvexError("report_scope_mismatch");
    const artifacts = await ctx.db.query("artifacts").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
    const analysis = artifacts.find(item => item.type === "prompt_trace" && item.redactionStatus === "redacted" && !item.deletedAt && item.storageKey.endsWith("/analysis.json"));
    const validation = artifacts.find(item => item.type === "command_output" && item.redactionStatus === "redacted" && !item.deletedAt && item.storageKey.endsWith("/validation.json"));
    if (!analysis || !validation || analysis.organizationId !== args.organizationId || validation.organizationId !== args.organizationId || analysis.repositoryId !== review.repositoryId || validation.repositoryId !== review.repositoryId) throw new ConvexError("report_evidence_unavailable");
    const completed = artifacts.find(item => item.type === "review_message" && item.redactionStatus === "redacted" && !item.deletedAt && item.storageKey.endsWith("/report.md"));
    const usage = await ctx.db.query("usageLedger").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
    return { organizationId: review.organizationId, repositoryId: review.repositoryId, reviewId: review._id, repository: `${repository.owner}/${repository.name}`, prNumber: review.prNumber,
      headSha: review.headSha, baseSha: review.baseSha, configRevision: String(review.configRevisionId), coverage: review.coverageLevel === "full" ? "complete" as const : "partial" as const, injectionUnscoped: Boolean(review.promptInjectionUnscopedAt),
      environmentAvailable: true, isStale: review.isStale, expiresAt: review.expiresAt, costUsd: totalCostUsd(usage),
      analysis: { id: analysis._id, storageKey: analysis.storageKey, checksum: analysis.checksum, size: analysis.size }, validation: { id: validation._id, storageKey: validation.storageKey, checksum: validation.checksum, size: validation.size },
      ...(completed ? { completedArtifactId: completed._id } : {}) };
  },
});

export const reserveOutput = internalMutation({
  args: { ...executionArgs, checksum: v.string(), size: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale) throw new ConvexError("stale_or_replaced_review");
    if (!/^[0-9a-f]{64}$/.test(args.checksum) || !Number.isInteger(args.size) || args.size < 1 || args.size > 60_000) throw new ConvexError("invalid_report_artifact");
    const prior = (await ctx.db.query("artifacts").withIndex("by_review", q => q.eq("reviewId", review._id)).collect()).find(item => item.type === "review_message" && item.storageKey.endsWith("/report.md"));
    if (prior) { if (prior.checksum !== args.checksum || prior.size !== args.size) throw new ConvexError("report_artifact_conflict"); return { artifactId: prior._id, storageKey: prior.storageKey }; }
    const artifactId = await ctx.db.insert("artifacts", { organizationId: args.organizationId, repositoryId: review.repositoryId, reviewId: review._id, type: "review_message", storageKey: "pending", encrypted: true,
      checksum: args.checksum, size: args.size, redactionStatus: "pending", expiresAt: Math.min(review.expiresAt, args.now + 7 * 86_400_000), deletionAttempts: 0 });
    const storageKey = `artifacts/${args.organizationId}/${review.repositoryId}/${review._id}/${artifactId}/report.md`;
    await ctx.db.patch(artifactId, { storageKey });
    return { artifactId, storageKey };
  },
});

export const completeOutput = internalMutation({
  args: { ...executionArgs, artifactId: v.id("artifacts"), checksum: v.string(), size: v.number() },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId), artifact = await ctx.db.get(args.artifactId);
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale) throw new ConvexError("stale_or_replaced_review");
    if (!artifact || artifact.organizationId !== args.organizationId || artifact.repositoryId !== review.repositoryId || artifact.reviewId !== review._id || artifact.type !== "review_message" || artifact.checksum !== args.checksum || artifact.size !== args.size || artifact.deletedAt) throw new ConvexError("report_artifact_mismatch");
    if (artifact.redactionStatus === "redacted") return artifact._id;
    if (artifact.redactionStatus !== "pending") throw new ConvexError("report_artifact_mismatch");
    await ctx.db.patch(artifact._id, { redactionStatus: "redacted" });
    return artifact._id;
  },
});

import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { assertReviewParent } from "./lib/parentConsistency";

export const contextScope = internalQuery({
  args: { organizationId: v.id("organizations"), reviewId: v.id("reviews"), expectedHeadSha: v.string(), expectedGeneration: v.number() },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale) throw new ConvexError("stale_or_replaced_review");
    const repository = await ctx.db.get(review.repositoryId), installation = repository ? await ctx.db.get(repository.installationId) : null;
    if (!repository || !repository.enabled || !installation || installation.status !== "active" || installation.organizationId !== args.organizationId) throw new ConvexError("repository_unavailable");
    return { organizationId: args.organizationId, repositoryId: repository._id, reviewId: review._id,
      installationId: installation.installationId, githubRepositoryId: repository.githubRepositoryId,
      prNumber: review.prNumber, headSha: review.headSha, baseSha: review.baseSha,
      executionGeneration: review.executionGeneration, expiresAt: review.expiresAt };
  },
});

export const reserve = internalMutation({
  args: { organizationId: v.id("organizations"), reviewId: v.id("reviews"), expectedHeadSha: v.string(), expectedGeneration: v.number(),
    checksum: v.string(), size: v.number(), chunkIndex: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale) throw new ConvexError("stale_or_replaced_review");
    if (!/^[0-9a-f]{64}$/.test(args.checksum) || !Number.isInteger(args.size) || args.size < 1 || args.size > 4_000_000 || !Number.isInteger(args.chunkIndex) || args.chunkIndex < 0 || args.chunkIndex >= 64) throw new ConvexError("invalid_artifact_reservation");
    const prior = (await ctx.db.query("artifacts").withIndex("by_review", q => q.eq("reviewId", review._id)).collect())
      .find(item => item.type === "repository_snapshot" && item.storageKey.endsWith(`/context-${args.chunkIndex}.json`));
    if (prior) {
      if (prior.organizationId !== args.organizationId || prior.repositoryId !== review.repositoryId || prior.checksum !== args.checksum || prior.size !== args.size) throw new ConvexError("context_artifact_conflict");
      return { artifactId: prior._id, repositoryId: review.repositoryId, reviewId: review._id, storageKey: prior.storageKey, expiresAt: prior.expiresAt };
    }
    const artifactId = await ctx.db.insert("artifacts", { organizationId: args.organizationId, repositoryId: review.repositoryId,
      reviewId: review._id, type: "repository_snapshot", storageKey: "pending", encrypted: true, checksum: args.checksum,
      size: args.size, redactionStatus: "pending", expiresAt: Math.min(review.expiresAt, args.now + 7 * 86_400_000), deletionAttempts: 0 });
    const storageKey = `artifacts/${args.organizationId}/${review.repositoryId}/${review._id}/${artifactId}/context-${args.chunkIndex}.json`;
    await ctx.db.patch(artifactId, { storageKey });
    return { artifactId, repositoryId: review.repositoryId, reviewId: review._id, storageKey, expiresAt: Math.min(review.expiresAt, args.now + 7 * 86_400_000) };
  },
});

export const complete = internalMutation({
  args: { organizationId: v.id("organizations"), reviewId: v.id("reviews"), artifactId: v.id("artifacts"), checksum: v.string(), size: v.number(),
    coverage: v.union(v.literal("full"), v.literal("partial")), now: v.number() },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId), artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.organizationId !== args.organizationId || artifact.repositoryId !== review.repositoryId || artifact.reviewId !== review._id
      || artifact.type !== "repository_snapshot" || artifact.checksum !== args.checksum || artifact.size !== args.size) throw new ConvexError("artifact_completion_mismatch");
    if (artifact.redactionStatus === "redacted") return artifact._id;
    if (artifact.redactionStatus !== "pending") throw new ConvexError("artifact_completion_mismatch");
    await ctx.db.patch(artifact._id, { redactionStatus: "redacted" });
    await ctx.db.patch(review._id, { status: "gathering_context", currentStage: "context", coverageLevel: args.coverage, updatedAt: args.now });
    return artifact._id;
  },
});

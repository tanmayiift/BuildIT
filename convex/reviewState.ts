import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import * as value from "./validators";
import { terminalStatuses, transitionAllowed } from "./lib/lifecycle";
import { assertAttemptParent, assertRepositoryParent, assertReviewParent } from "./lib/parentConsistency";

export const transition = internalMutation({
  args: {
    reviewId: v.id("reviews"), expectedHeadSha: v.string(),
    expectedGeneration: v.number(), to: value.reviewStatus,
    statusReasonCode: v.optional(value.statusReasonCode), nextActionCode: value.nextActionCode,
    terminationBound: v.optional(value.terminationBound), budgetCeilingId: v.optional(v.string()),
    budgetConsumed: v.optional(v.number()), blockedExpiresAt: v.optional(v.number()), now: v.number(),
  },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new ConvexError("review_not_found");
    if (review.headSha !== args.expectedHeadSha) throw new ConvexError("stale_head");
    if (review.executionGeneration !== args.expectedGeneration) throw new ConvexError("cancelled_or_replaced");
    if (!transitionAllowed(review.status, args.to, review.blockedReason)) throw new ConvexError("invalid_transition");
    if (args.to === "failed_after_bounds" && !args.terminationBound) throw new ConvexError("termination_bound_required");
    if (args.to === "budget_exhausted" && (!args.budgetCeilingId || (args.budgetConsumed ?? 0) < review.budgetLimit)) throw new ConvexError("spend_ceiling_evidence_required");
    if (["inconclusive", "blocked", "cancelled", "platform_failed"].includes(args.to) && !args.statusReasonCode) throw new ConvexError("status_reason_required");
    const terminal = terminalStatuses.has(args.to);
    await ctx.db.patch(args.reviewId, {
      status: args.to, statusReasonCode: args.statusReasonCode, nextActionCode: args.nextActionCode,
      terminationBound: args.terminationBound, budgetCeilingId: args.budgetCeilingId,
      budgetConsumed: args.budgetConsumed ?? review.budgetConsumed,
      blockedReason: args.to === "blocked" ? review.status : undefined,
      blockedSince: args.to === "blocked" ? args.now : undefined,
      blockedExpiresAt: args.to === "blocked" ? args.blockedExpiresAt : undefined,
      completedAt: terminal ? args.now : undefined, updatedAt: args.now,
    });
  },
});

export const markStale = internalMutation({
  args: { reviewId: v.id("reviews"), observedHeadSha: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new ConvexError("review_not_found");
    if (review.headSha === args.observedHeadSha) return;
    await ctx.db.patch(args.reviewId, { isStale: true, staleSince: args.now, observedHeadSha: args.observedHeadSha, updatedAt: args.now });
  },
});

export const appendEvent = internalMutation({
  args: {
    organizationId: v.id("organizations"), reviewId: v.id("reviews"), sequence: v.number(),
    type: value.eventType, stage: value.reviewStage, internalCode: v.string(), now: v.number(),
  },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
    const previous = await ctx.db.query("reviewEvents").withIndex("by_review", (q) => q.eq("reviewId", args.reviewId)).order("desc").first();
    if (args.sequence !== (previous?.sequence ?? 0) + 1) throw new ConvexError("invalid_event_sequence");
    return ctx.db.insert("reviewEvents", {
      organizationId: args.organizationId, reviewId: args.reviewId, sequence: args.sequence,
      type: args.type, stage: args.stage, internalCode: args.internalCode, metadata: {}, createdAt: args.now,
    });
  },
});

export const acquireLease = internalMutation({
  args: { reviewId: v.id("reviews"), workerId: v.string(), now: v.number(), leaseMs: v.number() },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review || terminalStatuses.has(review.status)) throw new ConvexError("review_not_leaseable");
    if (review.leaseOwner && (review.leaseExpiresAt ?? 0) > args.now && review.leaseOwner !== args.workerId) throw new ConvexError("lease_held");
    await ctx.db.patch(args.reviewId, { leaseOwner: args.workerId, leaseExpiresAt: args.now + args.leaseMs, updatedAt: args.now });
    return { generation: review.executionGeneration };
  },
});

export const requestCancellation = internalMutation({
  args: { reviewId: v.id("reviews"), actorId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new ConvexError("review_not_found");
    if (terminalStatuses.has(review.status)) return review.executionGeneration;
    const executionGeneration = review.executionGeneration + 1;
    await ctx.db.patch(args.reviewId, {
      status: review.workflowId ? "cancelling" : "cancelled",
      statusReasonCode: review.workflowId ? undefined : "user_cancelled",
      nextActionCode: review.workflowId ? review.nextActionCode : "start_new_review",
      completedAt: review.workflowId ? undefined : args.now,
      cancelledBy: args.actorId, cancellationRequestedAt: args.now,
      executionGeneration, leaseOwner: undefined, leaseExpiresAt: undefined, updatedAt: args.now,
    });
    return executionGeneration;
  },
});

export const expireBlocked = internalMutation({
  args: { reviewId: v.id("reviews"), now: v.number() },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review || review.status !== "blocked" || !review.blockedExpiresAt || review.blockedExpiresAt > args.now) return false;
    await ctx.db.patch(args.reviewId, {
      status: "cancelled", statusReasonCode: "blocked_expired", nextActionCode: "start_new_review",
      completedAt: args.now, executionGeneration: review.executionGeneration + 1,
      leaseOwner: undefined, leaseExpiresAt: undefined, updatedAt: args.now,
    });
    return true;
  },
});

export const claimActiveReview = internalMutation({
  args: { reviewId: v.id("reviews"), now: v.number() },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review || terminalStatuses.has(review.status)) throw new ConvexError("review_not_active");
    await assertRepositoryParent(ctx.db, review.organizationId, review.repositoryId);
    const existing = await ctx.db.query("reviewLocks").withIndex("by_scope", (q) =>
      q.eq("repositoryId", review.repositoryId).eq("prNumber", review.prNumber)
        .eq("headSha", review.headSha).eq("mode", review.mode)).unique();
    if (existing && existing.reviewId !== args.reviewId) throw new ConvexError("active_review_exists");
    if (existing) return existing._id;
    return ctx.db.insert("reviewLocks", {
      repositoryId: review.repositoryId, prNumber: review.prNumber, headSha: review.headSha,
      mode: review.mode, reviewId: args.reviewId, createdAt: args.now,
    });
  },
});

export const reserveSideEffect = internalMutation({
  args: {
    organizationId: v.id("organizations"), reviewId: v.id("reviews"),
    operationKey: v.string(), type: value.sideEffectType, requestHash: v.string(), now: v.number(),
  },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
    const existing = await ctx.db.query("githubSideEffects").withIndex("by_repo_operation_key", (q) => q.eq("repositoryId", review.repositoryId).eq("operationKey", args.operationKey)).unique();
    if (existing) {
      if (existing.requestHash !== args.requestHash || existing.reviewId !== args.reviewId) throw new ConvexError("idempotency_key_conflict");
      return existing._id;
    }
    return ctx.db.insert("githubSideEffects", {
      organizationId: args.organizationId, repositoryId: review.repositoryId, reviewId: args.reviewId, operationKey: args.operationKey,
      type: args.type, requestHash: args.requestHash, status: "reserved",
      createdAt: args.now, updatedAt: args.now,
    });
  },
});

export const recordAutofixAttempt = internalMutation({
  args: {
    organizationId: v.id("organizations"), reviewId: v.id("reviews"), attemptNumber: v.number(),
    patchFingerprint: v.string(), patchArtifactId: v.optional(v.id("artifacts")),
    outcome: value.patchOutcome, rejectionReasonCode: v.optional(v.string()),
    promptVersion: v.string(), startedAt: v.number(), completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.attemptNumber) || args.attemptNumber < 1 || args.attemptNumber > 6) throw new ConvexError("attempt_out_of_bounds");
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
    if (review.mode !== "autofix") throw new ConvexError("invalid_autofix_review");
    const existing = await ctx.db.query("autofixAttempts").withIndex("by_review_attempt", (q) => q.eq("reviewId", args.reviewId).eq("attemptNumber", args.attemptNumber)).unique();
    if (existing) throw new ConvexError("attempt_already_recorded");
    const id = await ctx.db.insert("autofixAttempts", args);
    await ctx.db.patch(args.reviewId, { patchAttemptCount: args.attemptNumber, updatedAt: args.completedAt ?? args.startedAt });
    return id;
  },
});

export const recordAutofixRound = internalMutation({
  args: {
    organizationId: v.id("organizations"), reviewId: v.id("reviews"), roundNumber: v.number(),
    attemptId: v.id("autofixAttempts"), candidateCommitSha: v.string(),
    validationScope: value.validationScope, validationOutcome: value.validationOutcome,
    completedValidation: v.boolean(), startedAt: v.number(), completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.roundNumber) || args.roundNumber < 1 || args.roundNumber > 3) throw new ConvexError("round_out_of_bounds");
    const [review, attempt] = await Promise.all([
      assertReviewParent(ctx.db, args.organizationId, args.reviewId),
      assertAttemptParent(ctx.db, args.organizationId, args.reviewId, args.attemptId),
    ]);
    if (attempt.outcome !== "applied") throw new ConvexError("round_requires_applied_attempt");
    if (!args.completedValidation) throw new ConvexError("round_requires_validation");
    const existing = await ctx.db.query("autofixRounds").withIndex("by_review_round", (q) => q.eq("reviewId", args.reviewId).eq("roundNumber", args.roundNumber)).unique();
    if (existing) throw new ConvexError("round_already_recorded");
    const id = await ctx.db.insert("autofixRounds", args);
    await ctx.db.patch(args.reviewId, { completedRoundCount: args.roundNumber, updatedAt: args.completedAt ?? args.startedAt });
    return id;
  },
});

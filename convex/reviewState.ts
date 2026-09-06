import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import * as value from "./validators";
import { activeStatuses, cancellationNotice, terminalStatuses, transitionAllowed } from "./lib/lifecycle";
import { assertAttemptParent, assertRepositoryParent, assertReviewParent } from "./lib/parentConsistency";

// Cancelling a review used to be a database write and nothing else, so the acknowledgement check
// run stayed in_progress on the pull request head for good. Call this from every writer that lands
// a review on `cancelled`: it completes that run instead of leaving it spinning. It publishes only
// for a review that is actually cancelled, so a review still in `cancelling` is not announced dead
// before its workflow has stopped.
export async function publishCancellationNotice(ctx: MutationCtx, reviewId: Id<"reviews">) {
  const review = await ctx.db.get(reviewId);
  if (!review || review.status !== "cancelled") return false;
  const repository = await ctx.db.get(review.repositoryId);
  const installation = repository ? await ctx.db.get(repository.installationId) : null;
  if (!repository || !installation) return false;
  await ctx.scheduler.runAfter(0, internal.reviewPublicationWorker.acknowledge, {
    installationId: installation.installationId,
    githubRepositoryId: repository.githubRepositoryId,
    headSha: review.headSha,
    conclusion: "neutral",
    ...cancellationNotice({ headSha: review.headSha, reasonCode: review.statusReasonCode }),
  });
  return true;
}

// A push to the default branch used to cancel every in-flight review in the repository, so one
// routine merge silently killed every running review and nothing re-queued them. The base moving
// does not make the head commit's findings wrong - it makes them findings against an older base,
// which is a caveat the report can state. So the reviews keep running and are stamped here, and
// reviewPublicationWorker.publish says which base the verdict was reached against.
export async function recordBaseAdvance(
  ctx: MutationCtx,
  args: { repositoryId: Id<"repositories">; organizationId: Id<"organizations">; branch: string; afterSha: string; now: number },
) {
  const afterSha = args.afterSha.toLowerCase();
  let driftedCount = 0;
  for (const status of activeStatuses) {
    const reviews = await ctx.db.query("reviews")
      .withIndex("by_org_status", q => q.eq("organizationId", args.organizationId).eq("status", status))
      .take(200);
    for (const review of reviews) {
      if (review.repositoryId !== args.repositoryId || review.baseRef !== args.branch
        || review.baseSha.toLowerCase() === afterSha || review.observedBaseSha === afterSha) continue;
      await ctx.db.patch(review._id, { observedBaseSha: afterSha, baseAdvancedAt: args.now, updatedAt: args.now });
      driftedCount += 1;
    }
  }
  return { driftedCount };
}

// Read by the publisher, which has to name the base the verdict was actually reached against.
export const baseAdvance = internalQuery({
  args: { organizationId: v.id("organizations"), reviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
    if (!review.observedBaseSha || review.observedBaseSha === review.baseSha.toLowerCase()) return null;
    return { baseRef: review.baseRef, baseSha: review.baseSha.toLowerCase(), observedBaseSha: review.observedBaseSha };
  },
});

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
    // Called for the tenant assertion it throws, not for the row it returns.
    await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
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
    await publishCancellationNotice(ctx, args.reviewId);
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
    expectedHeadSha: v.string(), expectedGeneration: v.number(),
    operationKey: v.string(), type: value.sideEffectType, requestHash: v.string(), now: v.number(),
  },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
    if (
      review.headSha !== args.expectedHeadSha ||
      review.executionGeneration !== args.expectedGeneration ||
      review.isStale ||
      review.cancellationRequestedAt ||
      review.status === "cancelled"
    ) throw new ConvexError("side_effect_cancelled_or_replaced");
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
    // The review assertion runs for its throw; only the attempt row is read.
    const [, attempt] = await Promise.all([
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

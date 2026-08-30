import { vWorkflowId, type WorkflowId } from "@convex-dev/workflow";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { durableReviewStages } from "./lib/durableStages";
import { terminalStatuses } from "./lib/lifecycle";
import { reviewWorkflowManager } from "./workflowManager";
import { assertReviewParent } from "./lib/parentConsistency";

const executionArgs = {
  organizationId: v.id("organizations"),
  reviewId: v.id("reviews"),
  expectedHeadSha: v.string(),
  expectedGeneration: v.number(),
};

export const assertActive = internalQuery({
  args: executionArgs,
  handler: async (ctx, args) => {
    const review = await assertReviewParent(
      ctx.db,
      args.organizationId,
      args.reviewId,
    );
    if (
      review.headSha !== args.expectedHeadSha ||
      review.executionGeneration !== args.expectedGeneration ||
      review.isStale ||
      review.cancellationRequestedAt ||
      review.status === "cancelling" ||
      review.status === "cancelled" ||
      terminalStatuses.has(review.status)
    )
      throw new ConvexError("review_cancelled_or_replaced");
    return true;
  },
});

export const checkpoint = internalMutation({
  args: {
    organizationId: v.id("organizations"), reviewId: v.id("reviews"),
    expectedHeadSha: v.string(), expectedGeneration: v.number(),
    stage: v.union(v.literal("context"), v.literal("analysis"), v.literal("validation")),
    sequence: v.number(), now: v.number(),
  },
  handler: async (ctx, args): Promise<string> => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
    if (review.headSha !== args.expectedHeadSha) throw new ConvexError("stale_head");
    if (review.executionGeneration !== args.expectedGeneration || review.status === "cancelling" || review.status === "cancelled") throw new ConvexError("cancelled_or_replaced");
    if (terminalStatuses.has(review.status)) throw new ConvexError("review_is_terminal");
    const existing = await ctx.db.query("reviewEvents").withIndex("by_review", (q) => q.eq("reviewId", args.reviewId).eq("sequence", args.sequence)).unique();
    if (existing) {
      if (existing.stage !== args.stage || existing.type !== "stage_completed") throw new ConvexError("checkpoint_conflict");
      return existing._id;
    }
    const status = args.stage === "context" ? "analyzing" : "validating";
    await ctx.db.patch(args.reviewId, { currentStage: args.stage, status, updatedAt: args.now });
    return ctx.db.insert("reviewEvents", {
      organizationId: args.organizationId, reviewId: args.reviewId, sequence: args.sequence,
      type: "stage_completed", stage: args.stage, internalCode: `durable_${args.stage}_complete`,
      metadata: {}, createdAt: args.now,
    });
  },
});

export const execute = reviewWorkflowManager.define({
  args: {
    organizationId: v.id("organizations"), reviewId: v.id("reviews"),
    expectedHeadSha: v.string(), expectedGeneration: v.number(), startedAt: v.number(),
  },
  returns: v.null(),
}).handler(async (step, args): Promise<null> => {
  for (const [index, stage] of durableReviewStages.entries()) {
    if (stage === "context") {
      await step.runAction(internal.reviewContextWorker.gather, {
        organizationId: args.organizationId, reviewId: args.reviewId,
        expectedHeadSha: args.expectedHeadSha, expectedGeneration: args.expectedGeneration,
      });
    }
    if (stage === "analysis") {
      await step.runAction(internal.reviewAnalysisWorker.analyze, {
        organizationId: args.organizationId, reviewId: args.reviewId,
        expectedHeadSha: args.expectedHeadSha, expectedGeneration: args.expectedGeneration,
      });
    }
    if (stage === "validation") {
      await step.runAction(internal.reviewValidationWorker.validate, {
        organizationId: args.organizationId, reviewId: args.reviewId,
        expectedHeadSha: args.expectedHeadSha, expectedGeneration: args.expectedGeneration,
      });
    }
    await step.runMutation(internal.durableReview.checkpoint, {
      ...args, stage, sequence: index + 2, now: args.startedAt + index + 1,
    });
    if (stage === "analysis") {
      const mode = await step.runQuery(internal.reviewAutofixData.mode,{organizationId:args.organizationId,reviewId:args.reviewId,expectedHeadSha:args.expectedHeadSha,expectedGeneration:args.expectedGeneration});
      if(mode==="autofix"){
        try{const result=await step.runAction(internal.reviewAutofixWorker.runConvergence,{organizationId:args.organizationId,reviewId:args.reviewId,expectedHeadSha:args.expectedHeadSha,expectedGeneration:args.expectedGeneration});if(result.outcome==="passed")await step.runAction(internal.reviewAutofixWorker.deliverPassed,{organizationId:args.organizationId,reviewId:args.reviewId,expectedHeadSha:args.expectedHeadSha,expectedGeneration:args.expectedGeneration});else await step.runAction(internal.reviewAutofixWorker.publishFailure,{organizationId:args.organizationId,reviewId:args.reviewId,expectedHeadSha:args.expectedHeadSha,expectedGeneration:args.expectedGeneration})}catch(error){await step.runMutation(internal.reviewAutofixData.failPlatform,{organizationId:args.organizationId,reviewId:args.reviewId,expectedHeadSha:args.expectedHeadSha,expectedGeneration:args.expectedGeneration,code:error instanceof Error?error.message:"autofix_failed",now:args.startedAt+index+3})}
      }else{
        const report = await step.runAction(internal.reviewReportWorker.compose, { organizationId: args.organizationId, reviewId: args.reviewId, expectedHeadSha: args.expectedHeadSha, expectedGeneration: args.expectedGeneration });
        await step.runMutation(internal.reviewValidationData.finalizeDecision, { organizationId: args.organizationId, reviewId: args.reviewId, expectedHeadSha: args.expectedHeadSha, expectedGeneration: args.expectedGeneration, reportArtifactId: report.artifactId, now: args.startedAt + index + 2 });
        await step.runAction(internal.reviewPublicationWorker.publish, { organizationId: args.organizationId, reviewId: args.reviewId, expectedHeadSha: args.expectedHeadSha, expectedGeneration: args.expectedGeneration });
      }
    }
  }
  return null;
});

export const start = internalMutation({
  args: {
    organizationId: v.id("organizations"), reviewId: v.id("reviews"),
    expectedHeadSha: v.string(), expectedGeneration: v.number(), now: v.number(),
  },
  handler: async (ctx, args): Promise<string> => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
    if (review.workflowId) return review.workflowId;
    if (review.status !== "queued" || review.currentStage !== "queue" || review.isStale || review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration) throw new ConvexError("review_not_runnable");
    const workflowId: WorkflowId = await reviewWorkflowManager.start(ctx, internal.durableReview.execute, {
      organizationId: args.organizationId, reviewId: args.reviewId,
      expectedHeadSha: args.expectedHeadSha, expectedGeneration: args.expectedGeneration,
      startedAt: args.now,
    }, { startAsync: true });
    await ctx.db.patch(args.reviewId, { workflowId: String(workflowId), startedAt: args.now, updatedAt: args.now });
    return String(workflowId);
  },
});

export const cancel = internalMutation({
  args: { reviewId: v.id("reviews"), workflowId: vWorkflowId, actorId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review || review.workflowId !== String(args.workflowId)) throw new ConvexError("workflow_mismatch");
    // Cancellation is deliberately idempotent. A worker can finish or crash between
    // the database lookup and the workflow component call; that must not leave the
    // review looking active forever.
    try {
      await reviewWorkflowManager.cancel(ctx, args.workflowId);
    } catch {
      // The generation fence and terminal database state below remain the source of
      // truth. They prevent any late worker from publishing a side effect.
    }
    if (!terminalStatuses.has(review.status)) {
      await ctx.db.patch(args.reviewId, {
        status: "cancelled", statusReasonCode: "user_cancelled", nextActionCode: "start_new_review",
        cancelledBy: args.actorId, cancellationRequestedAt: args.now, completedAt: args.now,
        executionGeneration: review.executionGeneration + 1, leaseOwner: undefined,
        leaseExpiresAt: undefined, updatedAt: args.now,
      });
    }
  },
});

export const restart = internalMutation({
  args: { workflowId: vWorkflowId },
  handler: async (ctx, args) => reviewWorkflowManager.restart(ctx, args.workflowId),
});

export const reconcileStuck = internalMutation({
  args: { organizationId: v.id("organizations"), olderThan: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    const active = ["queued", "gathering_context", "analyzing", "validating", "autofix_queued", "autofixing", "validating_round", "validating_final"] as const;
    let reconciled = 0;
    for (const status of active) {
      const reviews = await ctx.db.query("reviews").withIndex("by_org_status", (q) => q.eq("organizationId", args.organizationId).eq("status", status)).take(100);
      for (const review of reviews) {
        if (review.updatedAt >= args.olderThan) continue;
        await ctx.db.patch(review._id, {
          status: "platform_failed", statusReasonCode: "platform_error",
          nextActionCode: "retry_review", completedAt: args.now,
          executionGeneration: review.executionGeneration + 1,
          leaseOwner: undefined, leaseExpiresAt: undefined, updatedAt: args.now,
        });
        reconciled += 1;
      }
    }
    return reconciled;
  },
});

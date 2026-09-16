import { vWorkflowId, type WorkflowId } from "@convex-dev/workflow";
import { vResultValidator, vWorkIdValidator } from "@convex-dev/workpool";
import { selectProviderModel } from "@buildit/providers";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { fallbackWorthTrying } from "./lib/providerFallback";
import { classifyPlatformFailure, type PlatformFailureReason } from "./lib/platformFailureReport";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { durableReviewStages, nextStageAfter } from "./lib/durableStages";
import { terminalStatuses } from "./lib/lifecycle";
import { publishCancellationNotice } from "./reviewState";
import { recordRunnerFailure } from "./lib/recordMetric";
import { queueReviewNotification } from "./lib/queueNotification";
import { getReviewBudgetSnapshot } from "./lib/budgetAccounting";
import { reviewWorkflowManager, reviewWorkpool } from "./workflowManager";

export function isSafeAutofixDecline(error: unknown) {
  return error instanceof Error && error.message === "autofix_no_accepted_findings";
}
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
    // Named for what runs NEXT, because that is what the person watching is waiting on. The stage
    // order was flipped to [context, validation, analysis] in 8150ae8 so validation evidence feeds
    // the model, and this mapping was left behind: the dashboard said "Reviewing code" while the
    // sandbox was running the checks, and "Running checks" while the model was reviewing. After the
    // last stage the review is composing and publishing its report, which the delivery path reads
    // as `validating` - finalizeDecision refuses any other status.
    const upcoming = nextStageAfter(durableReviewStages.slice(0, durableReviewStages.indexOf(args.stage) + 1));
    const status = upcoming === "analysis" ? "analyzing" : "validating";
    // Real time, unlike args.now, which is the workflow's deterministic clock. The stuck-review
    // sweeper reaps on inactivity and had nothing truthful to measure it against.
    await ctx.db.patch(args.reviewId, { currentStage: args.stage, status, lastProgressAt: Date.now(), updatedAt: args.now });
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
    const telemetry = stage === "context"
      ? { operation: "review.context" as const, stage: "context" as const }
      : stage === "analysis"
        ? { operation: "review.analysis" as const, stage: "analysis" as const }
        : { operation: "review.tests" as const, stage: "tests" as const };
    await step.runAction(internal.telemetryWorker.emit, { ...telemetry, outcome: "started" });
    try {
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
    } catch (error) {
      await step.runAction(internal.telemetryWorker.emit, { ...telemetry, outcome: "failed" });
      throw error;
    }
    await step.runAction(internal.telemetryWorker.emit, { ...telemetry, outcome: "succeeded" });
    await step.runMutation(internal.durableReview.checkpoint, {
      organizationId: args.organizationId, reviewId: args.reviewId,
      expectedHeadSha: args.expectedHeadSha, expectedGeneration: args.expectedGeneration,
      stage, sequence: index + 2, now: args.startedAt + index + 1,
    });
    if (stage === "analysis") {
      const mode = await step.runQuery(internal.reviewAutofixData.mode,{organizationId:args.organizationId,reviewId:args.reviewId,expectedHeadSha:args.expectedHeadSha,expectedGeneration:args.expectedGeneration});
      if(mode==="autofix"){
        await step.runAction(internal.telemetryWorker.emit,{operation:"review.autofix",stage:"autofix",outcome:"started"});
        try{const result=await step.runAction(internal.reviewAutofixWorker.runConvergence,{organizationId:args.organizationId,reviewId:args.reviewId,expectedHeadSha:args.expectedHeadSha,expectedGeneration:args.expectedGeneration});if(result.outcome==="passed")await step.runAction(internal.reviewAutofixWorker.deliverPassed,{organizationId:args.organizationId,reviewId:args.reviewId,expectedHeadSha:args.expectedHeadSha,expectedGeneration:args.expectedGeneration});else await step.runAction(internal.reviewAutofixWorker.publishFailure,{organizationId:args.organizationId,reviewId:args.reviewId,expectedHeadSha:args.expectedHeadSha,expectedGeneration:args.expectedGeneration});await step.runAction(internal.telemetryWorker.emit,{operation:"review.autofix",stage:"autofix",outcome:"succeeded"})}catch(error){
          if(isSafeAutofixDecline(error)){
            const report=await step.runAction(internal.reviewReportWorker.compose,{organizationId:args.organizationId,reviewId:args.reviewId,expectedHeadSha:args.expectedHeadSha,expectedGeneration:args.expectedGeneration});
            await step.runMutation(internal.reviewValidationData.finalizeDecision,{organizationId:args.organizationId,reviewId:args.reviewId,expectedHeadSha:args.expectedHeadSha,expectedGeneration:args.expectedGeneration,reportArtifactId:report.artifactId,now:args.startedAt+index+3});
            await step.runAction(internal.reviewPublicationWorker.publish,{organizationId:args.organizationId,reviewId:args.reviewId,expectedHeadSha:args.expectedHeadSha,expectedGeneration:args.expectedGeneration});
            await step.runAction(internal.telemetryWorker.emit,{operation:"review.autofix",stage:"autofix",outcome:"succeeded"});
          }else{
            await step.runAction(internal.telemetryWorker.emit,{operation:"review.autofix",stage:"autofix",outcome:"failed"});
            await step.runMutation(internal.reviewAutofixData.failPlatform,{organizationId:args.organizationId,reviewId:args.reviewId,expectedHeadSha:args.expectedHeadSha,expectedGeneration:args.expectedGeneration,code:error instanceof Error?error.message:"autofix_failed",now:args.startedAt+index+3});
            // Fall back to a second provider, or publish. This branch used to end by publishing
            // directly, and because autofix is the last stage the workflow then returned success -
            // so workflowCompleted, which only publishes on a failed result, wrote nothing, and its
            // provider-fallback block was unreachable for every autofix run. A rate limit that
            // BuildIT would have survived on the workspace's second key ended the run instead.
            await step.runMutation(internal.durableReview.fallbackOrReport,{organizationId:args.organizationId,reviewId:args.reviewId,expectedHeadSha:args.expectedHeadSha,expectedGeneration:args.expectedGeneration,now:args.startedAt+index+4});
          }
        }
      }else{
        await step.runAction(internal.telemetryWorker.emit,{operation:"review.delivery",stage:"delivery",outcome:"started"});
        try {
          const report = await step.runAction(internal.reviewReportWorker.compose, { organizationId: args.organizationId, reviewId: args.reviewId, expectedHeadSha: args.expectedHeadSha, expectedGeneration: args.expectedGeneration });
          await step.runMutation(internal.reviewValidationData.finalizeDecision, { organizationId: args.organizationId, reviewId: args.reviewId, expectedHeadSha: args.expectedHeadSha, expectedGeneration: args.expectedGeneration, reportArtifactId: report.artifactId, now: args.startedAt + index + 2 });
          await step.runAction(internal.reviewPublicationWorker.publish, { organizationId: args.organizationId, reviewId: args.reviewId, expectedHeadSha: args.expectedHeadSha, expectedGeneration: args.expectedGeneration });
          await step.runAction(internal.telemetryWorker.emit,{operation:"review.delivery",stage:"delivery",outcome:"succeeded"});
        } catch (error) {
          await step.runAction(internal.telemetryWorker.emit,{operation:"review.delivery",stage:"delivery",outcome:"failed",errorCode:/rate_limited/.test(String(error))?"rate_limited":/provider|model_unavailable|http_4|http_5/.test(String(error))?"provider_error":/sandbox|runner|execution/.test(String(error))?"runner_error":"UnknownError"});
          throw error;
        }
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
    }, {
      onComplete: internal.durableReview.workflowCompleted,
      context: {
        organizationId: args.organizationId,
        reviewId: args.reviewId,
        expectedGeneration: args.expectedGeneration,
      },
    });
    await ctx.db.patch(args.reviewId, { workflowId: String(workflowId), startedAt: args.now, updatedAt: args.now });
    return String(workflowId);
  },
});

// Publication is the whole output of the product: a review that reached a verdict and could not
// post it looks, on the pull request, exactly like a review that never ran. Both publishers used to
// be a bare `scheduler.runAfter(0, ...)`, which Convex runs exactly once - so a GitHub 5xx or a
// secondary rate limit outliving the workflow's ~4 seconds of step retries lost the report for
// good, while the dashboard showed a finished review. The pool retries with real backoff over
// roughly an hour, and publicationCompleted turns the last failure into something the author can
// see rather than silence.
const publicationRetry = { maxAttempts: 6, initialBackoffMs: 30_000, base: 3 } as const;

type PublicationScope = {
  organizationId: Doc<"reviews">["organizationId"];
  reviewId: Doc<"reviews">["_id"];
  expectedHeadSha: string;
  expectedGeneration: number;
};

async function enqueueVerdictPublication(ctx: MutationCtx, args: PublicationScope) {
  await reviewWorkpool.enqueueAction(ctx, internal.reviewPublicationWorker.publish, args, {
    retry: publicationRetry,
    onComplete: internal.durableReview.publicationCompleted,
    context: { reviewId: args.reviewId, kind: "verdict" as const },
  });
}

async function enqueueFailurePublication(ctx: MutationCtx, args: PublicationScope) {
  await reviewWorkpool.enqueueAction(ctx, internal.reviewPublicationWorker.publishPlatformFailure, args, {
    retry: publicationRetry,
    onComplete: internal.durableReview.publicationCompleted,
    context: { reviewId: args.reviewId, kind: "platform_failure" as const },
  });
}

// The last word when publication has run out of attempts. It goes up through acknowledge, which
// needs neither the broker nor a pull-request lookup and never throws into its caller, so it is the
// one message that can still land when the path that was supposed to carry the report cannot.
export const publicationCompleted = internalMutation({
  args: {
    workId: vWorkIdValidator,
    result: vResultValidator,
    context: v.object({
      reviewId: v.id("reviews"),
      kind: v.union(v.literal("verdict"), v.literal("platform_failure")),
    }),
  },
  handler: async (ctx, args) => {
    if (args.result.kind === "success") return;
    const review = await ctx.db.get(args.context.reviewId);
    if (!review) return;
    const repository = await ctx.db.get(review.repositoryId);
    const installation = repository ? await ctx.db.get(repository.installationId) : null;
    const last = await ctx.db
      .query("reviewEvents")
      .withIndex("by_review", q => q.eq("reviewId", review._id))
      .order("desc")
      .first();
    await ctx.db.insert("reviewEvents", {
      organizationId: review.organizationId,
      reviewId: review._id,
      sequence: (last?.sequence ?? 0) + 1,
      type: "delivery_recorded",
      stage: "complete",
      internalCode: "publication_gave_up",
      metadata: {},
      createdAt: Date.now(),
    });
    // A review cancelled or superseded while the retries were running has already had its own
    // notice posted on that commit; telling the author on top of it that a report could not be
    // delivered would replace an accurate message with a misleading one.
    if (!repository || !installation || review.status === "cancelled" || review.isStale) return;
    await ctx.scheduler.runAfter(0, internal.reviewPublicationWorker.acknowledge, {
      installationId: installation.installationId,
      githubRepositoryId: repository.githubRepositoryId,
      headSha: review.headSha,
      conclusion: "action_required",
      title: args.context.kind === "verdict"
        ? "BuildIT: the review finished but its report could not be posted"
        : "BuildIT: review did not complete",
      summary: [
        `Head: \`${review.headSha.toLowerCase()}\``,
        "",
        ...(args.context.kind === "verdict"
          ? ["BuildIT finished reviewing this commit, but GitHub would not accept the report for long enough that BuildIT stopped retrying.",
            "The result is on this review's page in BuildIT. No code was changed."]
          : ["BuildIT stopped before reaching a decision, and could not post why for long enough that it stopped retrying.",
            "No code decision was reached and no code was changed."]),
        "",
        "Comment `@buildit review` to start a new one.",
        "",
        "BuildIT did not merge this pull request.",
      ].join("\n"),
    });
  },
});

// The second connected provider is what makes a rate limit or a refused key recoverable rather than
// a dead end. This was written inline in workflowCompleted, which autofix never reaches, so an
// autofix run killed by its provider could not fall back to a key that would have rescued the
// identical `@buildit review`. Both paths call it here instead of keeping two copies.
// Stamped before the guards below, not after. A review that cannot start a fallback - because it
// is already one, or is stale, or is out of budget - still learned the same thing about the
// account, and that is exactly the review whose successor should not pick the same dead key.
async function recordQuotaExhaustion(ctx: MutationCtx, review: Doc<"reviews">, reason: PlatformFailureReason, now: number) {
  if (reason !== "provider_quota_exhausted") return;
  const credentials = await ctx.db
    .query("providerCredentials")
    .withIndex("by_org_status", q => q.eq("organizationId", review.organizationId).eq("status", "valid"))
    .collect();
  const used = credentials.filter(item => item.provider === review.provider
    && (item.repositoryId === review.repositoryId || item.repositoryId === undefined));
  for (const credential of used) await ctx.db.patch(credential._id, { quotaExhaustedAt: now });
}

async function startProviderFallback(
  ctx: MutationCtx,
  review: Doc<"reviews">,
  failureReason: PlatformFailureReason,
  now: number,
) {
  await recordQuotaExhaustion(ctx, review, failureReason, now);
  if (review.parentReviewId || review.isStale || review.status === "cancelled" || review.status === "cancelling"
    || review.cancellationRequestedAt !== undefined || review.expiresAt <= now) return false;
  let family: Awaited<ReturnType<typeof getReviewBudgetSnapshot>>;
  try { family = await getReviewBudgetSnapshot(ctx, review); }
  // Malformed or incomplete accounting must not start more paid work or roll back the
  // failure already being recorded. The caller will publish that original failure instead.
  catch { return false; }
  if (family.members.length > 1) return true; // A replay must not queue/pay for another child.
  if (family.consumedMicros + family.reservedMicros >= family.limitMicros) return false;
  const credentials = await ctx.db
    .query("providerCredentials")
    .withIndex("by_org_status", q => q.eq("organizationId", review.organizationId).eq("status", "valid"))
    .collect();
  const alternatives = [...new Set(credentials
    .filter(item => item.lastValidatedAt && item.provider !== review.provider
      && (item.repositoryId === undefined || item.repositoryId === review.repositoryId))
    .map(item => item.provider))];
  const fallback = fallbackWorthTrying({ reason: failureReason, alternatives, parentReviewId: review.parentReviewId });
  const fallbackCredential = fallback ? credentials.find(item => item.provider === fallback && item.repositoryId === review.repositoryId)
    ?? credentials.find(item => item.provider === fallback && item.repositoryId === undefined) : undefined;
  const fallbackModel = fallbackCredential
    ? selectProviderModel(fallbackCredential.provider, fallbackCredential.availableModels)
    : undefined;
  if (!fallback || !fallbackModel) return false;
  const { _id: _ignoredId, _creationTime: _ignoredAt, ...carried } = review;
  const retryId = await ctx.db.insert("reviews", {
    ...carried,
    parentReviewId: review._id,
    provider: fallback as typeof review.provider,
    model: fallbackModel,
    status: "queued",
    statusReasonCode: undefined,
    statusDetail: undefined,
    nextActionCode: "none",
    githubCheckConclusion: undefined,
    currentStage: "queue",
    coverageLevel: "limited",
    coverageGap: undefined,
    // This is the child's own recorded usage. Admission sums the original review and
    // every fallback under the original limit; this zero never grants a fresh allowance.
    budgetConsumed: 0,
    providerRetryCount: 0,
    executionGeneration: 0,
    workflowId: undefined,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    completedAt: undefined,
    startedAt: undefined,
    lastProgressAt: undefined,
    promptInjectionUnscopedAt: undefined,
    createdAt: now,
    updatedAt: now,
  });
  const last = await ctx.db
    .query("reviewEvents")
    .withIndex("by_review", q => q.eq("reviewId", review._id))
    .order("desc")
    .first();
  await ctx.db.insert("reviewEvents", {
    organizationId: review.organizationId, reviewId: review._id, sequence: (last?.sequence ?? 0) + 1,
    type: "status_changed", stage: "complete", internalCode: "provider_fallback_started", metadata: {}, createdAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.durableReview.start, {
    organizationId: review.organizationId, reviewId: retryId,
    expectedHeadSha: review.headSha, expectedGeneration: 0, now,
  });
  return true;
}

// Reached only from the autofix branch, which records its own platform failure and so can never
// arrive at workflowCompleted's failed result. Without this, a second connected key was invisible
// to autofix and the run always ended on the generic "a required platform step failed".
export const fallbackOrReport = internalMutation({
  args: { ...executionArgs, now: v.number() },
  handler: async (ctx, args): Promise<"fallback_started" | "failure_published"> => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration)
      throw new ConvexError("cancelled_or_replaced");
    if (await startProviderFallback(ctx, review, classifyPlatformFailure(review.statusReasonCode ?? ""), args.now))
      return "fallback_started";
    await enqueueFailurePublication(ctx, {
      organizationId: args.organizationId, reviewId: args.reviewId,
      expectedHeadSha: args.expectedHeadSha, expectedGeneration: args.expectedGeneration,
    });
    return "failure_published";
  },
});

// A workflow component records its own terminal result outside our review row.
// Mirror only a failed/cancelled outcome into the tenant-scoped review so the
// UI never presents a failed workflow as an indefinitely running review.
export const workflowCompleted = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({
      organizationId: v.id("organizations"),
      reviewId: v.id("reviews"),
      expectedGeneration: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(
      ctx.db,
      args.context.organizationId,
      args.context.reviewId,
    );
    if (
      review.workflowId !== String(args.workflowId) ||
      review.executionGeneration !== args.context.expectedGeneration ||
      terminalStatuses.has(review.status)
    ) {
      // A failure after finalizeDecision used to be discarded entirely: the review was already
      // terminal, so this returned before writing anything. That is exactly how a publication
      // failure hid - the dashboard showed a finished review while no comment or check run ever
      // reached the pull request, which is the one thing the product exists to do. The verdict is
      // not overwritten, because it was legitimately reached. The failure is recorded, and
      // publication is retried, which is idempotent through reserveSideEffect.
      const failedAfterDecision =
        args.result.kind === "failed" &&
        review.workflowId === String(args.workflowId) &&
        review.executionGeneration === args.context.expectedGeneration &&
        terminalStatuses.has(review.status);
      if (!failedAfterDecision) return;
      const failedAt = Date.now();
      const last = await ctx.db
        .query("reviewEvents")
        .withIndex("by_review", (q) => q.eq("reviewId", review._id))
        .order("desc")
        .first();
      await ctx.db.insert("reviewEvents", {
        organizationId: review.organizationId,
        reviewId: review._id,
        sequence: (last?.sequence ?? 0) + 1,
        type: "delivery_recorded",
        stage: "complete",
        internalCode: "workflow_failed_after_decision",
        metadata: {},
        createdAt: failedAt,
      });
      await ctx.scheduler.runAfter(0, internal.telemetryWorker.emit, {
        operation: "review.delivery",
        stage: "delivery",
        outcome: "failed",
      });
      if (review.status === "budget_exhausted") {
        const repository = await ctx.db.get(review.repositoryId);
        const installation = repository ? await ctx.db.get(repository.installationId) : null;
        if (repository && installation) {
          await ctx.scheduler.runAfter(0, internal.reviewPublicationWorker.acknowledge, {
            installationId: installation.installationId,
            githubRepositoryId: repository.githubRepositoryId,
            headSha: review.headSha,
            conclusion: "action_required",
            title: "BuildIT stopped at this review's spending limit",
            summary: [
              `Head: \`${review.headSha.toLowerCase()}\``,
              "",
              `BuildIT reached the $${review.budgetLimit} limit chosen for this review and stopped further model work. Recorded estimates and unresolved calls are shown in Usage.`,
              "",
              "No code decision was reached and no code was changed. Start a new review with a higher limit to continue.",
              "",
              "BuildIT did not merge this pull request.",
            ].join("\n"),
          });
        }
        return;
      }
      await enqueueVerdictPublication(ctx, {
        organizationId: review.organizationId,
        reviewId: review._id,
        expectedHeadSha: review.headSha,
        expectedGeneration: review.executionGeneration,
      });
      return;
    }
    if (args.result.kind === "failed") {
      const now = Date.now();
      const failureReason = classifyPlatformFailure(args.result.error);
      await recordRunnerFailure(ctx, review, args.result.error, now);
      const failureDetailText = args.result.error.match(/(?:files|limit|status)=[^\s"]*/)?.[0]
        ? args.result.error.slice(args.result.error.indexOf("files=")).split(/[\s"]/)[0]
        : undefined;
      const nextGeneration = review.executionGeneration + 1;
      await ctx.db.patch(review._id, {
        status: "platform_failed",
        statusReasonCode: failureReason,
        ...(failureDetailText ? { statusDetail: failureDetailText } : {}),
        nextActionCode: "retry_review",
        currentStage: "complete",
        completedAt: now,
        executionGeneration: nextGeneration,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
      const last = await ctx.db
        .query("reviewEvents")
        .withIndex("by_review", (q) => q.eq("reviewId", review._id))
        .order("desc")
        .first();
      await ctx.db.insert("reviewEvents", {
        organizationId: review.organizationId,
        reviewId: review._id,
        sequence: (last?.sequence ?? 0) + 1,
        type: "status_changed",
        stage: "complete",
        internalCode: "workflow_failed",
        metadata: {},
        createdAt: now,
      });
      if (await startProviderFallback(ctx, review, failureReason, now)) return;
      await queueReviewNotification(ctx, review._id, now);
      await enqueueFailurePublication(ctx, {
        organizationId: review.organizationId,
        reviewId: review._id,
        expectedHeadSha: review.headSha,
        expectedGeneration: nextGeneration,
      });
    }
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
      // Cancelling used to be a database write and nothing else, so the acknowledgement check run
      // this review put up stayed in_progress on the head commit forever. Where "BuildIT / review"
      // is a required check, that made BuildIT the reason the pull request could not be merged.
      await publishCancellationNotice(ctx, args.reviewId);
      await queueReviewNotification(ctx, args.reviewId, args.now);
    }
  },
});

export const restart = internalMutation({
  args: { workflowId: vWorkflowId },
  handler: async (ctx, args) => reviewWorkflowManager.restart(ctx, args.workflowId),
});

// This is internal-only operational state. It deliberately maps a component
// failure to a short code: workflow errors can contain provider or source
// details and must never be exposed to a browser or telemetry stream.
export const workflowRuntimeStatus = internalQuery({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review?.workflowId) return { state: "not_started" as const };
    const status = await reviewWorkflowManager.status(ctx, review.workflowId as WorkflowId);
    if (status.type === "inProgress") return { state: "in_progress" as const, runningStepCount: status.running.length };
    if (status.type === "completed") return { state: "completed" as const };
    if (status.type === "canceled") return { state: "cancelled" as const };
    return { state: "failed" as const, failureCode: safeWorkflowFailureCode(status.error) };
  },
});

function safeWorkflowFailureCode(error: string): "configuration_missing" | "upstream_unavailable" | "unknown" {
  if (error.includes("missing_")) return "configuration_missing";
  if (error.includes("analysis_") || error.includes("context_") || error.includes("pull_request_") || error.includes("package_manager_") || error.includes("paired_") || error.includes("artifact_") || error.includes("github_") || error.includes("provider_") || error.includes("model_") || error.includes("malformed_") || error.includes("execution_") || error.includes("validation_") || error.includes("scanner_") || error.includes("runner_")) return "upstream_unavailable";
  return "unknown";
}

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
        await queueReviewNotification(ctx, review._id, args.now);
        reconciled += 1;
      }
    }
    return reconciled;
  },
});

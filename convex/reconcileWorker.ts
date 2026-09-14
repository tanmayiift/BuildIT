import type { WorkflowId } from "@convex-dev/workflow";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { activeStatuses, executionReapReason, executionReviewLive, terminalStatuses, webhookDeliveryRetentionMs } from "./lib/lifecycle";
import { publishCancellationNotice } from "./reviewState";
import { reviewWorkflowManager } from "./workflowManager";

// durableReview.reconcileStuck and reviewState.expireBlocked were both implemented, exported and
// never called: convex/crons.ts declared only artifact cleanup and the telemetry snapshot. A
// review stuck mid-stage and a blocked review past its TTL therefore stayed that way for good,
// showing as "In progress" to the person waiting on it. reconcileStuck also takes an
// organizationId, so nothing could have scheduled it as written.
//
// It compares review.updatedAt, which durableReview.checkpoint writes from a synthetic clock
// (args.startedAt + index) because a Convex workflow body must be deterministic - so that value
// is not real time and cannot measure staleness. checkpoint stamps lastProgressAt from the
// mutation, which is real time, and that is the heartbeat this reaps on.
//
// Row age was the wrong clock. It measured how long ago the review was CREATED, so a review that
// was progressing normally through a long validation, and a review that had not started because
// the step pool was full, were both killed at two hours and told they had stopped responding -
// while the generation bump silently discarded whatever the still-live workflow went on to decide.
const stuckAfterMs = 2 * 60 * 60_000;
// The workflow component is asked whether the review is genuinely still running, but a workflow
// that says "in progress" forever would be a non-terminal state with no way out, so this is the
// bound past which the review is retired regardless of what the component reports.
const giveUpAfterMs = 12 * 60 * 60_000;
const sweepLimit = 200;

// Any failure to read the component is treated as no answer: one unreadable workflow must not stop
// the sweep from retiring the rest of the batch.
async function workflowStillRunning(ctx: MutationCtx, workflowId: string | undefined) {
  if (!workflowId) return false;
  try {
    const status = await reviewWorkflowManager.status(ctx, workflowId as WorkflowId);
    return status.type === "inProgress";
  } catch {
    return false;
  }
}

// Whatever gave up on the review, the review itself still has to end somewhere: left active it
// shows as "In progress" for ever against a pull request nothing is going to answer. Both sweeps
// below retire one the same way and say the same thing on the commit, derived here once - two
// copies would drift and the author would get two different accounts of the same silence.
//
// Re-reads the row rather than taking the caller's copy, because several dead execution jobs can
// share one review and the job sweep runs before the review sweep sees the same row.
async function retireReview(ctx: MutationCtx, reviewId: Id<"reviews">, now: number) {
  const review = await ctx.db.get(reviewId);
  if (!review || terminalStatuses.has(review.status)) return false;
  await ctx.db.patch(review._id, {
    status: "platform_failed", statusReasonCode: "platform_error", nextActionCode: "retry_review",
    githubCheckConclusion: "neutral", currentStage: "complete", completedAt: now,
    executionGeneration: review.executionGeneration + 1,
    leaseOwner: undefined, leaseExpiresAt: undefined, updatedAt: now,
  });
  const repository = await ctx.db.get(review.repositoryId);
  const installation = repository ? await ctx.db.get(repository.installationId) : null;
  if (repository && installation) {
    await ctx.scheduler.runAfter(0, internal.reviewPublicationWorker.acknowledge, {
      installationId: installation.installationId,
      githubRepositoryId: repository.githubRepositoryId,
      headSha: review.headSha,
      conclusion: "action_required",
      title: "BuildIT: review did not complete",
      summary: [
        `Head: \`${review.headSha.toLowerCase()}\``,
        "",
        "This review stopped responding and BuildIT gave up on it. No code decision was reached and no code was changed.",
        "",
        "Comment `@buildit review` to start a new one.",
        "",
        "BuildIT did not merge this pull request.",
      ].join("\n"),
    });
  }
  return true;
}

// Non-terminal job statuses, in the order the by_lease index stores them. `completed`, `failed` and
// `cancelled` are excluded deliberately: they are already the end of the row, and re-reading them
// every ten minutes would make the sweep grow with the table instead of with the backlog.
const reapableJobStatuses = ["queued", "running", "checkpointed"] as const;

// One dead job, decided and written on its own so that a row the sweep must refuse to act on is
// one lost row rather than a batch that never completes.
async function reapJob(ctx: MutationCtx, job: Doc<"executionJobs">, now: number) {
  const review = await ctx.db.get(job.reviewId);
  // by_lease spans every tenant - it is keyed on status, not on organization. A row whose review
  // belongs to a different organization violates the parent-consistency policy executionJobs
  // declares, and retiring it would put a "review did not complete" check run on another tenant's
  // repository on the strength of that corruption. This is the bad row the batch has to survive
  // rather than act on, which is why the loop counts it instead of letting it end the sweep.
  if (review && review.organizationId !== job.organizationId) throw new ConvexError("execution_job_scope_mismatch");
  const reason = executionReapReason({
    attempt: job.attempt, createdAt: job.createdAt, leaseUntil: job.leaseUntil,
    reviewLive: executionReviewLive(review, job), now,
  });
  if (!reason) return false;
  await ctx.db.patch(job._id, {
    status: "failed", failureCode: reason, updatedAt: now,
    // leaseOwner and leaseUntil are deliberately left exactly as the dead worker left them.
    // executionJobsData.fail clears them so a later worker can retry the stage, which is right for
    // a stage that failed and wrong for a job that has been declared dead: clearing the lease here
    // would hand the job straight back to the next worker and rebuild the unbounded loop this
    // sweep exists to end. The stale lease is also the only record of which worker was holding the
    // job when it went quiet. Re-claiming is refused by the failure code, in executionJobsData.claim.
    sandboxReclaimAt: job.sandboxReclaimAt ?? now,
    sandboxReclaimAttempts: job.sandboxReclaimAttempts ?? 0,
  });
  await retireReview(ctx, job.reviewId, now);
  return true;
}

export const sweep = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    let expired = 0, reconciled = 0, deliveriesDeleted = 0;

    // webhookDeliveries grows with commit volume rather than review volume, so it outruns every
    // other table and had no expiry at all. Swept here rather than under a fifth cron, because
    // this one already exists to retire things whose time is up.
    //
    // Convex orders an absent field before every number, so lt(now) also matches every row
    // recorded before expiresAt existed - regardless of age. Deleting those on sight would throw
    // away the dedupe backlog that stops a GitHub redelivery starting a second review, so a row
    // without a stamp gets one from when it arrived and ages out on the same rule as the rest.
    const staleDeliveries = await ctx.db.query("webhookDeliveries").withIndex("by_expiry", q => q.lt("expiresAt", now)).take(sweepLimit);
    for (const delivery of staleDeliveries) {
      if (delivery.expiresAt === undefined) {
        await ctx.db.patch(delivery._id, { expiresAt: delivery.receivedAt + webhookDeliveryRetentionMs });
        continue;
      }
      await ctx.db.delete(delivery._id);
      deliveriesDeleted += 1;
    }

    const blocked = await ctx.db.query("reviews").withIndex("by_status", q => q.eq("status", "blocked")).take(sweepLimit);
    for (const review of blocked) {
      if (!review.blockedExpiresAt || review.blockedExpiresAt > now) continue;
      await ctx.db.patch(review._id, {
        status: "cancelled", statusReasonCode: "blocked_expired", nextActionCode: "start_new_review",
        completedAt: now, executionGeneration: review.executionGeneration + 1,
        leaseOwner: undefined, leaseExpiresAt: undefined, updatedAt: now,
      });
      // Expiring a blocked review is a cancellation like any other, and it left the same stuck
      // in_progress check run behind: the author saw "BuildIT is reviewing this pull request"
      // against a review that had been given up on hours earlier.
      await publishCancellationNotice(ctx, review._id);
      expired += 1;
    }

    for (const status of activeStatuses) {
      if (status === "blocked") continue;
      const reviews = await ctx.db.query("reviews").withIndex("by_status", q => q.eq("status", status)).take(sweepLimit);
      for (const review of reviews) {
        const idleSince = review.lastProgressAt ?? review.startedAt ?? review._creationTime;
        if (idleSince + stuckAfterMs > now) continue;
        if (review._creationTime + giveUpAfterMs > now && await workflowStillRunning(ctx, review.workflowId)) continue;
        if (await retireReview(ctx, review._id, now)) reconciled += 1;
      }
    }

    // by_lease is ["status", "leaseUntil"] and had no reader anywhere, which is why nothing ever
    // noticed an abandoned job. Convex orders an absent field before every number, so lt(now) also
    // matches a row holding no lease at all - and that is wanted here: a `checkpointed` job whose
    // next segment never arrived holds no lease and is precisely the leak this sweep exists for.
    // Within `running` the index orders by leaseUntil ascending, so a bounded batch takes the
    // longest-expired leases first rather than an arbitrary slice.
    let jobsReaped = 0, jobsUnreapable = 0;
    for (const status of reapableJobStatuses) {
      const jobs = await ctx.db.query("executionJobs").withIndex("by_lease", q => q.eq("status", status).lt("leaseUntil", now)).take(sweepLimit);
      for (const job of jobs) {
        try {
          if (await reapJob(ctx, job, now)) jobsReaped += 1;
        } catch {
          // Same rule as workflowStillRunning above: one row that cannot be read or patched must
          // not stop the batch from reaping the rest, and it is still counted so the failure is
          // visible rather than silently skipped.
          jobsUnreapable += 1;
        }
      }
    }
    // A sandbox bills by the minute, so waiting for the reclaim cron's own tick would pay for up to
    // another ten minutes of a sandbox already known to be orphaned. The cron stays as the backstop
    // for rows whose broker call failed; this is the immediate pass.
    if (jobsReaped > 0) await ctx.scheduler.runAfter(0, internal.sandboxReclaimWorker.reclaim, {});

    return { expired, reconciled, deliveriesDeleted, jobsReaped, jobsUnreapable };
  },
});

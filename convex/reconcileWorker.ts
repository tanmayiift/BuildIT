import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { activeStatuses, webhookDeliveryRetentionMs } from "./lib/lifecycle";

// durableReview.reconcileStuck and reviewState.expireBlocked were both implemented, exported and
// never called: convex/crons.ts declared only artifact cleanup and the telemetry snapshot. A
// review stuck mid-stage and a blocked review past its TTL therefore stayed that way for good,
// showing as "In progress" to the person waiting on it. reconcileStuck also takes an
// organizationId, so nothing could have scheduled it as written.
//
// It compares review.updatedAt, which durableReview.checkpoint writes from a synthetic clock
// (args.startedAt + index) because a Convex workflow body must be deterministic - so that value
// is not real time and cannot measure staleness. _creationTime is stamped by the database and is,
// which is why it is the clock used here.
const stuckAfterMs = 2 * 60 * 60_000;
const sweepLimit = 200;

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
      expired += 1;
    }

    for (const status of activeStatuses) {
      if (status === "blocked") continue;
      const reviews = await ctx.db.query("reviews").withIndex("by_status", q => q.eq("status", status)).take(sweepLimit);
      for (const review of reviews) {
        if (review._creationTime + stuckAfterMs > now) continue;
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
        reconciled += 1;
      }
    }
    return { expired, reconciled, deliveriesDeleted };
  },
});

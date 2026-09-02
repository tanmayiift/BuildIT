import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { activeStatuses } from "./lib/lifecycle";

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
    let expired = 0, reconciled = 0;

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
        reconciled += 1;
      }
    }
    return { expired, reconciled };
  },
});

import { v } from "convex/values";
import { blockingFindingCount } from "./lib/blockingFindings";
import { query } from "./_generated/server";
import { requireOrganizationRole, requireRepositoryRole } from "./lib/authz";
import { totalCostUsd } from "./lib/usageCost";

const rowCeiling = 500;

// What BuildIT has actually done here, and what it cost. Everything comes from records that already
// exist - reviews, findings, the usage ledger, and the feedback a person gave - rather than from a
// second tally kept alongside them, because a number computed twice is a number that disagrees with
// itself eventually.
//
// Cost comes from usageLedger, the same source the Usage page reads, so the two always agree.
export const summary = query({
  args: { organizationId: v.id("organizations"), repositoryId: v.optional(v.id("repositories")), since: v.number() },
  handler: async (ctx, args) => {
    await requireOrganizationRole(ctx, args.organizationId, "viewer");
    if (args.repositoryId) await requireRepositoryRole(ctx, args.repositoryId, "viewer", args.organizationId);

    const reviews = (await ctx.db.query("reviews")
      .withIndex("by_org_created", q => q.eq("organizationId", args.organizationId).gte("createdAt", args.since))
      .take(rowCeiling))
      .filter(review => !args.repositoryId || review.repositoryId === args.repositoryId);

    const ledger = await ctx.db.query("usageLedger")
      .withIndex("by_org_time", q => q.eq("organizationId", args.organizationId).gte("occurredAt", args.since))
      .take(rowCeiling * 4);
    const costByReview = new Map<string, typeof ledger>();
    for (const row of ledger) {
      if (!row.reviewId) continue;
      costByReview.set(String(row.reviewId), [...(costByReview.get(String(row.reviewId)) ?? []), row]);
    }

    const decisive = new Set(["checks_passed", "changes_requested", "delivered"]);
    const pullRequests = [];
    let accepted = 0, dismissed = 0;

    for (const review of reviews) {
      const findings = await ctx.db.query("findings").withIndex("by_review_severity", q => q.eq("reviewId", review._id)).collect();
      const feedback = await ctx.db.query("findingFeedback").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
      accepted += feedback.filter(item => item.verdict === "accepted").length;
      dismissed += feedback.filter(item => item.verdict === "dismissed").length;

      pullRequests.push({
        reviewId: review._id, prNumber: review.prNumber, repositoryId: review.repositoryId,
        status: review.status, reason: review.statusReasonCode ?? null,
        // "why was this inconclusive" is the question a reader actually has.
        incompleteReason: review.coverageGap ?? null,
        trigger: review.trigger,
        blocking: blockingFindingCount(findings),
        findings: findings.filter(item => item.resolution !== "dismissed").length,
        accepted: feedback.filter(item => item.verdict === "accepted").length,
        dismissed: feedback.filter(item => item.verdict === "dismissed").length,
        costUsd: totalCostUsd(costByReview.get(String(review._id)) ?? []),
        // Wall clock, which is what a person waited, not the sum of stage times.
        durationMs: review.completedAt && review.startedAt ? review.completedAt - review.startedAt : null,
        stale: review.isStale, createdAt: review.createdAt,
      });
    }

    // Triage order: what BuildIT actually found, never a risk score it would have to invent.
    // Blocking findings first, then a review that could not decide, then everything else newest
    // first - a stale verdict outranks a fresh one with nothing in it.
    const ranked = [...pullRequests].sort((left, right) =>
      right.blocking - left.blocking
      || Number(right.status === "inconclusive") - Number(left.status === "inconclusive")
      || Number(right.stale) - Number(left.stale)
      || right.createdAt - left.createdAt);

    return {
      pullRequests: ranked.slice(0, 100),
      totals: {
        reviews: reviews.length,
        decisive: reviews.filter(review => decisive.has(review.status)).length,
        inconclusive: reviews.filter(review => review.status === "inconclusive").length,
        platformFailed: reviews.filter(review => review.status === "platform_failed").length,
        automatic: reviews.filter(review => review.trigger === "automatic").length,
        costUsd: totalCostUsd(ledger),
        accepted, dismissed,
      },
    };
  },
});

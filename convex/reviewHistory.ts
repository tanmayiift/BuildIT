import { v } from "convex/values";
import { blockingFindingCount } from "./lib/blockingFindings";
import { distinctFindingOpinions } from "./lib/findingOpinions";
import { query } from "./_generated/server";
import { requireOrganizationRole, requireRepositoryRole } from "./lib/authz";
import { parentScopeChecker } from "./lib/parentScope";
import { totalCostUsd } from "./lib/usageCost";

const reviewCeiling = 500, ledgerCeiling = 2_000, detailCeiling = 100, childCeiling = 100;
const decisive = new Set(["checks_passed", "changes_requested", "delivered"]);

export const summary = query({
  args: { organizationId: v.id("organizations"), repositoryId: v.optional(v.id("repositories")), since: v.number(), refreshKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireOrganizationRole(ctx, args.organizationId, "viewer");
    if (!Number.isFinite(args.since)) throw new Error("invalid_time_window");
    if (args.repositoryId) await requireRepositoryRole(ctx, args.repositoryId, "viewer", args.organizationId);
    const observedAt = Date.now();
    const until = (Math.floor(observedAt / 86_400_000) + 1) * 86_400_000;
    const [reviewRows, ledgerRows] = await Promise.all([
      args.repositoryId
        ? ctx.db.query("reviews").withIndex("by_repo_created", q => q.eq("repositoryId", args.repositoryId!).gte("createdAt", args.since).lt("createdAt", until)).order("desc").take(reviewCeiling + 1)
        : ctx.db.query("reviews").withIndex("by_org_created", q => q.eq("organizationId", args.organizationId).gte("createdAt", args.since).lt("createdAt", until)).order("desc").take(reviewCeiling + 1),
      args.repositoryId
        ? ctx.db.query("usageLedger").withIndex("by_repo_time", q => q.eq("repositoryId", args.repositoryId!).gte("occurredAt", args.since).lt("occurredAt", until)).order("desc").take(ledgerCeiling + 1)
        : ctx.db.query("usageLedger").withIndex("by_org_time", q => q.eq("organizationId", args.organizationId).gte("occurredAt", args.since).lt("occurredAt", until)).order("desc").take(ledgerCeiling + 1),
    ]);
    const scope = parentScopeChecker(ctx, args.organizationId);
    const reviews: typeof reviewRows = [], ledger: typeof ledgerRows = [];
    for (const row of reviewRows.slice(0, reviewCeiling)) {
      if (!scope.canCheck({ repositoryId: row.repositoryId })) break;
      await scope.repository(row.repositoryId);
      if (row.organizationId !== args.organizationId) throw new Error("not_found_or_forbidden");
      reviews.push(row);
    }
    for (const row of ledgerRows.slice(0, ledgerCeiling)) {
      if (!scope.canCheck(row)) break;
      const parent = await scope.review(row.reviewId);
      await scope.repository(row.repositoryId);
      if (row.organizationId !== args.organizationId || parent.repositoryId !== row.repositoryId) throw new Error("not_found_or_forbidden");
      if (row.roundId) await scope.round(row.roundId, row.reviewId);
      ledger.push(row);
    }
    const costPending = ledger.some(row => row.costStatus === "unknown");
    const costByReview = new Map<string, typeof ledger>();
    for (const row of ledger) costByReview.set(String(row.reviewId), [...(costByReview.get(String(row.reviewId)) ?? []), row]);
    const details = reviews.slice(0, detailCeiling);
    const partial = { reviews: reviewRows.length > reviews.length, spend: ledgerRows.length > ledger.length || costPending, findings: reviews.length > detailCeiling, feedback: reviews.length > detailCeiling, list: reviews.length > detailCeiling };
    let accepted = 0, dismissed = 0;
    const pullRequests = [];
    // At most 100 * (101 + 101) child rows, plus the two bounded parent reads. A busy
    // workspace receives an explicitly partial answer instead of an oversized live query.
    for (const review of details) {
      const [findingRows, feedbackRows] = await Promise.all([
        ctx.db.query("findings").withIndex("by_review_severity", q => q.eq("reviewId", review._id)).take(childCeiling + 1),
        ctx.db.query("findingFeedback").withIndex("by_review_time", q => q.eq("reviewId", review._id)).order("desc").take(childCeiling + 1),
      ]);
      if (findingRows.some(row => row.organizationId !== args.organizationId) || feedbackRows.some(row => row.organizationId !== args.organizationId || row.repositoryId !== review.repositoryId)) throw new Error("not_found_or_forbidden");
      const findings = findingRows.slice(0, childCeiling), feedback = distinctFindingOpinions(feedbackRows.slice(0, childCeiling));
      const findingsPartial = findingRows.length > childCeiling, feedbackPartial = feedbackRows.length > childCeiling;
      partial.findings ||= findingsPartial; partial.feedback ||= feedbackPartial;
      const acceptedHere = feedback.filter(item => item.verdict === "accepted").length, dismissedHere = feedback.filter(item => item.verdict === "dismissed").length;
      accepted += acceptedHere; dismissed += dismissedHere;
      pullRequests.push({
        reviewId: review._id, repositoryId: review.repositoryId, prNumber: review.prNumber,
        status: review.status, reason: review.statusReasonCode ?? null, incompleteReason: review.coverageGap ?? null,
        trigger: review.trigger, blocking: blockingFindingCount(findings), findings: findings.filter(item => item.resolution !== "dismissed").length,
        accepted: acceptedHere, dismissed: dismissedHere, findingsPartial, feedbackPartial, costPartial: partial.spend, costPending: (costByReview.get(String(review._id)) ?? []).some(row => row.costStatus === "unknown"),
        costUsd: totalCostUsd(costByReview.get(String(review._id)) ?? []),
        // completedAt is a workflow sequencing timestamp on existing successful runs. It does
        // not measure the person's wait, so an unmeasured duration is unknown, never zero.
        durationMs: null, stale: review.isStale, createdAt: review.createdAt,
      });
    }
    pullRequests.sort((left, right) => right.blocking - left.blocking || Number(right.status === "inconclusive") - Number(left.status === "inconclusive") || Number(right.stale) - Number(left.stale) || right.createdAt - left.createdAt);
    return {
      pullRequests, partial, observedAt, costPending, window: { since: args.since, until },
      limits: { reviews: reviewCeiling, ledger: ledgerCeiling, details: detailCeiling, childrenPerReview: childCeiling },
      totals: {
        reviews: reviews.length, decisive: reviews.filter(review => decisive.has(review.status)).length,
        inconclusive: reviews.filter(review => review.status === "inconclusive").length,
        platformFailed: reviews.filter(review => review.status === "platform_failed").length,
        automatic: reviews.filter(review => review.trigger === "automatic").length,
        costUsd: totalCostUsd(ledger), accepted, dismissed,
      },
    };
  },
});

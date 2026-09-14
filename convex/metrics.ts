import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrganizationRole, requireRepositoryRole } from "./lib/authz";
import { parentScopeChecker, summaryRowCeiling } from "./lib/parentScope";
import { utcWeek } from "./lib/reportingPeriod";
import type { WorkspaceMetricsSummary } from "./lib/workspaceFigureTypes";

export const summarize = query({
  args: {
    organizationId: v.id("organizations"),
    repositoryId: v.optional(v.id("repositories")),
    since: v.optional(v.number()),
    refreshKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<WorkspaceMetricsSummary> => {
    await requireOrganizationRole(ctx, args.organizationId, "viewer");
    if (args.repositoryId) await requireRepositoryRole(ctx, args.repositoryId, "viewer", args.organizationId);
    const now = Date.now(), since = args.since ?? utcWeek(now), until = utcWeek(now) + 7 * 86_400_000;
    if (!Number.isFinite(since)) throw new Error("invalid_reporting_period");
    const source = args.repositoryId
      ? ctx.db.query("metricEvents").withIndex("by_repo_time", q => q.eq("repositoryId", args.repositoryId).gte("occurredAt", since).lt("occurredAt", until))
      : ctx.db.query("metricEvents").withIndex("by_org_time", q => q.eq("organizationId", args.organizationId).gte("occurredAt", since).lt("occurredAt", until));
    const window = await source.order("desc").take(summaryRowCeiling + 1);
    const events = window.slice(0, summaryRowCeiling);
    const totals: Record<string, number> = {};
    const scope = parentScopeChecker(ctx, args.organizationId);
    let recordCount = 0;
    for (const event of events) {
      if (!scope.canCheck(event)) break;
      if (event.organizationId !== args.organizationId) throw new Error("not_found_or_forbidden");
      if (event.repositoryId) await scope.repository(event.repositoryId);
      if (event.reviewId) {
        const review = await scope.review(event.reviewId);
        await scope.repository(review.repositoryId);
        if (event.repositoryId && review.repositoryId !== event.repositoryId) throw new Error("not_found_or_forbidden");
      }
      if (event.roundId) {
        if (!event.reviewId) throw new Error("not_found_or_forbidden");
        await scope.round(event.roundId, event.reviewId);
      }
      totals[event.name] = (totals[event.name] ?? 0) + event.value;
      recordCount++;
    }
    const organization = await ctx.db.get(args.organizationId);
    const trackingSince = organization?.metricTrackingStartedAt ?? null;
    return { totals, recordCount, truncated: window.length > recordCount, since,
      trackingSince, incompleteNames: trackingSince === null || since < trackingSince
        ? ["ci_regression_caught", "runner_failure", "provider_failure", "stale_review"] : [] };
  },
});

import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrganizationRole, requireRepositoryRole } from "./lib/authz";
import { parentScopeChecker, summaryRowCeiling } from "./lib/parentScope";

export const summarize = query({
  args: {
    organizationId: v.id("organizations"),
    repositoryId: v.optional(v.id("repositories")),
    since: v.number(),
  },
  handler: async (ctx, args) => {
    await requireOrganizationRole(ctx, args.organizationId, "viewer");
    if (args.repositoryId) await requireRepositoryRole(ctx, args.repositoryId, "viewer", args.organizationId);
    const events = await ctx.db.query("metricEvents")
      .withIndex("by_org_time", (q) => q.eq("organizationId", args.organizationId).gte("occurredAt", args.since))
      .take(summaryRowCeiling);
    const totals: Record<string, number> = {};
    const scope = parentScopeChecker(ctx, args.organizationId);
    for (const event of events) {
      if (event.repositoryId) await scope.repository(event.repositoryId);
      if (event.reviewId) {
        const review = await scope.review(event.reviewId);
        if (event.repositoryId && review.repositoryId !== event.repositoryId) throw new Error("not_found_or_forbidden");
      }
      if (args.repositoryId && event.repositoryId !== args.repositoryId) continue;
      totals[event.name] = (totals[event.name] ?? 0) + event.value;
    }
    return totals;
  },
});

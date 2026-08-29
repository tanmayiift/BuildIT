import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrganizationRole, requireRepositoryRole } from "./lib/authz";

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
      .collect();
    const totals: Record<string, number> = {};
    for (const event of events) {
      if (event.repositoryId) {
        const repository = await ctx.db.get(event.repositoryId);
        if (!repository || repository.organizationId !== args.organizationId) throw new Error("not_found_or_forbidden");
      }
      if (event.reviewId) {
        const review = await ctx.db.get(event.reviewId);
        if (!review || review.organizationId !== args.organizationId || (event.repositoryId && review.repositoryId !== event.repositoryId)) {
          throw new Error("not_found_or_forbidden");
        }
      }
      if (args.repositoryId && event.repositoryId !== args.repositoryId) continue;
      totals[event.name] = (totals[event.name] ?? 0) + event.value;
    }
    return totals;
  },
});

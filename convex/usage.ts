import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrganizationRole } from "./lib/authz";

export const summarize = query({
  args: { organizationId: v.id("organizations"), since: v.number() },
  handler: async (ctx, args) => {
    await requireOrganizationRole(ctx, args.organizationId, "viewer");
    const organization = await ctx.db.get(args.organizationId);
    if (!organization || organization.deletedAt) throw new Error("not_found_or_forbidden");
    const rows = await ctx.db.query("usageLedger").withIndex("by_org_time", q => q.eq("organizationId", args.organizationId).gte("occurredAt", args.since)).collect();
    const quantities: Record<string, number> = {}, costs: Record<string, number> = {};
    for (const row of rows) {
      const [repository, review] = await Promise.all([ctx.db.get(row.repositoryId), ctx.db.get(row.reviewId)]);
      if (!repository || repository.organizationId !== args.organizationId || !review || review.organizationId !== args.organizationId || review.repositoryId !== repository._id) throw new Error("not_found_or_forbidden");
      if (row.roundId) { const round = await ctx.db.get(row.roundId); if (!round || round.organizationId !== args.organizationId || round.reviewId !== review._id) throw new Error("not_found_or_forbidden"); }
      quantities[row.kind] = (quantities[row.kind] ?? 0) + row.quantity;
      costs[row.currency] = (costs[row.currency] ?? 0) + row.quantity * row.unitCost;
    }
    return { quantities, costs, recordCount: rows.length, since: args.since, monthlyBudget: organization.monthlyBudget };
  },
});

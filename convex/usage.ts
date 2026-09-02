import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrganizationRole } from "./lib/authz";
import { rowCostUsd } from "./lib/usageCost";
import { parentScopeChecker, summaryRowCeiling } from "./lib/parentScope";

export const summarize = query({
  args: { organizationId: v.id("organizations"), since: v.number() },
  handler: async (ctx, args) => {
    await requireOrganizationRole(ctx, args.organizationId, "viewer");
    const organization = await ctx.db.get(args.organizationId);
    if (!organization || organization.deletedAt) throw new Error("not_found_or_forbidden");
    const rows = await ctx.db.query("usageLedger").withIndex("by_org_time", q => q.eq("organizationId", args.organizationId).gte("occurredAt", args.since)).take(summaryRowCeiling);
    const quantities: Record<string, number> = {}, costs: Record<string, number> = {};
    const scope = parentScopeChecker(ctx, args.organizationId);
    for (const row of rows) {
      const review = await scope.review(row.reviewId);
      await scope.repository(row.repositoryId);
      if (review.repositoryId !== row.repositoryId) throw new Error("not_found_or_forbidden");
      if (row.roundId) await scope.round(row.roundId, row.reviewId);
      quantities[row.kind] = (quantities[row.kind] ?? 0) + row.quantity;
      costs[row.currency] = (costs[row.currency] ?? 0) + rowCostUsd(row);
    }
    return { quantities, costs, recordCount: rows.length, truncated: rows.length === summaryRowCeiling, since: args.since, monthlyBudget: organization.monthlyBudget };
  },
});

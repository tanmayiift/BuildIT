import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrganizationRole } from "./lib/authz";
import { rowCostUsd } from "./lib/usageCost";
import { parentScopeChecker, summaryRowCeiling } from "./lib/parentScope";
import { utcMonth } from "./lib/reportingPeriod";
import { getBudgetSnapshot, reconcileMonthPage } from "./lib/budgetAccounting";
import type { WorkspaceUsageSummary } from "./lib/workspaceFigureTypes";

// Viewing usage may initialize a missing monthly subtotal. This never calls a provider or
// changes the budget; later pages are scheduled by the same resumable reconciliation path.
export const prepare = mutation({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireOrganizationRole(ctx, args.organizationId, "viewer");
    await reconcileMonthPage(ctx, args.organizationId, Date.now());
    return null;
  },
});

export const summarize = query({
  args: { organizationId: v.id("organizations"), since: v.optional(v.number()), refreshKey: v.optional(v.string()) },
  handler: async (ctx, args): Promise<WorkspaceUsageSummary> => {
    await requireOrganizationRole(ctx, args.organizationId, "viewer");
    const organization = await ctx.db.get(args.organizationId);
    if (!organization || organization.deletedAt) throw new Error("not_found_or_forbidden");
    const now = Date.now(), period = utcMonth(now), since = args.since ?? period.since;
    if (!Number.isFinite(since)) throw new Error("invalid_reporting_period");
    const window = await ctx.db.query("usageLedger").withIndex("by_org_time", q => q.eq("organizationId", args.organizationId).gte("occurredAt", since).lt("occurredAt", period.until)).order("desc").take(summaryRowCeiling + 1);
    const rows = window.slice(0, summaryRowCeiling);
    const quantities: Record<string, number> = {}, costs: Record<string, number> = {};
    const scope = parentScopeChecker(ctx, args.organizationId);
    let recordCount = 0;
    for (const row of rows) {
      if (!scope.canCheck(row)) break;
      const review = await scope.review(row.reviewId);
      await scope.repository(row.repositoryId);
      if (review.repositoryId !== row.repositoryId) throw new Error("not_found_or_forbidden");
      if (row.roundId) await scope.round(row.roundId, row.reviewId);
      quantities[row.kind] = (quantities[row.kind] ?? 0) + row.quantity;
      costs[row.currency] = (costs[row.currency] ?? 0) + rowCostUsd(row);
      recordCount++;
    }
    const budget = await getBudgetSnapshot(ctx, args.organizationId, now);
    return { quantities, costs, recordCount, truncated: window.length > recordCount, since, monthlyBudget: organization.monthlyBudget, budget };
  },
});

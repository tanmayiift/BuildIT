import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { totalCostUsd } from "./lib/usageCost";

const rowLimit = 1_000;
const activeStatuses = ["gathering_context", "analyzing", "validating", "autofix_queued", "autofixing", "validating_round", "validating_final", "cancelling"] as const;
const bounded = (value: number) => Math.min(1_000_000, Math.max(0, value));

export const snapshot = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const now = args.now, since = now - 60 * 60_000;
    const queued = await ctx.db.query("reviews").withIndex("by_status", q => q.eq("status", "queued")).take(rowLimit + 1);
    const activeGroups = await Promise.all(activeStatuses.map(status => ctx.db.query("reviews").withIndex("by_status", q => q.eq("status", status)).take(rowLimit + 1)));
    const organizations = await ctx.db.query("organizations").withIndex("by_created").take(rowLimit + 1);
    const expired = await ctx.db.query("artifacts").withIndex("by_pending_expiry", q => q.eq("deletedAt", undefined).lt("expiresAt", now)).take(rowLimit + 1);
    const usage = await ctx.db.query("usageLedger").withIndex("by_time", q => q.gte("occurredAt", since)).take(rowLimit + 1);
    const budgetStops = await ctx.db.query("reviews").withIndex("by_status", q => q.eq("status", "budget_exhausted").gte("updatedAt", since)).take(rowLimit + 1);
    const effectiveLoc = await ctx.db.query("metricEvents").withIndex("by_name_time", q => q.eq("name", "effective_loc_added").gte("occurredAt", since)).take(rowLimit + 1);
    const active = activeGroups.reduce((sum, rows) => sum + Math.min(rowLimit, rows.length), 0);
    const capacity = organizations.slice(0, rowLimit).reduce((sum, item) => sum + Math.max(0, item.concurrencyLimit), 0);
    return {
      queueDepth: bounded(Math.min(rowLimit, queued.length)),
      activeReviews: bounded(active),
      capacityUtilization: bounded(capacity > 0 ? active / capacity : 0),
      expiredArtifactBacklog: bounded(Math.min(rowLimit, expired.length)),
      modelCostUsdHour: bounded(usage.length > rowLimit ? 1_000_000 : totalCostUsd(usage.filter(item => item.kind === "model_tokens"))),
      budgetExhaustedReviewsHour: bounded(Math.min(rowLimit, budgetStops.length)),
      effectiveLocDeliveredHour: bounded(effectiveLoc.length > rowLimit ? 1_000_000 : effectiveLoc.reduce((sum, item) => sum + item.value, 0)),
    };
  },
});

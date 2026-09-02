import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { activeStatuses, terminalStatuses } from "./lifecycle";

// organizations.monthlyBudget and concurrencyLimit were stored on every organization and read
// only for display (usage.ts) and a telemetry sum. Nothing enforced them, so the sole ceiling
// was per-review. Opening BuildIT to other people means one tenant could hold unbounded
// concurrent sandbox and broker capacity, and spend past a stated monthly cap, without limit.
//
// A value of 0 means "unset": treated as no limit, so existing organizations created with
// monthlyBudget: 0 keep working exactly as before until a real cap is chosen.
export const noLimit = 0;

export function concurrencyExceeded(activeReviewCount: number, concurrencyLimit: number) {
  if (!Number.isFinite(concurrencyLimit) || concurrencyLimit <= noLimit) return false;
  return activeReviewCount >= concurrencyLimit;
}

export function monthlyBudgetExceeded(spentThisMonth: number, nextCharge: number, monthlyBudget: number) {
  if (!Number.isFinite(monthlyBudget) || monthlyBudget <= noLimit) return false;
  if (!Number.isFinite(spentThisMonth) || !Number.isFinite(nextCharge)) return true;
  return spentThisMonth + nextCharge > monthlyBudget;
}

export function isActiveReview(status: string) {
  return !terminalStatuses.has(status);
}

// Counting active reviews by collecting every review an organization has ever had is the same
// unbounded-read defect this codebase has elsewhere, on the path that starts every review. Walk
// the by_org_status index once per active status instead, and stop as soon as the cap is reached.
export async function activeReviewCount(ctx: QueryCtx, organizationId: Id<"organizations">, ceiling: number) {
  let count = 0;
  for (const status of activeStatuses) {
    if (terminalStatuses.has(status)) continue;
    const rows = await ctx.db.query("reviews")
      .withIndex("by_org_status", q => q.eq("organizationId", organizationId).eq("status", status))
      .take(Math.max(1, ceiling - count));
    count += rows.length;
    if (count >= ceiling) return count;
  }
  return count;
}

// Start of the current UTC month, used to scope the spend window the cap applies to.
export function monthStart(now: number) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

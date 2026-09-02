import { describe, expect, it } from "vitest";
import { concurrencyExceeded, isActiveReview, monthStart, monthlyBudgetExceeded, noLimit } from "./tenantLimits";

describe("per-tenant limits", () => {
  // Both fields existed on every organization and were read only for display. Opening BuildIT
  // to other people means one tenant could otherwise hold unbounded capacity.
  it("stops a tenant at its concurrency limit", () => {
    expect(concurrencyExceeded(0, 1)).toBe(false);
    expect(concurrencyExceeded(1, 1)).toBe(true);
    expect(concurrencyExceeded(5, 3)).toBe(true);
  });

  // Every organization created so far was inserted with monthlyBudget: 0 and concurrencyLimit
  // was never enforced, so 0 must keep meaning "no limit" or existing tenants break.
  it("treats an unset limit as no limit", () => {
    expect(concurrencyExceeded(9_999, noLimit)).toBe(false);
    expect(monthlyBudgetExceeded(9_999, 100, noLimit)).toBe(false);
    expect(concurrencyExceeded(1, -1)).toBe(false);
  });

  it("stops spend that would cross the monthly cap, before the call is made", () => {
    expect(monthlyBudgetExceeded(0, 1, 10)).toBe(false);
    expect(monthlyBudgetExceeded(9, 1, 10)).toBe(false);
    expect(monthlyBudgetExceeded(9.5, 1, 10)).toBe(true);
    expect(monthlyBudgetExceeded(10, 0.01, 10)).toBe(true);
  });

  it("refuses rather than allows when a spend figure is not a number", () => {
    expect(monthlyBudgetExceeded(Number.NaN, 1, 10)).toBe(true);
    expect(monthlyBudgetExceeded(1, Number.POSITIVE_INFINITY, 10)).toBe(true);
  });

  it("counts every non-terminal review as active", () => {
    for (const status of ["queued", "gathering_context", "analyzing", "validating", "autofixing", "blocked", "cancelling"]) expect(isActiveReview(status)).toBe(true);
    for (const status of ["checks_passed", "changes_requested", "inconclusive", "delivered", "cancelled", "budget_exhausted", "platform_failed", "failed_after_bounds"]) expect(isActiveReview(status)).toBe(false);
  });

  it("scopes the spend window to the current UTC month", () => {
    expect(monthStart(Date.UTC(2026, 8, 2, 17, 45))).toBe(Date.UTC(2026, 8, 1));
    expect(monthStart(Date.UTC(2026, 8, 1, 0, 0))).toBe(Date.UTC(2026, 8, 1));
  });
});

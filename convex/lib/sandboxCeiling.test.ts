import { describe, expect, it } from "vitest";
import { addSandboxSeconds, defaultMonthlySandboxSeconds, platformCeilingExceeded, platformMonthlySandboxSeconds, platformUsableMonthlySandboxSeconds, sandboxCeilingExceeded, sandboxCeilingSeconds, sandboxSecondsThisMonth } from "./sandboxCeiling";
import { monthKey } from "./monthlySpend";

const month = "2026-10";

describe("sandbox ceiling", () => {
  it("falls back to the platform default rather than to no limit", () => {
    // monthlyBudget and concurrencyLimit read 0 as unbounded. This resource is shared between
    // tenants, so an unset or non-positive value must still be bounded.
    expect(sandboxCeilingSeconds({})).toBe(defaultMonthlySandboxSeconds);
    expect(sandboxCeilingSeconds({ monthlySandboxSeconds: 0 })).toBe(defaultMonthlySandboxSeconds);
    expect(sandboxCeilingSeconds({ monthlySandboxSeconds: -1 })).toBe(defaultMonthlySandboxSeconds);
    expect(sandboxCeilingSeconds({ monthlySandboxSeconds: Number.NaN })).toBe(defaultMonthlySandboxSeconds);
    expect(sandboxCeilingSeconds({ monthlySandboxSeconds: Number.POSITIVE_INFINITY })).toBe(defaultMonthlySandboxSeconds);
  });

  it("keeps the default inside the shared provider quota for several tenants at once", () => {
    // Vercel Hobby allows 18,000 sandbox seconds a month across the whole deployment, so no single
    // tenant's default may be a large fraction of it.
    expect(platformMonthlySandboxSeconds).toBe(18_000);
    expect(defaultMonthlySandboxSeconds * 5).toBeLessThanOrEqual(platformMonthlySandboxSeconds);
  });

  // This is the arithmetic that says why a per-tenant ceiling is not enough on its own, and it is
  // asserted rather than written in a comment so nobody raises the default past the point where the
  // platform guard is the only thing holding the quota.
  it("does not bound the platform by per-tenant slices alone", () => {
    const tenantsThatFit = Math.floor(platformMonthlySandboxSeconds / defaultMonthlySandboxSeconds);
    expect(tenantsThatFit).toBe(5);
    expect(defaultMonthlySandboxSeconds * (tenantsThatFit + 1)).toBeGreaterThan(platformMonthlySandboxSeconds);
  });

  it("trips the platform guard before the provider does, not at the same moment", () => {
    expect(platformUsableMonthlySandboxSeconds).toBeLessThan(platformMonthlySandboxSeconds);
    expect(platformUsableMonthlySandboxSeconds).toBe(16_200);
    expect(platformCeilingExceeded(16_199)).toBe(false);
    expect(platformCeilingExceeded(16_200)).toBe(true);
    // A provider-side refusal would arrive here, with no explanation and no reset date.
    expect(platformCeilingExceeded(platformMonthlySandboxSeconds)).toBe(true);
  });

  it("refuses rather than admits when the platform total is unusable", () => {
    expect(platformCeilingExceeded(Number.NaN)).toBe(true);
    expect(platformCeilingExceeded(0, 0)).toBe(true);
    expect(platformCeilingExceeded(0, Number.NaN)).toBe(true);
  });

  it("honours an explicit per-tenant override", () => {
    expect(sandboxCeilingSeconds({ monthlySandboxSeconds: 60 })).toBe(60);
    expect(sandboxCeilingSeconds({ monthlySandboxSeconds: 7_200.9 })).toBe(7_200);
  });

  it("reads a counter stamped with another month as zero", () => {
    expect(sandboxSecondsThisMonth({ sandboxSecondsUsed: 9_000, sandboxSecondsMonth: "2026-09" }, month)).toBe(0);
    expect(sandboxSecondsThisMonth({ sandboxSecondsUsed: 9_000, sandboxSecondsMonth: month }, month)).toBe(9_000);
    expect(sandboxSecondsThisMonth({}, month)).toBe(0);
    expect(sandboxSecondsThisMonth({ sandboxSecondsUsed: Number.NaN, sandboxSecondsMonth: month }, month)).toBe(0);
  });

  it("restarts the total when the month rolls instead of carrying it", () => {
    const september = addSandboxSeconds({}, 900, "2026-09");
    expect(september).toEqual({ sandboxSecondsUsed: 900, sandboxSecondsMonth: "2026-09" });
    expect(addSandboxSeconds(september, 100, "2026-09")).toEqual({ sandboxSecondsUsed: 1_000, sandboxSecondsMonth: "2026-09" });
    expect(addSandboxSeconds(september, 100, month)).toEqual({ sandboxSecondsUsed: 100, sandboxSecondsMonth: month });
  });

  it("rounds a partial second up and ignores a nonsense duration", () => {
    expect(addSandboxSeconds({}, 0.2, month)).toEqual({ sandboxSecondsUsed: 1, sandboxSecondsMonth: month });
    expect(addSandboxSeconds({}, 0, month)).toEqual({ sandboxSecondsUsed: 0, sandboxSecondsMonth: month });
    expect(addSandboxSeconds({}, -5, month)).toEqual({ sandboxSecondsUsed: 0, sandboxSecondsMonth: month });
    expect(addSandboxSeconds({}, Number.NaN, month)).toEqual({ sandboxSecondsUsed: 0, sandboxSecondsMonth: month });
  });

  it("refuses at the ceiling, not one second past it", () => {
    expect(sandboxCeilingExceeded(0, 3_600)).toBe(false);
    expect(sandboxCeilingExceeded(3_599, 3_600)).toBe(false);
    expect(sandboxCeilingExceeded(3_600, 3_600)).toBe(true);
    expect(sandboxCeilingExceeded(10_000, 3_600)).toBe(true);
  });

  it("refuses rather than admits when either side of the comparison is unusable", () => {
    expect(sandboxCeilingExceeded(0, 0)).toBe(true);
    expect(sandboxCeilingExceeded(0, Number.NaN)).toBe(true);
    expect(sandboxCeilingExceeded(Number.NaN, 3_600)).toBe(true);
  });

  it("uses the same month key the spend counter already stamps", () => {
    expect(monthKey(Date.UTC(2026, 9, 1))).toBe(month);
  });
});

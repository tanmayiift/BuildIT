import { describe, expect, it } from "vitest";
import { addToMonth, monthKey, spendThisMonth } from "./monthlySpend";

// preflightStageSpend collected the organization's whole month-to-date usageLedger on every model
// stage - seven times per review, growing all month, on a table that only ever grows. At a few
// reviews a day that is invisible; at a few hundred it is the read that stops the product working.
// A running total on the organization row answers the same question in one read.
//
// The trap in a running total is the month boundary: a counter that is only reset by a schedule
// carries September's spend into October if the schedule slips. Stamping the month alongside the
// total means a stale stamp reads as zero without anything having to run.

describe("month key", () => {
  it("is the UTC year and month, so a boundary is a change of value", () => {
    expect(monthKey(Date.UTC(2026, 8, 3, 16, 41))).toBe("2026-09");
    expect(monthKey(Date.UTC(2026, 8, 30, 23, 59, 59))).toBe("2026-09");
    expect(monthKey(Date.UTC(2026, 9, 1, 0, 0, 0))).toBe("2026-10");
  });
});

describe("reading the total", () => {
  it("reads the stored total when the stamp is the current month", () => {
    const organization = { monthlySpendMicros: 1_250_000, monthlySpendMonth: "2026-09" };
    expect(spendThisMonth(organization, Date.UTC(2026, 8, 20))).toBe(1.25);
  });

  it("reads zero when the stamp is a previous month, without waiting for a reset", () => {
    const organization = { monthlySpendMicros: 9_999_000, monthlySpendMonth: "2026-08" };
    expect(spendThisMonth(organization, Date.UTC(2026, 8, 1))).toBe(0);
  });

  it("reads zero for an organization that has never spent", () => {
    expect(spendThisMonth({}, Date.UTC(2026, 8, 20))).toBe(0);
  });
});

describe("adding to the total", () => {
  it("accumulates within a month", () => {
    const first = addToMonth({}, 500_000, Date.UTC(2026, 8, 3));
    expect(first).toEqual({ monthlySpendMicros: 500_000, monthlySpendMonth: "2026-09" });
    expect(addToMonth(first, 250_000, Date.UTC(2026, 8, 4))).toEqual({ monthlySpendMicros: 750_000, monthlySpendMonth: "2026-09" });
  });

  it("starts from the new charge when the month turns over", () => {
    const september = { monthlySpendMicros: 900_000, monthlySpendMonth: "2026-09" };
    expect(addToMonth(september, 100_000, Date.UTC(2026, 9, 1))).toEqual({ monthlySpendMicros: 100_000, monthlySpendMonth: "2026-10" });
  });

  it("keeps integer micros, because a float total drifts over thousands of additions", () => {
    let state = {};
    for (let index = 0; index < 1_000; index += 1) state = addToMonth(state, 1, Date.UTC(2026, 8, 3));
    expect(state).toEqual({ monthlySpendMicros: 1_000, monthlySpendMonth: "2026-09" });
  });
});

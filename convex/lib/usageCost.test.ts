import { describe, expect, it } from "vitest";
import { rowCostUsd, toMicros, totalCostUsd } from "./usageCost";

// usageLedger stored cost / max(1, quantity) and every reader multiplied it back by quantity.
// When a provider omits usage the quantity is 0, so the multiplication returns 0 and the call's
// real cost vanishes from spend, budgets and telemetry - the case where a call is most likely to
// have been expensive and unaccounted for.
describe("usage cost", () => {
  it("keeps the cost of a call the provider reported no usage for", () => {
    const quantity = 0, cost = 0.42;
    expect(quantity * (cost / Math.max(1, quantity))).toBe(0);
    expect(rowCostUsd({ quantity, unitCost: cost / Math.max(1, quantity), totalCostMicros: toMicros(cost) })).toBeCloseTo(0.42, 10);
  });

  it("agrees with the old arithmetic whenever a quantity was reported", () => {
    const quantity = 1_500, cost = 0.045;
    const unitCost = cost / Math.max(1, quantity);
    expect(rowCostUsd({ quantity, unitCost, totalCostMicros: toMicros(cost) })).toBeCloseTo(quantity * unitCost, 8);
  });

  it("still reads rows written before the column existed", () => {
    expect(rowCostUsd({ quantity: 100, unitCost: 0.001 })).toBeCloseTo(0.1, 10);
  });

  // Integer micro-dollars, so summing thousands of rows does not drift the way repeated float
  // multiplication of a derived unit price does.
  it("adds thousands of small charges without drifting", () => {
    const rows = Array.from({ length: 10_000 }, () => ({ quantity: 3, unitCost: 0.0001, totalCostMicros: toMicros(0.0003) }));
    expect(totalCostUsd(rows)).toBeCloseTo(3, 9);
  });

  it("refuses a cost that is not a usable number", () => {
    expect(toMicros(Number.NaN)).toBe(0);
    expect(toMicros(-1)).toBe(0);
  });
});

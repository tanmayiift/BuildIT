import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { computeReviewDecision } from "../../packages/orchestrator/src/index.js";
import { assertAutofixBounds } from "../../packages/orchestrator/src/patchPolicy.js";

describe("source-free reliability load", () => {
  // Measures the decision path, which is the thing that runs per review. The bounds check is
  // asserted separately: it fails by throwing, and 30,000 exceptions measure the cost of building
  // stack traces rather than the cost of deciding - which is what made this fail on a CI runner
  // while passing locally.
  it("keeps stale, missing-check and injection decisions fail-closed under load", () => {
    const check = { name: "test", required: true, conclusion: "passed" as const, evidenceComplete: true };
    const started = performance.now();
    for (let index = 0; index < 10_000; index += 1) {
      expect(computeReviewDecision({ isStale: true, environmentAvailable: true, checks: [check], findings: [] }).status).toBe("inconclusive");
      expect(computeReviewDecision({ isStale: false, environmentAvailable: true, checks: [{ name: "test", required: true, conclusion: "not_run", evidenceComplete: false }], findings: [] }).status).toBe("inconclusive");
      expect(computeReviewDecision({ isStale: false, environmentAvailable: true, injectionUnscoped: true, checks: [check], findings: [] }).status).toBe("inconclusive");
      expect(computeReviewDecision({ isStale: false, environmentAvailable: false, checks: [check], findings: [] }).status).toBe("inconclusive");
    }
    // Generous against a shared CI runner, and still orders of magnitude below anything a review
    // would notice: the point is that the decision path has no pathological case, not a benchmark.
    expect(performance.now() - started).toBeLessThan(10_000);
  });

  // A green decision must stay reachable under the same load - a check that only ever returns
  // inconclusive would pass everything above and be worthless.
  it("still reaches a green decision under the same load", () => {
    const check = { name: "test", required: true, conclusion: "passed" as const, evidenceComplete: true };
    for (let index = 0; index < 10_000; index += 1) {
      expect(computeReviewDecision({ isStale: false, environmentAvailable: true, checks: [check], findings: [] }).status).toBe("checks_passed");
    }
  });

  it("holds every Autofix bound, each of which fails by throwing", () => {
    const base = { completedRounds: 0, modelAttempts: 0, startedAt: 0, now: 1, budgetConsumed: 0, budgetLimit: 5 };
    expect(() => assertAutofixBounds({ ...base, completedRounds: 3 })).toThrow("autofix_round_limit");
    expect(() => assertAutofixBounds({ ...base, modelAttempts: 6 })).toThrow("autofix_attempt_limit");
    expect(() => assertAutofixBounds({ ...base, budgetConsumed: 5 })).toThrow("autofix_spend_limit");
    expect(() => assertAutofixBounds({ ...base, now: 45 * 60_000 + 1 })).toThrow("autofix_time_limit");
    expect(assertAutofixBounds(base)).toMatchObject({ roundNumber: 1 });
  });

  it("never lets retries expand round, attempt, time, or cost ceilings", () => {
    expect(() => assertAutofixBounds({ completedRounds: 3, modelAttempts: 0, startedAt: 0, now: 1, budgetConsumed: 0, budgetLimit: 1 })).toThrow("autofix_round_limit");
    expect(() => assertAutofixBounds({ completedRounds: 0, modelAttempts: 6, startedAt: 0, now: 1, budgetConsumed: 0, budgetLimit: 1 })).toThrow("autofix_attempt_limit");
    expect(() => assertAutofixBounds({ completedRounds: 0, modelAttempts: 0, startedAt: 0, now: 45 * 60_000 + 1, budgetConsumed: 0, budgetLimit: 1 })).toThrow("autofix_time_limit");
    expect(() => assertAutofixBounds({ completedRounds: 0, modelAttempts: 0, startedAt: 0, now: 1, budgetConsumed: 1, budgetLimit: 1 })).toThrow("autofix_spend_limit");
  });
});

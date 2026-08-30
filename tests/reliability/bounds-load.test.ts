import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { computeReviewDecision, nextAutofix } from "../../packages/orchestrator/src/index.js";
import { assertAutofixBounds } from "../../packages/orchestrator/src/patchPolicy.js";

describe("source-free reliability load", () => {
  it("keeps stale, missing-check, replay, spend, attempt, and round decisions fail-closed under load", () => {
    const started = performance.now();
    for (let index = 0; index < 10_000; index += 1) {
      expect(computeReviewDecision({ isStale: true, environmentAvailable: true, checks: [{ name: "test", required: true, conclusion: "passed", evidenceComplete: true }], findings: [] }).status).toBe("inconclusive");
      expect(computeReviewDecision({ isStale: false, environmentAvailable: true, checks: [{ name: "test", required: true, conclusion: "not_run", evidenceComplete: false }], findings: [] }).status).toBe("inconclusive");
      expect(nextAutofix({ rounds: 3, attempts: 3, diagnostics: 0, providerRetries: 0, commandRetries: 0, spent: 0, spendLimit: 5 }, `patch-${index}`, new Set()).terminationBound).toBe("round_limit");
      expect(nextAutofix({ rounds: 0, attempts: 6, diagnostics: 0, providerRetries: 0, commandRetries: 0, spent: 0, spendLimit: 5 }, `patch-${index}`, new Set()).terminationBound).toBe("attempt_limit");
      expect(nextAutofix({ rounds: 0, attempts: 0, diagnostics: 0, providerRetries: 0, commandRetries: 0, spent: 5, spendLimit: 5 }, `patch-${index}`, new Set()).status).toBe("budget_exhausted");
      expect(nextAutofix({ rounds: 0, attempts: 0, diagnostics: 0, providerRetries: 0, commandRetries: 0, spent: 0, spendLimit: 5 }, "same", new Set(["same"])).terminationBound).toBe("repeated_patch");
    }
    expect(performance.now() - started).toBeLessThan(2_000);
  });
  it("never lets retries expand round, attempt, time, or cost ceilings", () => {
    expect(() => assertAutofixBounds({ completedRounds: 3, modelAttempts: 0, startedAt: 0, now: 1, budgetConsumed: 0, budgetLimit: 1 })).toThrow("autofix_round_limit");
    expect(() => assertAutofixBounds({ completedRounds: 0, modelAttempts: 6, startedAt: 0, now: 1, budgetConsumed: 0, budgetLimit: 1 })).toThrow("autofix_attempt_limit");
    expect(() => assertAutofixBounds({ completedRounds: 0, modelAttempts: 0, startedAt: 0, now: 45 * 60_000 + 1, budgetConsumed: 0, budgetLimit: 1 })).toThrow("autofix_time_limit");
    expect(() => assertAutofixBounds({ completedRounds: 0, modelAttempts: 0, startedAt: 0, now: 1, budgetConsumed: 1, budgetLimit: 1 })).toThrow("autofix_spend_limit");
  });
});

import { describe, expect, it } from "vitest";
import { assertTransition, githubConclusion, reviewRecord, terminalStatuses, type ReviewStatus } from "../src/index.js";

const baseRecord = {
  id: "review-1", organizationId: "org-1", repositoryId: "repo-1", prNumber: 1,
  mode: "review" as const, headSha: "a".repeat(40), status: "queued" as const,
  nextActionCode: "none" as const, isStale: false, budgetLimit: 10, budgetConsumed: 0,
  completedRoundCount: 0, patchAttemptCount: 0, diagnosticRunCount: 0,
  providerRetryCount: 0, commandRetryCount: 0,
};

describe("lifecycle contracts", () => {
  it("implements every normative GitHub conclusion", () => {
    expect(githubConclusion("checks_passed", "advisory")).toBe("success");
    expect(githubConclusion("changes_requested", "fail_open")).toBe("failure");
    expect(githubConclusion("inconclusive", "advisory")).toBe("neutral");
    expect(githubConclusion("inconclusive", "fail_closed")).toBe("failure");
    expect(githubConclusion("delivered", "fail_closed")).toBe("success");
    expect(githubConclusion("failed_after_bounds", "advisory")).toBe("failure");
    for (const status of ["blocked", "cancelled", "budget_exhausted"] as const) expect(githubConclusion(status, "advisory")).toBe("action_required");
    expect(githubConclusion("platform_failed", "fail_open")).toBe("neutral");
    expect(githubConclusion("platform_failed", "fail_closed")).toBe("failure");
    expect(githubConclusion("validating", "advisory")).toBeUndefined();
  });

  it("allows the review and Autofix happy paths", () => {
    const transitions: Array<[ReviewStatus, ReviewStatus]> = [
      ["queued", "gathering_context"], ["gathering_context", "analyzing"],
      ["analyzing", "validating"], ["validating", "checks_passed"],
      ["autofix_queued", "autofixing"], ["autofixing", "validating_round"],
      ["validating_round", "validating_final"], ["validating_final", "delivered"],
    ];
    for (const [from, to] of transitions) expect(() => assertTransition(from, to)).not.toThrow();
  });

  it("makes terminal states immutable", () => {
    for (const status of terminalStatuses) expect(() => assertTransition(status, "queued")).toThrow("invalid_review_transition");
  });

  it("resumes blocked work only to its persisted prior state", () => {
    expect(() => assertTransition("blocked", "analyzing", "analyzing")).not.toThrow();
    expect(() => assertTransition("blocked", "validating", "analyzing")).toThrow();
  });

  it("requires complete stale metadata without replacing status", () => {
    expect(() => reviewRecord.parse({ ...baseRecord, isStale: true })).toThrow("staleSince");
    expect(reviewRecord.parse({
      ...baseRecord, status: "checks_passed", statusReasonCode: "checks_complete",
      isStale: true, staleSince: 2, observedHeadSha: "b".repeat(40), completedAt: 3,
    }).status).toBe("checks_passed");
  });

  it("separates time bounds from spend ceilings", () => {
    expect(reviewRecord.parse({
      ...baseRecord, status: "inconclusive", statusReasonCode: "review_timeout",
      nextActionCode: "retry_review", completedAt: 2,
    }).status).toBe("inconclusive");
    expect(() => reviewRecord.parse({
      ...baseRecord, status: "budget_exhausted", statusReasonCode: "spend_ceiling_reached",
      budgetCeilingId: "monthly", budgetConsumed: 9, completedAt: 2,
    })).toThrow("consumption");
  });

  it("caps rounds and attempts and requires bound provenance", () => {
    expect(() => reviewRecord.parse({ ...baseRecord, completedRoundCount: 4, patchAttemptCount: 7 })).toThrow();
    expect(() => reviewRecord.parse({
      ...baseRecord, mode: "autofix", status: "failed_after_bounds",
      completedRoundCount: 3, patchAttemptCount: 3, completedAt: 2,
    })).toThrow("terminationBound");
  });
});

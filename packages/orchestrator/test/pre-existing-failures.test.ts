import { describe, expect, it } from "vitest";
import { computeReviewDecision, type ReviewCheckDecision } from "../src/index.js";
import { composeVerifiedReport } from "../src/report.js";

// BuildIT runs every check on the base commit as well as the head, and the features page says why:
// "a failure that was already there is not blamed on your change". It was. pairExecutionEvidence
// computed the comparison and the report never read it, so reportChecks reported raw head results.
//
// A review of sindresorhus/got made it visible: `test` and `buildit-rules` both failed, both for
// reasons the pull request never touched - a missing CA bundle, and a benchmark file that disables
// TLS verification - and the report showed two failing required checks with no finding to point at.
// Telling an author their change broke something, and then having nothing to show them, is the most
// corrosive thing a review can say.

const check = (over: Partial<ReviewCheckDecision> = {}): ReviewCheckDecision => ({
  name: "test", required: true, conclusion: "failed", evidenceComplete: true, ...over,
});

const base = {
  repository: "acme/api", prNumber: 1, headSha: "a".repeat(40), baseSha: "b".repeat(40),
  configRevision: "cfg", coverage: "complete" as const, findings: [], claims: [],
  evidence: [], environmentAvailable: true, isStale: false, costUsd: 0.05, retentionExpiresAt: 0,
};

describe("a check that was already failing before this pull request", () => {
  it("does not turn a clean review into changes_requested", () => {
    const decision = computeReviewDecision({ isStale: false, environmentAvailable: true, coverageComplete: true,
      checks: [check({ preExisting: true })], findings: [] });
    expect(decision.status).toBe("checks_passed");
  });

  it("still blocks when the same check newly fails on this head", () => {
    const decision = computeReviewDecision({ isStale: false, environmentAvailable: true, coverageComplete: true,
      checks: [check()], findings: [] });
    expect(decision).toMatchObject({ status: "changes_requested", reason: "required_check_failed" });
  });

  // The dangerous direction. A pre-existing lint failure must never excuse a real defect.
  it("never suppresses a blocking finding", () => {
    const decision = computeReviewDecision({ isStale: false, environmentAvailable: true, coverageComplete: true,
      checks: [check({ preExisting: true })],
      findings: [{ resolution: "accepted", blocking: true }] });
    expect(decision).toMatchObject({ status: "changes_requested", reason: "blocking_findings" });
  });

  it("does not excuse a different check that this change did break", () => {
    const decision = computeReviewDecision({ isStale: false, environmentAvailable: true, coverageComplete: true,
      checks: [check({ name: "lint", preExisting: true }), check({ name: "typecheck" })], findings: [] });
    expect(decision).toMatchObject({ status: "changes_requested", reason: "required_check_failed" });
  });

  // A check that could not run is still missing evidence, whatever the base did.
  it("does not turn an unrunnable check into a pass", () => {
    const decision = computeReviewDecision({ isStale: false, environmentAvailable: true, coverageComplete: true,
      checks: [check({ conclusion: "not_run", evidenceComplete: false, preExisting: true })], findings: [] });
    expect(decision).toMatchObject({ status: "inconclusive", reason: "required_check_missing" });
  });
});

describe("what the report says about it", () => {
  it("names the checks and says they are not this change's fault", () => {
    const { body } = composeVerifiedReport({ ...base,
      checks: [check({ name: "lint", preExisting: true }), check({ name: "buildit-rules", preExisting: true })] });

    expect(body).toContain("already failing on");
    expect(body).toContain("Not attributed to this change");
    expect(body).toContain("`lint`");
    expect(body).toContain("`buildit-rules`");
  });

  it("marks the row without shouting it, so the table still reads at a glance", () => {
    const { body } = composeVerifiedReport({ ...base, checks: [check({ name: "lint", preExisting: true })] });
    expect(body).toContain("| lint | Required | Failed · already failing on base |");
    // Not bolded: bold is reserved for what this pull request actually did.
    expect(body).not.toContain("| lint | Required | **Failed** · already failing on base |");
  });

  it("does not claim a required check failed when the only failure predates the change", () => {
    const { body } = composeVerifiedReport({ ...base, checks: [check({ preExisting: true })] });
    expect(body).not.toContain("required check failed");
    expect(body).not.toContain("required checks failed");
  });

  it("says nothing at all when there is nothing pre-existing", () => {
    const { body } = composeVerifiedReport({ ...base, checks: [check({ conclusion: "passed" })] });
    expect(body).not.toContain("already failing on");
  });
});

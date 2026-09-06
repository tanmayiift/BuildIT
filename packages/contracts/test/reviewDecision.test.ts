import { describe, expect, it } from "vitest";
import { computeReviewDecision } from "../src/reviewDecision";

// A repository with no `test` script was permanently undecidable. classifyCheckConclusion correctly
// returns not_configured for "Missing script: test", but `test` is the one required built-in, and
// anything outside passed/failed counted as missing evidence - whose nextAction is retry_review. So
// every pull request in that repository, forever, got "Review needs attention", a summary saying
// complete evidence was not available, and an instruction to retry that could not once work.
describe("a required check the repository never configured", () => {
  const scanner = (name: string) => ({ name, required: true, conclusion: "passed" as const, evidenceComplete: true });
  const base = { isStale: false, environmentAvailable: true, coverageComplete: true, findings: [] };

  it("reaches a verdict instead of asking for a retry that cannot help", () => {
    const decision = computeReviewDecision({ ...base, checks: [
      { name: "test", required: true, conclusion: "not_configured", evidenceComplete: true },
      scanner("gitleaks"), scanner("osv-scanner"), scanner("buildit-rules"),
    ] });
    expect(decision.status).toBe("checks_passed");
    expect(decision.nextAction).toBe("none");
    expect("notConfigured" in decision && decision.notConfigured).toEqual(["test"]);
  });

  it("does not let a genuinely absent result pass as not configured", () => {
    const decision = computeReviewDecision({ ...base, checks: [
      { name: "test", required: true, conclusion: "not_run", evidenceComplete: true },
      scanner("gitleaks"),
    ] });
    expect(decision.status).toBe("inconclusive");
    expect(decision.reason).toBe("required_check_missing");
  });

  it("still fails the review when a configured required check fails", () => {
    const decision = computeReviewDecision({ ...base, checks: [
      { name: "test", required: true, conclusion: "not_configured", evidenceComplete: true },
      { name: "gitleaks", required: true, conclusion: "failed", evidenceComplete: true },
    ] });
    expect(decision.status).toBe("changes_requested");
    expect(decision.reason).toBe("required_check_failed");
  });

  it("stays inconclusive when every required check is unconfigured, since nothing was checked", () => {
    const decision = computeReviewDecision({ ...base, checks: [
      { name: "test", required: true, conclusion: "not_configured", evidenceComplete: true },
    ] });
    expect(decision.status).toBe("inconclusive");
  });
});

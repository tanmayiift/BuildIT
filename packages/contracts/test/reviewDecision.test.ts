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

// A confirmed problem used to lose to any gap in the evidence: a confirmed high-severity finding in a
// repository with no lockfile published a neutral check, and the merge it should have blocked went
// through (the R1 benchmark, p-queue). Only what puts the findings themselves in doubt comes first.
describe("a confirmed problem decides the review", () => {
  const scanner = { name: "gitleaks", required: true, conclusion: "passed" as const, evidenceComplete: true };
  const untested = { name: "test", required: true, conclusion: "not_run" as const, evidenceComplete: true, notRunReason: "no_lockfile" as const };
  const confirmed = [{ resolution: "accepted" as const, blocking: true, severity: "high" }];
  const base = { isStale: false, environmentAvailable: true, coverageComplete: true, checks: [scanner, untested], findings: confirmed };

  it("requests changes even when other evidence is missing, and names what did not run", () => {
    expect(computeReviewDecision(base)).toEqual({ status: "changes_requested", reason: "blocking_findings", nextAction: "inspect_findings", missingChecks: ["test"] });
    expect(computeReviewDecision({ ...base, environmentAvailable: false }).status).toBe("changes_requested");
    expect(computeReviewDecision({ ...base, coverageComplete: false }).status).toBe("changes_requested");
    expect(computeReviewDecision({ ...base, uncertainEscalated: true }).status).toBe("changes_requested");
    expect(computeReviewDecision({ ...base, findings: [], checks: [{ ...scanner, conclusion: "failed" }, untested] }))
      .toEqual({ status: "changes_requested", reason: "required_check_failed", nextAction: "inspect_findings", missingChecks: ["test"] });
  });

  it("does not outrank a stale commit or unscoped prompt injection, which put the findings in doubt", () => {
    expect(computeReviewDecision({ ...base, isStale: true })).toMatchObject({ status: "inconclusive", reason: "stale_commit" });
    expect(computeReviewDecision({ ...base, injectionUnscoped: true })).toMatchObject({ status: "inconclusive", reason: "prompt_injection_unscoped" });
  });

  it("is only a confirmed one: an unconfirmed finding still leaves the gap deciding", () => {
    expect(computeReviewDecision({ ...base, findings: [{ resolution: "uncertain", blocking: true, severity: "high" }] }))
      .toMatchObject({ status: "inconclusive", reason: "tests_need_lockfile", nextAction: "add_lockfile" });
  });
});

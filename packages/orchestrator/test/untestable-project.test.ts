import { describe, expect, it } from "vitest";
import type { ReviewCheckDecision } from "../src/index.js";
import { composeVerifiedReport } from "../src/report.js";

// The comment BuildIT posts on the pull request derives its verdict through the same function as the
// stored review, from the stored validation output. If it did not see the not-run reason it would say
// "Resolve the missing context or checks, then retry once" beside a check run saying "add a lockfile".
const base = {
  repository: "tanmayiift/buildit-demo-p-queue", prNumber: 2, headSha: "a".repeat(40), baseSha: "b".repeat(40),
  configRevision: "cfg", coverage: "complete" as const, findings: [], claims: [],
  evidence: [], environmentAvailable: true, isStale: false, costUsd: 0.19, retentionExpiresAt: 0,
};
const scanners: ReviewCheckDecision[] = [
  { name: "buildit-rules", required: true, conclusion: "passed", evidenceComplete: true },
  { name: "gitleaks", required: true, conclusion: "passed", evidenceComplete: true },
];

describe("the pull request comment for a project whose tests could not run", () => {
  it("does not say the review is ready when only the scanners ran", () => {
    const { body, decision } = composeVerifiedReport({ ...base, checks: [...scanners, { name: "test", required: true, conclusion: "not_run", evidenceComplete: true, notRunReason: "no_lockfile" }] });
    expect(decision).toMatchObject({ status: "inconclusive", reason: "tests_need_lockfile", nextAction: "add_lockfile" });
    expect(body).toMatch(/^## Review needs attention/m);
    expect(body).toMatch(/tests did not run/);
    expect(body).toMatch(/Commit a lockfile/);
    expect(body).not.toMatch(/Ready for human review/);
    expect(body).not.toMatch(/retry once/);
  });
});

// buildit-demo-zod#1 printed "All 5 required checks passed with complete evidence" and then listed two
// required checks as already failing.
describe("the comment for required checks that were already failing", () => {
  const install = { name: "install", required: true, conclusion: "passed" as const, evidenceComplete: true };

  it("is inconclusive, not ready, when the test suite shows no test passing", () => {
    const { body, decision } = composeVerifiedReport({ ...base, checks: [...scanners, install,
      { name: "test", required: true, conclusion: "failed", evidenceComplete: true, preExisting: true, testSuiteFailing: true }] });
    expect(decision).toMatchObject({ status: "inconclusive", reason: "test_suite_failing", nextAction: "repair_test_suite" });
    expect(body).toMatch(/says nothing about this change/);
    expect(body).not.toMatch(/Ready for human review/);
  });

  // The reader needs the reason and the numbers together: the sentence names both clauses of the rule,
  // and the check row prints which one applied.
  it("says why the suite did not count, and shows the counts that decided it", () => {
    const { body } = composeVerifiedReport({ ...base, checks: [...scanners, install,
      { name: "test", required: true, conclusion: "failed", evidenceComplete: true, preExisting: true, testSuiteFailing: true,
        testCounts: { passed: 7, failed: 5, filesPassed: 6, filesFailed: 192 } }] });
    expect(body).toMatch(/no test passed, or most of its test files failed/);
    expect(body).toContain("Tests: 7 passed, 5 failed · Test files: 6 passed, 192 failed");
  });

  it("never says every required check passed when one failed before this change", () => {
    const { body, decision } = composeVerifiedReport({ ...base, checks: [install, scanners[0]!,
      { name: "gitleaks", required: true, conclusion: "failed", evidenceComplete: true, preExisting: true }] });
    expect(decision.status).toBe("checks_passed");
    expect(body).not.toMatch(/All \d+ required checks? passed/);
    expect(body).toMatch(/This change introduced no new failure in its 3 required checks/);
  });
});


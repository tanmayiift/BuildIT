import { describe, expect, it } from "vitest";
import { reportChecks } from "./reviewReportWorker";

const headSha = "a".repeat(40);

describe("review report evidence", () => {
  it("requires complete stdout for native commands and pinned complete scanner output", () => {
    const checks = reportChecks({ version: 1, pinned: { headSha }, output: { head: {
      results: [
        { planId: "test", required: true, conclusion: "passed" },
        { planId: "lint", required: false, conclusion: "passed" },
      ],
      outputs: [
        { planId: "test", text: "all tests passed", truncated: false, evidenceTruncated: false },
        { planId: "lint", text: "partial", truncated: true, evidenceTruncated: false },
      ],
    }, scanners: { head: { complete: true, commitSha: headSha, findings: [] } } } }, headSha);
    expect(checks).toEqual([
      { name: "test", required: true, conclusion: "passed", evidenceComplete: true },
      { name: "lint", required: false, conclusion: "passed", evidenceComplete: false },
      { name: "buildit-rules", required: true, conclusion: "passed", evidenceComplete: true },
    ]);
  });

  it("rejects validation evidence from a different commit", () => {
    expect(() => reportChecks({ version: 1, pinned: { headSha: "b".repeat(40) }, output: { head: { results: [], outputs: [] } } }, headSha)).toThrow("report_validation_pinning_failed");
  });
});

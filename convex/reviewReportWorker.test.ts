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
    }, scanners: { head: { complete: true, commitSha: headSha, runs: [
      { scanner: "builditRules", scannerVersion: "1.0.0" },
      { scanner: "gitleaks", scannerVersion: "8.28.0" },
      { scanner: "osvScanner", scannerVersion: "2.2.3" },
    ], findings: [{ scanner: "gitleaks", severity: "critical" }] } } } }, headSha);
    expect(checks).toEqual([
      { name: "test", required: true, conclusion: "passed", evidenceComplete: true },
      { name: "lint", required: false, conclusion: "passed", evidenceComplete: false },
      { name: "buildit-rules", required: true, conclusion: "passed", evidenceComplete: true },
      { name: "gitleaks", required: true, conclusion: "failed", evidenceComplete: true },
      { name: "osv-scanner", required: true, conclusion: "passed", evidenceComplete: true },
    ]);
  });

  it("rejects unknown or duplicated scanner inventory", () => {
    const validation = (runs: Array<{ scanner: string }>) => ({ version: 1, pinned: { headSha }, output: { head: { results: [], outputs: [] }, scanners: { head: { complete: true, commitSha: headSha, runs, findings: [] } } } });
    expect(() => reportChecks(validation([{ scanner: "unknown" }]), headSha)).toThrow("report_scanner_inventory_invalid");
    expect(() => reportChecks(validation([{ scanner: "gitleaks" }, { scanner: "gitleaks" }]), headSha)).toThrow("report_scanner_inventory_invalid");
  });

  it("rejects validation evidence from a different commit", () => {
    expect(() => reportChecks({ version: 1, pinned: { headSha: "b".repeat(40) }, output: { head: { results: [], outputs: [] } } }, headSha)).toThrow("report_validation_pinning_failed");
  });
});

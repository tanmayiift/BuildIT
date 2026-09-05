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
    // No excerpt on a passing check: only a failure needs to say what it reported, and this
    // payload becomes a public pull request comment.
    expect(checks.every(check => !("excerpt" in check))).toBe(true);
    expect(checks).toEqual([
      { name: "test", required: true, conclusion: "passed", evidenceComplete: true },
      { name: "lint", required: false, conclusion: "passed", evidenceComplete: false },
      { name: "buildit-rules", required: true, conclusion: "passed", evidenceComplete: true },
      { name: "gitleaks", required: true, conclusion: "failed", evidenceComplete: true },
      { name: "osv-scanner", required: true, conclusion: "passed", evidenceComplete: true },
    ]);
  });

  // The reviewer's complaint: a failing typecheck said nothing at all, which reads as a check
  // nobody watches. The text was carried this far and read only for a boolean.
  it("carries what a failing check reported, redacted", () => {
    const checks = reportChecks({ version: 1, pinned: { headSha }, output: { head: {
      results: [{ planId: "typecheck", required: false, conclusion: "failed" }],
      outputs: [{ planId: "typecheck", text: `error TS2322 with token ${["sk-", "ant-", "a".repeat(40)].join("")}`, truncated: false, evidenceTruncated: false }],
    }, scanners: { head: { complete: true, commitSha: headSha, runs: [
      { scanner: "builditRules", scannerVersion: "1.0.0" },
      { scanner: "gitleaks", scannerVersion: "8.28.0" },
      { scanner: "osvScanner", scannerVersion: "2.2.3" },
    ], findings: [] } } } }, headSha);
    const typecheck = checks.find(check => check.name === "typecheck")!;
    expect(typecheck.excerpt).toContain("error TS2322");
    // It becomes a public comment, so a secret in build output must not survive the trip.
    expect(typecheck.excerpt).not.toContain("a".repeat(40));
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

// The comparison existed and the report never read it. got had `test` and `buildit-rules` failing
// on both commits - a missing CA bundle, and a benchmark that disables TLS - and every pull request
// was blocked for both, with no finding to point at.
describe("a failure the base commit already had", () => {
  const headSha = "a".repeat(40);

  it("is marked pre-existing when the same check failed on base", () => {
    const checks = reportChecks({ version: 1, pinned: { headSha }, output: {
      head: { results: [{ planId: "test", required: true, conclusion: "failed" }],
        outputs: [{ planId: "test", text: "boom" }] },
      base: { results: [{ planId: "test", required: true, conclusion: "failed" }] },
    } } as never, headSha);

    expect(checks.find(check => check.name === "test")).toMatchObject({ conclusion: "failed", preExisting: true });
  });

  it("is not marked when the base commit passed it", () => {
    const checks = reportChecks({ version: 1, pinned: { headSha }, output: {
      head: { results: [{ planId: "test", required: true, conclusion: "failed" }],
        outputs: [{ planId: "test", text: "boom" }] },
      base: { results: [{ planId: "test", required: true, conclusion: "passed" }] },
    } } as never, headSha);

    expect(checks.find(check => check.name === "test")?.preExisting).toBeUndefined();
  });

  it("marks a scanner result the base produced identically", () => {
    const scanners = (severity: string) => ({ scanner: "builditRules", complete: true, commitSha: headSha,
      runs: [{ scanner: "builditRules", scannerVersion: "1" }], findings: [{ scanner: "builditRules", severity }] });
    const checks = reportChecks({ version: 1, pinned: { headSha }, output: {
      head: { results: [], outputs: [] },
      scanners: { head: { ...scanners("critical") }, base: { ...scanners("critical") } },
    } } as never, headSha);

    expect(checks.find(check => check.name === "buildit-rules")).toMatchObject({ conclusion: "failed", preExisting: true });
  });

  it("does not mark a scanner result this change introduced", () => {
    const checks = reportChecks({ version: 1, pinned: { headSha }, output: {
      head: { results: [], outputs: [] },
      scanners: {
        head: { scanner: "builditRules", complete: true, commitSha: headSha,
          runs: [{ scanner: "builditRules", scannerVersion: "1" }], findings: [{ scanner: "builditRules", severity: "critical" }] },
        base: { scanner: "builditRules", complete: true, commitSha: "b".repeat(40),
          runs: [{ scanner: "builditRules", scannerVersion: "1" }], findings: [] },
      },
    } } as never, headSha);

    expect(checks.find(check => check.name === "buildit-rules")).toMatchObject({ conclusion: "failed" });
    expect(checks.find(check => check.name === "buildit-rules")?.preExisting).toBeUndefined();
  });
});

// osv-scanner cannot resolve a Maven pom.xml or a Python pyproject.toml offline, and the sandbox
// has no network at scan time by design. That used to throw, the broker mapped it to
// scanner_unavailable, and the whole review died as a platform failure - it cost two of the first
// six real repositories reviewed, one Python and one Java, with the sandbox working, the
// repository's own tests run, and the code read.
describe("a scanner that could not read this repository", () => {
  const summary = (extra: Record<string, unknown>) => ({ version: 1 as const, pinned: { headSha }, output: { head: {
    results: [{ planId: "test", required: true, conclusion: "passed" as const }],
    outputs: [{ planId: "test", text: "ok", truncated: false, evidenceTruncated: false }],
  }, scanners: { head: { complete: true, commitSha: headSha, runs: [
    { scanner: "builditRules", scannerVersion: "1.0.0" },
    { scanner: "gitleaks", scannerVersion: "8.28.0" },
    { scanner: "osvScanner", scannerVersion: "2.2.3" },
  ], findings: [], ...extra } } } });

  it("reports it as not configured and advisory, never as a passing check", () => {
    const checks = reportChecks(summary({ unavailableScanners: ["osvScanner"] }), headSha);
    const osv = checks.find(item => item.name === "osv-scanner")!;
    // Passed would claim BuildIT looked at the dependencies and found nothing.
    expect(osv.conclusion).toBe("not_configured");
    // Required-and-failed would blame the author for an ecosystem BuildIT cannot scan.
    expect(osv.required).toBe(false);
  });

  it("leaves every other scanner required and unaffected", () => {
    const checks = reportChecks(summary({ unavailableScanners: ["osvScanner"] }), headSha);
    for (const name of ["gitleaks", "buildit-rules"]) {
      const check = checks.find(item => item.name === name)!;
      expect(check.required, name).toBe(true);
      expect(check.conclusion, name).toBe("passed");
    }
  });

  it("keeps a scanner that did run required, so this cannot become a way to quieten one", () => {
    const checks = reportChecks(summary({}), headSha);
    expect(checks.find(item => item.name === "osv-scanner")!.required).toBe(true);
    expect(checks.find(item => item.name === "osv-scanner")!.conclusion).toBe("passed");
  });
});

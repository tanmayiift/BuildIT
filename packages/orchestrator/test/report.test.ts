import { describe, expect, it } from "vitest";
import { composeVerifiedReport, type EvidenceRecord } from "../src/index.js";

const head = "a".repeat(40);
const evidence: EvidenceRecord = { id: "ev-1", artifactExists: true, commitSha: head, path: "src/a.ts", pathExists: true, startLine: 1, endLine: 2, contentHash: "hash", lineHashMatches: true, truncated: false, stdout: true };

const input = () => ({
  repository: "acme/api",
  prNumber: 7,
  headSha: head,
  baseSha: "b".repeat(40),
  configRevision: "cfg:1",
  coverage: "complete" as const,
  checks: [
    { name: "test", required: true, conclusion: "passed" as const, evidenceComplete: true },
    { name: "lint", required: false, conclusion: "not_run" as const, evidenceComplete: false },
  ],
  findings: [{ title: "Empty input bypass", severity: "high" as const, resolution: "accepted" as const, blocking: true, evidenceIds: ["ev-1"], path: "src/guard.ts", startLine: 12, endLine: 14, impact: "Invalid records can pass validation.", explanation: "Check the empty-value guard and add a boundary test." }],
  claims: [{ text: "The guard accepts empty input", evidenceIds: ["ev-1"], certainty: "certain" as const }],
  evidence: [evidence],
  environmentAvailable: true,
  isStale: false,
  costUsd: .12345,
  retentionExpiresAt: 0,
});

describe("verified report", () => {
  it("leads with one plain decision, reason, and human next action", () => {
    const report = composeVerifiedReport(input());
    expect(report.decision.status).toBe("changes_requested");
    expect(report.body).toContain("## Changes need review");
    expect(report.body).toContain("**1 blocking issue**");
    expect(report.body).toContain("**Next step:** Inspect the evidence and decide what to change.");
    expect(report.body).toContain("### What needs attention");
    expect(report.body).not.toContain("## BuildIT: changes_requested");
  });

  it("keeps guidance and check results readable while moving hashes to a technical receipt", () => {
    const report = composeVerifiedReport(input());
    expect(report.body).toContain("`src/guard.ts:12-14`");
    expect(report.body).toContain("**Why it matters:** Invalid records can pass validation.");
    expect(report.body).toContain("**What to inspect:** Check the empty-value guard and add a boundary test.");
    expect(report.body).toContain("### Validation checks");
    expect(report.body).toContain("| test | Required | Passed |");
    expect(report.body).toContain("<summary>Technical receipt</summary>");
    expect(report.body.indexOf(`Head commit: \`${head}\``)).toBeGreaterThan(report.body.indexOf("<summary>Technical receipt</summary>"));
    expect(report.body.indexOf("Evidence: `ev-1`")).toBeGreaterThan(report.body.indexOf("<summary>Technical receipt</summary>"));
    expect(report.body).toContain("Cost: $0.1235");
    expect(report.body).toContain("BuildIT did not merge");
  });

  it("never marks partial coverage ready", () => {
    const report = composeVerifiedReport({ ...input(), prNumber: 8, configRevision: "cfg:2", coverage: "partial", checks: [{ name: "test", required: true, conclusion: "passed", evidenceComplete: true }], findings: [], claims: [], evidence: [], costUsd: 0 });
    expect(report.decision).toMatchObject({ status: "inconclusive", reason: "incomplete_coverage" });
    expect(report.body).toContain("## Review needs attention");
    expect(report.body).toContain("Coverage: **Partial**");
  });

  it("drops unsupported claims and neutralizes mentions and markup", () => {
    const report = composeVerifiedReport({ ...input(), prNumber: 1, configRevision: "cfg", checks: [{ name: "test", required: true, conclusion: "passed", evidenceComplete: true }], findings: [{ title: "@buildit <script>alert(1)</script>", severity: "info", resolution: "uncertain", blocking: false, evidenceIds: ["ev-1"], path: "<script>bad.ts", startLine: 2, endLine: 2, impact: "@buildit <script>impact</script>", explanation: "@buildit <script>explanation</script>" }], claims: [{ text: "This is bug-free", evidenceIds: ["ev-1"], certainty: "certain" }, { text: "Unsupported", evidenceIds: ["missing"], certainty: "certain" }], costUsd: 0 });
    expect(report.publishedClaimCount).toBe(0);
    expect(report.body).not.toContain("@buildit");
    expect(report.body).not.toContain("<script>");
    expect(report.body).not.toContain("bug-free");
  });
});


// report.ts:safe is the last point before content leaves for a public pull request comment. It
// neutered @-mentions and stripped tags, but never redacted - so the one helper that combined
// redaction with injection-hardening was dead code implying a control that was not wired.
describe("GitHub egress boundary", () => {
  const withFinding = (title: string) => composeVerifiedReport({
    ...input(),
    findings: [{ title, severity: "high", resolution: "accepted", blocking: true, evidenceIds: [evidence.id] }],
  });

  it("redacts a credential that reached a finding title", () => {
    const secret = `github_pat_11ABCDEFG0${"a".repeat(50)}`;
    const rendered = JSON.stringify(withFinding(`Token ${secret} is committed`));
    expect(rendered).not.toContain(secret);
    expect(rendered).toContain("[REDACTED]");
  });

  // A verified bot posting [Click here to re-run CI](https://attacker.example) is a plausible
  // phishing surface the moment model prose reaches a comment.
  it("defuses Markdown link syntax", () => {
    const rendered = JSON.stringify(withFinding("[Click here to re-run CI](https://attacker.example)"));
    expect(rendered).not.toContain("](https://attacker.example)");
  });
});

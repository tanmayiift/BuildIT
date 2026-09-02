import { describe, expect, it } from "vitest";
import { assertReportPublicationContract, publicationTitle, reviewDetailsUrl } from "./reviewPublicationWorker";
import { composeVerifiedReport } from "@buildit/orchestrator";

const head = "a".repeat(40);

describe("review publication contract", () => {
  it("accepts the decision-first technical receipt at the exact head", () => {
    expect(() => assertReportPublicationContract([
      "## Changes need review",
      "<summary>Technical receipt</summary>",
      `- Head commit: \`${head}\``,
      "> BuildIT did not merge this pull request. A human owns the merge decision.",
    ].join("\n"), head)).not.toThrow();
  });

  it("keeps pending legacy reports publishable at the exact head", () => {
    expect(() => assertReportPublicationContract(`Head: \`${head}\`\nBuildIT did not merge this pull request.`, head)).not.toThrow();
  });

  it("rejects a wrong or abbreviated commit and a missing human boundary", () => {
    const boundary = "BuildIT did not merge this pull request.";
    expect(() => assertReportPublicationContract(`Head commit: \`${"b".repeat(40)}\`\n${boundary}`, head)).toThrow("report_publication_contract_failed");
    expect(() => assertReportPublicationContract(`Head commit: \`${head.slice(0, 12)}\`\n${boundary}`, head)).toThrow("report_publication_contract_failed");
    expect(() => assertReportPublicationContract(`Head commit: \`${head}\``, head)).toThrow("report_publication_contract_failed");
  });
});

describe("review publication title", () => {
  it("uses plain decision language for GitHub and email notifications", () => {
    expect(publicationTitle("changes_requested")).toBe("Changes need review");
    expect(publicationTitle("checks_passed")).toBe("Ready for human review");
    expect(publicationTitle("failed_after_three_rounds")).toBe("Review needs attention");
    expect(publicationTitle("unexpected_status")).toBe("Review needs attention");
  });

  it("links only to the fixed production review route", () => {
    expect(reviewDetailsUrl("review_123")).toBe("https://buildit-agentic-review.vercel.app/reviews/review_123");
    expect(reviewDetailsUrl("../foreign?x=1")).toBe("https://buildit-agentic-review.vercel.app/reviews/..%2Fforeign%3Fx%3D1");
  });
});

// The contract used to match one layout of the receipt line, so a formatting change in the
// composer broke publication in production while every test still passed: the composer was tested
// against bodies it wrote, and the contract against bodies the test wrote. Neither ever met.
describe("the contract holds a real composed report, not a hand-written one", () => {
  const head = "193bada89309abd8d6da4b3dae505df927951a3e";
  const report = composeVerifiedReport({
    repository: "acme/api", prNumber: 17, headSha: head, baseSha: "b".repeat(40),
    configRevision: "cfg:1", coverage: "complete", environmentAvailable: true, isStale: false,
    costUsd: 0.0544, retentionExpiresAt: Date.UTC(2026, 8, 9, 17, 17, 15),
    checks: [{ name: "test", required: true, conclusion: "passed", evidenceComplete: true }],
    findings: [], claims: [], evidence: [],
  });

  it("accepts the report the product actually publishes", () => {
    expect(() => assertReportPublicationContract(report.body, head)).not.toThrow();
  });

  // The invariant is the exact commit, not the words around it.
  it("still refuses a report for a different commit", () => {
    expect(() => assertReportPublicationContract(report.body, "c".repeat(40))).toThrow("report_publication_contract_failed");
  });

  it("still refuses a report missing the human-merge statement", () => {
    const stripped = report.body.replace("BuildIT did not merge this pull request.", "");
    expect(() => assertReportPublicationContract(stripped, head)).toThrow("report_publication_contract_failed");
  });
});

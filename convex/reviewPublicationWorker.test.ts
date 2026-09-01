import { describe, expect, it } from "vitest";
import { assertReportPublicationContract, publicationTitle } from "./reviewPublicationWorker";

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
});

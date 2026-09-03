import { describe, expect, it } from "vitest";
import { describeUnreadableSources } from "../src/requirements.js";

// A review of buildit-review-ms#1 passed all seven checks and its receipt still said
// "Requirement sources: One or more unreadable" - naming neither which source nor why, on a page
// whose entire promise is that every claim names its evidence. The prose above it was no better:
// it listed both possible causes ("a ticket in another repository, or a tracker with no connected
// credential") instead of saying which one happened.
//
// Every source already carries the answer: a status, and a version holding the reason. Nothing new
// has to be discovered here, only said.

const source = (over: Partial<{ type: string; status: string; version: string }> = {}) => ({
  id: "linked-1", type: "github_issue", url: "https://example.invalid/1", version: "v", fetchedAt: 0,
  status: "available", ...over,
}) as never;

describe("describing what could not be read", () => {
  it("says nothing when every source was read", () => {
    expect(describeUnreadableSources([source(), source({ type: "repository_document" })])).toBeUndefined();
  });

  it("names a ticket that lives in another repository, and what to do", () => {
    const result = describeUnreadableSources([
      source(),
      source({ status: "inaccessible", version: "repository_scope_mismatch" }),
    ]);
    expect(result?.total).toBe(2);
    expect(result?.unreadable).toBe(1);
    expect(result?.summary).toBe("a linked GitHub issue in another repository");
    expect(result?.nextStep).toBe("Link the issue from this repository, or restate the requirement in the pull request description.");
  });

  it("names a tracker with no connected credential", () => {
    const result = describeUnreadableSources([source({ type: "jira", status: "inaccessible", version: "connection_unavailable" })]);
    expect(result?.summary).toBe("a linked Jira ticket with no connected credential");
    expect(result?.nextStep).toBe("Connect Jira under Integrations, then re-run the review.");
  });

  it("names a source that was too large to read", () => {
    const result = describeUnreadableSources([source({ type: "repository_document", status: "oversized" })]);
    expect(result?.summary).toBe("a repository document too large to read");
    expect(result?.nextStep).toBe("Shorten the document, or move the requirement into the pull request description.");
  });

  // Two unreadable sources with different causes must not collapse into whichever came first.
  it("counts every unreadable source and leads with the most common cause", () => {
    const result = describeUnreadableSources([
      source({ status: "inaccessible", version: "repository_scope_mismatch" }),
      source({ status: "inaccessible", version: "repository_scope_mismatch" }),
      source({ type: "linear", status: "inaccessible", version: "connection_unavailable" }),
    ]);
    expect(result?.unreadable).toBe(3);
    expect(result?.summary).toContain("another repository");
    expect(result?.summary).toContain("1 other");
  });

  // The pull request body is itself a source, and it is never the thing a reader must go and fix.
  it("ignores the pull request body, which is not a linked source", () => {
    expect(describeUnreadableSources([source({ type: "pull_request", status: "oversized" })])).toBeUndefined();
  });

  it("falls back to a plain statement rather than inventing a cause it does not have", () => {
    const result = describeUnreadableSources([source({ status: "inaccessible", version: "something_new" })]);
    expect(result?.summary).toBe("a linked GitHub issue that could not be read");
    expect(result?.nextStep).toBe("Open the linked source and check BuildIT can reach it, then re-run the review.");
  });
});

describe("the receipt and the prose", () => {
  const base = {
    repository: "acme/api", prNumber: 1, headSha: "a".repeat(40), baseSha: "b".repeat(40),
    configRevision: "cfg", coverage: "partial" as const, coverageGap: "requirements" as const,
    checks: [], findings: [], claims: [], evidence: [], environmentAvailable: true, isStale: false,
    costUsd: 0.1, retentionExpiresAt: 0,
  };

  it("names the source and the remedy instead of listing both possible causes", async () => {
    const { composeVerifiedReport } = await import("../src/report.js");
    const { body: report } = composeVerifiedReport({ ...base,
      unreadableSources: { total: 2, unreadable: 1, summary: "a linked GitHub issue in another repository",
        nextStep: "Link the issue from this repository, or restate the requirement in the pull request description." } });

    expect(report).toContain("1 of 2 requirement sources could not be read: a linked GitHub issue in another repository.");
    expect(report).toContain("Link the issue from this repository");
    expect(report).toContain("| Requirement sources | 1 of 2 unreadable — a linked GitHub issue in another repository |");
    // The sentence that said nothing must be gone.
    expect(report).not.toContain("One or more unreadable");
  });

  it("still says something honest when the detail is unavailable", async () => {
    const { composeVerifiedReport } = await import("../src/report.js");
    const { body: report } = composeVerifiedReport(base);
    expect(report).toContain("A requirement source linked from this pull request could not be read");
    expect(report).toContain("| Requirement sources | One or more unreadable |");
  });

  it("says all read when nothing was missed", async () => {
    const { composeVerifiedReport } = await import("../src/report.js");
    const { coverageGap: _gap, ...withoutGap } = base;
    const { body: report } = composeVerifiedReport({ ...withoutGap, coverage: "complete" as const });
    expect(report).toContain("| Requirement sources | All read |");
  });
});

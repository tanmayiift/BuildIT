import { describe, expect, it } from "vitest";
import { summariseChange } from "../src/report.js";

// Every comparable tool opens with what the pull request does. BuildIT opens with a verdict, which
// is the right order, but a reader still had to work out what changed before the verdict meant
// anything. This is derived from the diff BuildIT already holds - no second model call, and
// nothing it cannot count.

const file = (path: string, additions: number, deletions: number, status = "modified") => ({ path, additions, deletions, status });

describe("summarising the change", () => {
  it("counts files and lines rather than describing intent it cannot verify", () => {
    expect(summariseChange([file("src/a.ts", 10, 2), file("src/b.ts", 1, 40)]))
      .toBe("2 files changed, 11 added and 42 removed.");
  });

  it("uses the singular for a single file", () => {
    expect(summariseChange([file("src/a.ts", 3, 0)])).toBe("1 file changed, 3 added and 0 removed.");
  });

  it("names added and removed files, because those are the structural changes", () => {
    expect(summariseChange([file("src/new.ts", 20, 0, "added"), file("src/old.ts", 0, 15, "removed"), file("src/a.ts", 1, 1)]))
      .toBe("3 files changed, 21 added and 16 removed. 1 file added, 1 removed.");
  });

  it("says nothing at all when there is no diff to describe", () => {
    expect(summariseChange([])).toBeUndefined();
  });

  // A rename is not a rewrite, and counting it as one overstates the change.
  it("counts a rename separately from an edit", () => {
    expect(summariseChange([file("src/b.ts", 0, 0, "renamed")]))
      .toBe("1 file changed, 0 added and 0 removed. 1 file renamed.");
  });
});

describe("where the summary appears in the report", () => {
  const base = {
    repository: "acme/api", prNumber: 1, headSha: "a".repeat(40), baseSha: "b".repeat(40),
    configRevision: "cfg", coverage: "complete" as const, checks: [], findings: [], claims: [],
    evidence: [], environmentAvailable: true, isStale: false, costUsd: 0.1, retentionExpiresAt: 0,
  };

  it("sits above the verdict, so a reader knows what changed before being told what to think", async () => {
    const { composeVerifiedReport } = await import("../src/report.js");
    const { body } = composeVerifiedReport({ ...base, changeSummary: "2 files changed, 11 added and 42 removed." });
    const summaryAt = body.indexOf("2 files changed"), verdictAt = body.indexOf("**Next step**");
    expect(summaryAt).toBeGreaterThan(-1);
    expect(summaryAt).toBeLessThan(verdictAt);
  });

  it("omits the line entirely rather than printing an empty one", async () => {
    const { composeVerifiedReport } = await import("../src/report.js");
    const { body } = composeVerifiedReport(base);
    expect(body).not.toContain("files changed");
  });
});

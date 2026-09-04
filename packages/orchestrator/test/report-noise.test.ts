import { describe, expect, it } from "vitest";
import { composeVerifiedReport } from "../src/report.js";

// Two things in a published review comment trained a reader to stop reading it.
//
// An advisory check whose script does not exist was reported as "Failed", with npm's whole error
// dump quoted underneath - including the path to a debug log inside a sandbox nobody can open. A
// missing script is a configuration fact, not a failure, and a table that calls it failure is a
// table people learn to skip.
//
// And every finding carried "Evidence: source-069198259a1bf52b1767cd01" - an identifier with no
// meaning outside BuildIT's own database, in the part of the comment a human actually reads.

const base = {
  repository: "acme/api", prNumber: 1, headSha: "a".repeat(40), baseSha: "b".repeat(40),
  configRevision: "cfg", coverage: "complete" as const, claims: [], evidence: [],
  environmentAvailable: true, isStale: false, costUsd: 0.05, retentionExpiresAt: 0,
};

const check = (over: Record<string, unknown> = {}) => ({
  name: "typecheck", required: false, conclusion: "failed" as const, evidenceId: "e1", ...over,
});

describe("a check that never ran", () => {
  it("reads as not configured, not as a failure", () => {
    const { body } = composeVerifiedReport({ ...base, findings: [],
      checks: [check({ conclusion: "not_configured" })] as never });
    expect(body).toContain("Not Configured");
    expect(body).not.toMatch(/\|\s*typecheck\s*\|\s*Advisory\s*\|\s*\*\*Failed\*\*/);
  });

  it("does not quote a package-manager dump for something that never executed", () => {
    const { body } = composeVerifiedReport({ ...base, findings: [],
      checks: [check({ conclusion: "not_configured",
        excerpt: 'npm error Missing script: "typecheck"\nnpm error A complete log of this run can be found in: /root/.npm/_logs/x-debug-0.log' })] as never });
    expect(body).not.toContain("/root/.npm/_logs");
    expect(body).not.toContain("Missing script");
  });

  it("still quotes output for a check that genuinely ran and failed", () => {
    const { body } = composeVerifiedReport({ ...base, findings: [],
      checks: [check({ conclusion: "failed", excerpt: "AssertionError: expected false to equal true" })] as never });
    expect(body).toContain("AssertionError");
  });
});

describe("what a finding cites", () => {
  const finding = {
    title: "TLS certificate verification is disabled", severity: "critical" as const,
    resolution: "accepted" as const, blocking: true,
    evidenceIds: ["source-069198259a1bf52b1767cd01", "source-91873b789f73a740d8d554c3"],
    path: "src/rates.js", startLine: 4, endLine: 4,
  };

  it("names the file and line a reader can open, not a database identifier", () => {
    const { body } = composeVerifiedReport({ ...base, checks: [], findings: [finding] as never });
    expect(body).toContain("src/rates.js:4");
    expect(body).not.toContain("source-069198259a1bf52b1767cd01");
  });

  it("still records that the evidence was verified, and how much of it there was", () => {
    const { body } = composeVerifiedReport({ ...base, checks: [], findings: [finding] as never });
    expect(body).toMatch(/2 verified sources|verified against 2/i);
  });

  it("says so plainly when a finding cites nothing", () => {
    const { body } = composeVerifiedReport({ ...base, checks: [],
      findings: [{ ...finding, evidenceIds: [] }] as never });
    expect(body).toContain("no cited evidence");
  });
});

// The review comment is where a reader is, and it never mentioned that commands exist. `@buildit
// help` was built and documented only on a page nobody opens while looking at a pull request -
// which is the same mistake the help command was written to fix, one level up.
describe("finding out what BuildIT can do", () => {
  it("points at help from the comment a reader is already looking at", () => {
    const { body } = composeVerifiedReport({ ...base, checks: [], findings: [] });
    expect(body).toContain("@buildit help");
  });

  it("keeps it out of the way, below the receipt", () => {
    const { body } = composeVerifiedReport({ ...base, checks: [], findings: [] });
    expect(body.indexOf("@buildit help")).toBeGreaterThan(body.indexOf("</details>"));
  });
});

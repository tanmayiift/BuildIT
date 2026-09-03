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
    expect(report.body).toContain("**Next step** — Inspect the evidence and decide what to change.");
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
    expect(report.body.indexOf(`| Head commit | \`${head}\` |`)).toBeGreaterThan(report.body.indexOf("<summary>Technical receipt</summary>"));
    expect(report.body.indexOf("Evidence: `ev-1`")).toBeGreaterThan(report.body.indexOf("<summary>Technical receipt</summary>"));
    expect(report.body).toContain("| Model cost | $0.1235 |");
    expect(report.body).toContain("BuildIT did not merge");
  });

  it("never marks partial coverage ready", () => {
    const report = composeVerifiedReport({ ...input(), prNumber: 8, configRevision: "cfg:2", coverage: "partial", checks: [{ name: "test", required: true, conclusion: "passed", evidenceComplete: true }], findings: [], claims: [], evidence: [], costUsd: 0 });
    expect(report.decision).toMatchObject({ status: "inconclusive", reason: "incomplete_coverage" });
    expect(report.body).toContain("## Review needs attention");
    expect(report.body).toContain("| Repository coverage | Partial |");
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

// From a real notification email: the report announced "All required checks produced passing
// evidence" while the table beside it showed typecheck · Optional · Failed. True by the letter and
// contradictory to read, which is the fastest way to lose a reader's trust in the rest of it.
describe("the report reads honestly in an inbox", () => {
  const withChecks = (checks: Array<{ name: string; required: boolean; conclusion: "passed" | "failed" }>) =>
    composeVerifiedReport({ ...input(), findings: [], claims: [],
      checks: checks.map(check => ({ ...check, evidenceComplete: true })) }).body;

  it("says an advisory check failed instead of claiming everything passed", () => {
    const body = withChecks([
      { name: "install", required: true, conclusion: "passed" },
      { name: "test", required: true, conclusion: "passed" },
      { name: "typecheck", required: false, conclusion: "failed" },
    ]);
    expect(body).toContain("All 2 required checks passed with complete evidence");
    expect(body).toContain("One advisory check did not pass");
    expect(body).toContain("typecheck");
    // And says plainly that it does not block, because that is the reader's next question.
    expect(body).toContain("Advisory checks do not block a merge");
  });

  // A reviewer said the silence around a failing typecheck "reads as a broken check nobody
  // watches". The output was captured by the runner and carried all the way here before being
  // dropped, so the report could say a check failed but never what it said.
  it("shows what a failing check actually reported", () => {
    const body = composeVerifiedReport({ ...input(), findings: [], claims: [], checks: [
      { name: "test", required: true, conclusion: "passed", evidenceComplete: true },
      { name: "typecheck", required: false, conclusion: "failed", evidenceComplete: true,
        excerpt: "src/rates.ts(4,7): error TS2322: Type 'string' is not assignable to type 'number'.\nFound 1 error." },
    ] }).body;
    expect(body).toContain("What `typecheck` reported");
    expect(body).toContain("error TS2322");
    expect(body).toContain("Found 1 error.");
  });

  it("cannot be made to break out of its code fence", () => {
    const body = composeVerifiedReport({ ...input(), findings: [], claims: [], checks: [
      { name: "test", required: true, conclusion: "failed", evidenceComplete: true,
        excerpt: "boom\n```\n## injected heading\n" },
    ] }).body;
    expect(body).not.toContain("\n```\n## injected heading");
    expect(body).toContain("boom");
  });

  it("stays silent when a failing check produced no output", () => {
    const body = composeVerifiedReport({ ...input(), findings: [], claims: [], checks: [
      { name: "test", required: true, conclusion: "failed", evidenceComplete: false },
    ] }).body;
    expect(body).not.toContain("reported");
  });

  // On a repository BuildIT has no command plans for, the scanners are the only required checks.
  // "All 3 required checks passed" is true and still misleads, because a reader assumes the tests
  // ran. Say what did not.
  it("says plainly when no test, lint or typecheck command ran", () => {
    const body = composeVerifiedReport({ ...input(), findings: [], claims: [], ecosystem: "none", checks: [
      { name: "buildit-rules", required: true, conclusion: "passed", evidenceComplete: true },
      { name: "gitleaks", required: true, conclusion: "passed", evidenceComplete: true },
      { name: "osv-scanner", required: true, conclusion: "passed", evidenceComplete: true },
    ] }).body;
    expect(body).toContain("recognised no package manager in this repository");
    expect(body).toContain("no test, lint or typecheck command was run");
  });

  it("adds no such caveat to a repository whose checks did run", () => {
    const body = composeVerifiedReport({ ...input(), findings: [], claims: [], ecosystem: "pnpm", checks: [
      { name: "test", required: true, conclusion: "passed", evidenceComplete: true },
    ] }).body;
    expect(body).not.toContain("recognised no package manager");
  });

  it("does not invent an advisory caveat when there is none", () => {
    const body = withChecks([
      { name: "install", required: true, conclusion: "passed" },
      { name: "lint", required: false, conclusion: "passed" },
    ]);
    expect(body).toContain("All 1 required check passed");
    expect(body).not.toContain("advisory check did not pass");
  });

  it("counts more than one advisory failure correctly", () => {
    const body = withChecks([
      { name: "install", required: true, conclusion: "passed" },
      { name: "lint", required: false, conclusion: "failed" },
      { name: "typecheck", required: false, conclusion: "failed" },
    ]);
    expect(body).toContain("2 advisory checks did not pass");
  });

  it("marks a failed row so the table can be skimmed", () => {
    const body = withChecks([
      { name: "install", required: true, conclusion: "passed" },
      { name: "typecheck", required: false, conclusion: "failed" },
    ]);
    expect(body).toContain("| typecheck | Advisory | **Failed** |");
    expect(body).toContain("| install | Required | Passed |");
  });

  // The retention promise was printed as 2026-09-09T17:17:15.790Z, which is a machine's way of
  // saying a date to a person - and in the wrong zone for the operator reading it.
  it("writes the retention date the way a person would", () => {
    const body = composeVerifiedReport({ ...input(), retentionExpiresAt: Date.UTC(2026, 8, 9, 17, 17, 15) }).body;
    expect(body).toContain("| Source evidence deleted after | 9 September 2026, 22:47 IST |");
    expect(body).not.toContain("2026-09-09T17:17:15");
  });

  it("names the repository, pull request and commit in one scannable line", () => {
    const body = composeVerifiedReport(input()).body;
    expect(body).toMatch(/\*\*Repository\*\* `acme\/api` {2}· {2}\*\*Pull request\*\* #7 {2}· {2}\*\*Commit\*\*/);
  });
});

// The composer and the publication contract were tested separately, each against a body it wrote
// itself, so nothing noticed when a formatting change to the receipt stopped satisfying the
// contract. Publication then threw in production, and because the review was already terminal the
// workflow's failure path swallowed it: a finished review with no comment on the pull request.
// This runs the real report through the real assertion.
describe("every report the composer produces can actually be published", () => {
  const assertPublishable = (body: string, headSha: string) => {
    if (!body.includes(headSha) || !body.includes("BuildIT did not merge this pull request.")) {
      throw new Error("report_publication_contract_failed");
    }
  };

  const shapes: Array<[string, Parameters<typeof composeVerifiedReport>[0]]> = [
    ["passing", { ...input(), findings: [], claims: [] }],
    ["with findings", input()],
    ["partial coverage", { ...input(), coverage: "partial" as const }],
    ["stale", { ...input(), isStale: true }],
    ["environment unavailable", { ...input(), environmentAvailable: false }],
    ["no checks at all", { ...input(), checks: [], findings: [], claims: [] }],
    ["injection unscoped", { ...input(), injectionUnscoped: true }],
  ];

  for (const [name, args] of shapes) {
    it(`publishes the ${name} report`, () => {
      const report = composeVerifiedReport(args);
      expect(() => assertPublishable(report.body, args.headSha)).not.toThrow();
      // The full commit, not a shortened one, so the reader can verify exactly what was judged.
      expect(report.body).toContain(args.headSha);
    });
  }
});

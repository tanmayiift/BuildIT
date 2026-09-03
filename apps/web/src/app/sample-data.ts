// One object, read by both the queue and the detail route. They used to be two: the queue listed
// nexus/web #22 as "Changes requested" while the detail route hardcoded nexus/api, commit a3f91c2
// and the "changes" state for every row. So all four statuses opened the same page, the repository
// changed identity between list and detail, and three of the four statuses taught the wrong
// meaning. A product whose whole claim is an exact pinned commit cannot lose the commit inside its
// own demo.
export type SampleFinding = {
  title: string;
  severity: string;
  path: string;
  lines: string;
  excerpt: string;
  why: string;
  testOutput: string;
  fix: string;
  stackedPr: { label: string; href: string };
};

export type SampleReview = {
  pr: number;
  repo: string;
  commit: string;
  baseCommit: string;
  title: string;
  status: string;
  tone: "danger" | "warning" | "running" | "success";
  state: "changes" | "budget" | "empty" | "running";
  coverage: string;
  signal: string;
  owner: string;
  age: string;
  group: "ready" | "progress";
  finding?: SampleFinding;
};

export const sampleReviews: SampleReview[] = [
  {
    pr: 22, repo: "nexus/web", commit: "b2c8f41", baseCommit: "7b2e004",
    title: "Update landing page typography",
    status: "Changes requested", tone: "danger", state: "changes",
    coverage: "2 / 2", signal: "1 high", owner: "Author", age: "12m", group: "ready",
    // The one complete example. An engineer judging the core claim needs the file, the line, the
    // code, the failing output, the proposed change and the pull request it would arrive in -
    // "no matching code change found" proves nothing on its own.
    finding: {
      title: "Rejected transfers are never written to the audit log",
      severity: "High",
      path: "src/transfers/limit.ts",
      lines: "41-47",
      excerpt: [
        "export function applyDailyLimit(transfer: Transfer, spentToday: number) {",
        "  if (spentToday + transfer.amount > DAILY_LIMIT) {",
        "    return { accepted: false, reason: \"daily_limit\" };",
        "    // no auditLog.record(...) on this path",
        "  }",
        "  return { accepted: true };",
        "}",
      ].join("\n"),
      why: "The acceptance criterion says every rejected transfer must be logged. This branch returns before any audit write, so a rejection leaves no trace for a later dispute.",
      testOutput: [
        "FAIL  src/transfers/limit.test.ts > logs every rejected transfer",
        "  AssertionError: expected auditLog.record to have been called 1 time, but it was called 0 times",
        "    at src/transfers/limit.test.ts:63:5",
        "",
        "Tests  1 failed | 11 passed (12)",
      ].join("\n"),
      fix: [
        " if (spentToday + transfer.amount > DAILY_LIMIT) {",
        "+  auditLog.record({ transferId: transfer.id, outcome: \"rejected\", reason: \"daily_limit\" });",
        "   return { accepted: false, reason: \"daily_limit\" };",
        " }",
      ].join("\n"),
      // A real, human-merged Autofix pull request on the public fixture repository, not a mock.
      stackedPr: { label: "buildit-public-fixture #19 · +1 / −1, merged by a human", href: "https://github.com/tanmayiift/buildit-public-fixture/pull/19" },
    },
  },
  {
    pr: 418, repo: "nexus/api", commit: "d9f2e1a", baseCommit: "c40aa19",
    title: "Refactor user authentication",
    status: "Failed after bounds", tone: "danger", state: "budget",
    coverage: "3 / 4", signal: "1 critical", owner: "You", age: "45m", group: "ready",
  },
  {
    pr: 91, repo: "nexus/core", commit: "f1a2b3c", baseCommit: "0d18ba7",
    title: "Add support for webhooks",
    status: "Inconclusive", tone: "warning", state: "empty",
    coverage: "0 / 1", signal: "1 medium", owner: "You", age: "1h", group: "ready",
  },
  {
    pr: 420, repo: "nexus/api", commit: "e5a1d2c", baseCommit: "9ac7f30",
    title: "Fix database race",
    status: "Running", tone: "running", state: "running",
    coverage: "Stage 3 / 4", signal: "Checks", owner: "You", age: "2m", group: "progress",
  },
];

export function sampleReviewFor(id: string): SampleReview | undefined {
  return sampleReviews.find(review => String(review.pr) === id);
}

export const efficacy = { reviewed: 45, suggestions: 18, implemented: 9, effectiveLoc: 126, regressions: 12 };

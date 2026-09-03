// One object, read by both the queue and the detail route. They used to be two: the queue listed
// nexus/web #22 as "Changes requested" while the detail route hardcoded nexus/api, commit a3f91c2
// and the "changes" state for every row. So all four statuses opened the same page, the repository
// changed identity between list and detail, and three of the four statuses taught the wrong
// meaning. A product whose whole claim is an exact pinned commit cannot lose the commit inside its
// own demo.
export type SampleFinding = {
  title: string;
  severity: string;
  verdict: string;
  path: string;
  lines: string;
  /** The date the review this was transcribed from actually ran. */
  reviewedAt: string;
  /** The real commit the finding was raised against - not the row's illustrative one. */
  commit: string;
  /** Where a reader can check every value above for themselves. */
  source: { label: string; href: string };
  excerpt: string;
  why: string;
  inspect: string;
  /** Which check produced the output below - not always a test. */
  checkName: string;
  checkOutput: string;
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
  /** The real check table from the review this row was transcribed from. */
  checks?: Array<{ name: string; policy: "Required" | "Advisory"; result: "Passed" | "Failed" }>;
  finding?: SampleFinding;
};

export const sampleReviews: SampleReview[] = [
  {
    pr: 22, repo: "nexus/web", commit: "b2c8f41", baseCommit: "7b2e004",
    title: "Update landing page typography",
    status: "Changes requested", tone: "danger", state: "changes",
    coverage: "2 / 2", signal: "1 critical", owner: "Author", age: "12m", group: "ready",
    checks: [
      { name: "install", policy: "Required", result: "Passed" },
      { name: "test", policy: "Required", result: "Failed" },
      { name: "lint", policy: "Advisory", result: "Passed" },
      { name: "typecheck", policy: "Advisory", result: "Failed" },
      { name: "buildit-rules", policy: "Required", result: "Failed" },
      { name: "gitleaks", policy: "Required", result: "Passed" },
      { name: "osv-scanner", policy: "Required", result: "Passed" },
    ],
    // Transcribed from a review BuildIT actually ran: tanmayiift/buildit-public-fixture#22 at
    // commit 699dd5f2f177, 2026-09-03. Every field below is quotable from that review, the file at
    // that commit, or the Autofix pull request it produced. Nothing here is composed.
    finding: {
      title: "TLS certificate verification is disabled",
      severity: "Critical",
      verdict: "Blocking · Confirmed by evidence",
      path: "src/rates.js",
      lines: "4",
      reviewedAt: "2026-09-03",
      commit: "699dd5f2f177a82f12a054daa7f68486cdcaf5b1",
      source: { label: "tanmayiift/buildit-public-fixture #22", href: "https://github.com/tanmayiift/buildit-public-fixture/pull/22" },
      // The file as it stood at 699dd5f2f177.
      excerpt: [
        'import https from "node:https";',
        "",
        "// Fetches the current tax rate table from the rates service.",
        "export const agentOptions = { rejectUnauthorized: false };",
        "const agent = new https.Agent(agentOptions);",
        "",
        "export async function fetchRates(url) {",
        "  const response = await fetch(url, { agent });",
      ].join("\n"),
      why: "An active network attacker can impersonate the rates service and supply a forged rate table, causing the application to trust and use tampered tax rates.",
      inspect: "The changed code exports `agentOptions = { rejectUnauthorized: false }`, which turns off server certificate validation for HTTPS requests in `fetchRates`. The supplied test explicitly requires `agentOptions.rejectUnauthorized` to be `true`, and head validation shows that test failing with `false !== true`.",
      // Verbatim from the review's "What `test` reported" block - the tail of the real run.
      checkName: "test",
      checkOutput: [
        "    code: 'ERR_ASSERTION',",
        "    actual: false,",
        "    expected: true,",
        "    operator: 'strictEqual',",
        "    diff: 'simple'",
        "  }",
      ].join("\n"),
      fix: [
        " // Fetches the current tax rate table from the rates service.",
        "-export const agentOptions = { rejectUnauthorized: false };",
        "+export const agentOptions = { rejectUnauthorized: true };",
        " const agent = new https.Agent(agentOptions);",
      ].join("\n"),
      stackedPr: {
        label: "buildit-public-fixture #23 · +1 / −1 · test and buildit-rules pass after the fix",
        href: "https://github.com/tanmayiift/buildit-public-fixture/pull/23",
      },
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

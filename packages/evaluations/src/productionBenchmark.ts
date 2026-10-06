// The historical set, run against production the way a user runs it: a `@buildit review` comment on
// the pull request, scored from the report BuildIT published. Until this existed the set was scored
// by hand, and its clean control had never run at all.
//
// Everything here is pure. productionBenchmarkCli.ts does the posting and polling; this decides what
// a published report says and what a set of runs scores, so both can be tested without production.
import { findDetection, mentionedPhrases, scoreCase, type ReviewedFinding } from "./detection.js";
import { historicalCases, historicalLabelDigest, historicalSetVersion, type HistoricalCase } from "./historicalCases.js";
import type { CaseOutcome as ComparedOutcome } from "./versionComparison.js";

export type PublishedStatus = "changes_requested" | "checks_passed" | "inconclusive";
export type PublishedFinding = ReviewedFinding & { startLine?: number; endLine?: number };
export type PublishedReport = { status?: PublishedStatus; findings: PublishedFinding[] };

// The report's own headings (report.ts title()). A heading this does not know is a report format
// change, and parsing it as "no verdict" would score silently wrong.
const headings: Record<string, PublishedStatus> = {
  "Changes need review": "changes_requested",
  "Ready for human review": "checks_passed",
  "Review needs attention": "inconclusive",
};

// Undoes what report.ts safe() does reversibly: bracket escapes and the full-width at sign. Tag
// stripping and whitespace collapsing are lossy, and neither changes which phrases a finding uses.
export function unescapeReportText(value: string) {
  return value.replace(/\\([[\]()])/g, "$1").replace(/＠/g, "@");
}

const severityLine = /^\*\*(Critical|High|Warning|Info) · (Blocking|Advisory) · (Confirmed by evidence|Needs human confirmation)\*\*(?: · `(.+):(\d+)(?:-(\d+))?`)?$/;

// The inverse of report.ts findingLines. It throws rather than skipping a line it cannot read: a
// finding dropped by the parser would score as a miss the reviewer never made.
export function parseReportFindings(body: string): PublishedReport {
  const lines = body.split(/\r?\n/);
  const heading = lines.find(line => line.startsWith("## "));
  const title = heading?.slice(3).trim();
  if (title !== undefined && !(title in headings)) throw new Error(`report_heading_unknown:${title}`);
  const report: PublishedReport = { ...(title ? { status: headings[title] } : {}), findings: [] };
  const start = lines.indexOf("### What needs attention");
  if (start < 0) return report;

  let pendingTitle: string | undefined;
  let current: PublishedFinding | undefined;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ") || line.startsWith("### ")) break;
    const numbered = /^#### \d+\. (.*)$/.exec(line);
    if (numbered) {
      if (pendingTitle !== undefined) throw new Error("report_finding_malformed:no_severity");
      pendingTitle = unescapeReportText(numbered[1]!);
      current = undefined;
      continue;
    }
    const severity = severityLine.exec(line);
    if (severity) {
      if (pendingTitle === undefined) throw new Error("report_finding_malformed:no_title");
      const [, level, blocking, confidence, path, startLine, endLine] = severity;
      current = {
        title: pendingTitle,
        severity: level!.toLowerCase() as PublishedFinding["severity"],
        blocking: blocking === "Blocking",
        resolution: confidence === "Confirmed by evidence" ? "accepted" : "uncertain",
        ...(path !== undefined ? {
          path: unescapeReportText(path).replace(/ˋ/g, "`"),
          startLine: Number(startLine),
          endLine: Number(endLine ?? startLine),
        } : {}),
      };
      report.findings.push(current);
      pendingTitle = undefined;
      continue;
    }
    if (pendingTitle !== undefined && line.trim()) throw new Error("report_finding_malformed:no_severity");
    const impact = /^\*\*Why it matters:\*\* (.*)$/.exec(line);
    if (impact && current) current.impact = unescapeReportText(impact[1]!);
    const explanation = /^\*\*What to inspect:\*\* (.*)$/.exec(line);
    if (explanation && current) current.explanation = unescapeReportText(explanation[1]!);
  }
  if (pendingTitle !== undefined) throw new Error("report_finding_malformed:no_severity");
  return report;
}

// What the database stored for the same review, as scripts/lib/production-review-read.mjs returns it.
export type StoredReview = { status: string; findings: ReadonlyArray<{ severity: string; blocking: boolean; resolution: string; lines: ReadonlyArray<number | undefined> }> };

// The parse is trusted only when it agrees with what the review stored. The report and the table
// are written from the same arbitrated list, but the table keeps one row per fingerprint, so this
// compares distinct findings rather than counts.
export function crossCheck(published: PublishedReport, stored: StoredReview): string | undefined {
  if (published.status !== stored.status) return `status:${published.status ?? "none"}≠${stored.status}`;
  const coarse = (item: { severity: string; blocking: boolean; resolution: string }) => `${item.severity}|${item.blocking}|${item.resolution}`;
  const kept = stored.findings.filter(item => item.resolution !== "rejected");
  const storedFull = new Set(kept.map(item => `${coarse(item)}|${item.lines[0]}-${item.lines[1]}`));
  const storedCoarse = new Set(kept.map(coarse));
  for (const item of published.findings) {
    const found = item.startLine !== undefined ? storedFull.has(`${coarse(item)}|${item.startLine}-${item.endLine}`) : storedCoarse.has(coarse(item));
    if (!found) return `published_not_stored:${coarse(item)}`;
  }
  for (const item of kept) {
    const found = published.findings.some(entry => coarse(entry) === coarse(item)
      && (entry.startLine === undefined || (entry.startLine === item.lines[0] && entry.endLine === item.lines[1])));
    if (!found) return `stored_not_published:${coarse(item)}`;
  }
  return undefined;
}

// What a run file keeps of a finding: where, how severe, whether it blocked, and which of the
// defect's phrases it used - never the model's prose. Scoring a recorded finding through
// asReviewedFinding gives exactly the answer findDetection gave the live one.
export type RecordedFinding = {
  title: string; path?: string; startLine?: number; endLine?: number;
  severity: PublishedFinding["severity"]; blocking: boolean; resolution: PublishedFinding["resolution"];
  mentions: string[];
};

export function recordFinding(item: HistoricalCase, finding: PublishedFinding): RecordedFinding {
  return {
    title: finding.title,
    ...(finding.path !== undefined ? { path: finding.path } : {}),
    ...(finding.startLine !== undefined ? { startLine: finding.startLine } : {}),
    ...(finding.endLine !== undefined ? { endLine: finding.endLine } : {}),
    severity: finding.severity, blocking: finding.blocking, resolution: finding.resolution,
    mentions: item.expect ? mentionedPhrases(item.expect, finding) : [],
  };
}

export type BlockingPolicy = "published" | "critical-high";

// "published" scores what production did. "critical-high" rescores the same findings as if only
// critical and high could block - exact for model findings, because arbitration marks a finding
// blocking only when it is accepted, so removing warning from the blocking set is an intersection.
export function asReviewedFinding(finding: RecordedFinding, policy: BlockingPolicy): ReviewedFinding {
  const blocking = finding.blocking && (policy === "published" || finding.severity === "critical" || finding.severity === "high");
  return {
    title: finding.title, severity: finding.severity, blocking, resolution: finding.resolution,
    ...(finding.path !== undefined ? { path: finding.path } : {}),
    explanation: finding.mentions.join(" "),
  };
}

export type RunValidity = "valid" | "invalid_parse" | "invalid_platform";

export type RunRecord = {
  caseId: string; run: number; attempt: number; at: string;
  validity: RunValidity;
  because?: string;
  reviewId?: string; status?: string; reason?: string;
  promptVersions?: Record<string, string>; model?: string;
  costUsd?: number; inputTokens?: number; cachedInputTokens?: number; consentToVerdictSeconds?: number;
  findings?: RecordedFinding[];
};

export type RunsFile = {
  kind: "buildit-production-benchmark-runs";
  setVersion: string; labelDigest: string; label: string; provider: string; runsPerCase: number; startedAt: string;
  runs: RunRecord[];
};

export type CaseScore = {
  caseId: string; kind: HistoricalCase["kind"];
  outcome?: ComparedOutcome["outcome"];
  validRuns: number; invalidParse: number; invalidPlatform: number;
  // Defects: valid runs that found it. Clean control: valid runs that blocked it.
  hits: number;
  because: string;
};

export type ScoredRun = {
  kind: "buildit-production-benchmark-score";
  setVersion: string; labelDigest: string; label: string; policy: BlockingPolicy; promptVersion: string; promptVersions: Record<string, string>;
  // The shape pnpm eval:compare reads. A case with fewer than two valid runs is left out of it, so a
  // platform failure can never be compared as a miss.
  cases: Array<{ caseId: string; outcome: ComparedOutcome["outcome"] }>;
  excluded: Array<{ caseId: string; because: string }>;
  details: CaseScore[];
  totals: { reviews: number; validReviews: number; costUsd: number; inputTokens: number; cachedInputTokens: number };
};

// A run is final once it is valid, unparseable, or a platform failure that has used its retries.
export const platformRetries = 2;
export function runIsSettled(runs: readonly RunRecord[], caseId: string, run: number) {
  const attempts = runs.filter(item => item.caseId === caseId && item.run === run);
  return attempts.some(item => item.validity !== "invalid_platform") || attempts.length > platformRetries;
}

// Blocked means the person's correct pull request could not merge: a blocking finding under the
// policy, or a changes-requested verdict no finding explains (a failing check).
function runBlocks(item: HistoricalCase, run: RunRecord, policy: BlockingPolicy) {
  const findings = run.findings ?? [];
  const byChecks = run.status === "changes_requested" && !findings.some(finding => finding.blocking && finding.resolution !== "rejected");
  return byChecks || !scoreCase(item, findings.map(finding => asReviewedFinding(finding, policy))).passed;
}

export function scoreRuns(file: RunsFile, policy: BlockingPolicy, cases: ReadonlyArray<HistoricalCase> = historicalCases): ScoredRun {
  if (file.kind !== "buildit-production-benchmark-runs") throw new Error("eval_production_file_kind");
  if (file.setVersion !== historicalSetVersion) throw new Error(`eval_production_set_mismatch:${file.setVersion}`);
  // Labels edited after the runs were recorded would score them against a question they never answered.
  if (file.labelDigest !== historicalLabelDigest(cases)) throw new Error("eval_production_labels_changed");

  const versions = new Map<string, Set<string>>();
  for (const run of file.runs.filter(item => item.validity === "valid")) {
    for (const [stage, version] of Object.entries(run.promptVersions ?? {})) {
      versions.set(stage, (versions.get(stage) ?? new Set()).add(version));
    }
  }
  const mixed = [...versions].filter(([, values]) => values.size > 1).map(([stage]) => stage);
  // One file is one prompt version. Runs that straddle a deploy measure two things at once.
  if (mixed.length) throw new Error(`eval_production_prompt_mixed:${mixed.join(",")}`);
  const promptVersions = Object.fromEntries([...versions].map(([stage, values]) => [stage, [...values][0]!]));

  const details: CaseScore[] = [];
  for (const item of cases) {
    const attempts = file.runs.filter(run => run.caseId === item.id);
    if (!attempts.length) continue;
    const valid = attempts.filter(run => run.validity === "valid");
    const counts = {
      validRuns: valid.length,
      invalidParse: attempts.filter(run => run.validity === "invalid_parse").length,
      invalidPlatform: attempts.filter(run => run.validity === "invalid_platform").length,
    };
    if (valid.length < 2) {
      details.push({ caseId: item.id, kind: item.kind, ...counts, hits: 0, because: `only ${valid.length} valid run${valid.length === 1 ? "" : "s"}; not scored` });
      continue;
    }
    if (item.kind === "clean") {
      const blocked = valid.filter(run => runBlocks(item, run, policy));
      // One blocked run is a person's correct pull request blocked. It is not averaged away.
      details.push({ caseId: item.id, kind: item.kind, ...counts, hits: blocked.length,
        outcome: blocked.length ? "false_blocking" : "clean_pass",
        because: blocked.length ? `blocked in ${blocked.length} of ${valid.length} runs` : `passed all ${valid.length} runs` });
      continue;
    }
    const found = valid.filter(run => findDetection(item, (run.findings ?? []).map(finding => asReviewedFinding(finding, policy))));
    // Detected means a majority of valid runs found it: the model is not deterministic, and one lucky
    // run out of three is not a reviewer a team can rely on.
    const needed = Math.floor(valid.length / 2) + 1;
    details.push({ caseId: item.id, kind: item.kind, ...counts, hits: found.length,
      outcome: found.length >= needed ? "detected" : "missed",
      because: `found in ${found.length} of ${valid.length} runs (needs ${needed})` });
  }

  const reviewed = file.runs.filter(run => run.reviewId);
  const sum = (key: "costUsd" | "inputTokens" | "cachedInputTokens") => reviewed.reduce((total, run) => total + (run[key] ?? 0), 0);
  return {
    kind: "buildit-production-benchmark-score",
    setVersion: file.setVersion, labelDigest: file.labelDigest, label: file.label, policy,
    promptVersion: promptVersions.findings ?? "unknown", promptVersions,
    cases: details.filter(item => item.outcome).map(item => ({ caseId: item.caseId, outcome: item.outcome! })),
    excluded: details.filter(item => !item.outcome).map(item => ({ caseId: item.caseId, because: item.because })),
    details,
    totals: {
      reviews: reviewed.length, validReviews: file.runs.filter(run => run.validity === "valid").length,
      costUsd: Math.round(sum("costUsd") * 1e4) / 1e4, inputTokens: sum("inputTokens"), cachedInputTokens: sum("cachedInputTokens"),
    },
  };
}

// The statuses a review can end in. Completed ones published a verdict; the rest are the platform's
// failure, never the reviewer's miss.
export const completedStatuses = new Set(["checks_passed", "changes_requested", "inconclusive"]);
export const platformEndStatuses = new Set(["platform_failed", "cancelled", "blocked", "budget_exhausted", "failed_after_bounds"]);

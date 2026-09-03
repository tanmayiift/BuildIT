import { redact } from "@buildit/security";
import { computeReviewDecision, gateClaims, type EvidenceRecord, type MaterialClaim, type ReviewCheckDecision } from "./index.js";

type ReportFinding = { title: string; severity: "critical" | "high" | "warning" | "info"; resolution: "accepted" | "rejected" | "uncertain"; blocking: boolean; evidenceIds: string[]; path?: string; startLine?: number; endLine?: number; impact?: string; explanation?: string };

const redactionSentinel = "\u0000BUILDIT_REDACTED\u0000";

function safe(value: string) {
  return redact(value)
    .replaceAll("[REDACTED]", redactionSentinel)
    .replace(/@/g, "＠")
    .replace(/<[^>]*>/g, "")
    // Markdown link syntax survived into a comment posted by a verified bot, which makes
    // [Click here to re-run CI](https://attacker.example) a plausible phishing surface.
    .replace(/[[\]()]/g, character => `\\${character}`)
    .replace(/[\u0001-\u001f\u007f]/g, " ")
    .replaceAll(redactionSentinel, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
}

function code(value: string) { return safe(value).replace(/`/g, "ˋ"); }
function fence(value: string) { return value.replace(/```/g, "ˋˋˋ").replace(/\u0000/g, ""); }

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// A fixed +05:30 shift rather than a locale lookup: the report has to render identically wherever
// it is composed, and the operator alert template applies the same offset for the same reason.
function istDate(epochMs: number) {
  const shifted = new Date(epochMs + 5.5 * 60 * 60_000);
  const day = shifted.getUTCDate();
  const hours = String(shifted.getUTCHours()).padStart(2, "0");
  const minutes = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${day} ${months[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()}, ${hours}:${minutes} IST`;
}
function title(status: "changes_requested" | "inconclusive" | "checks_passed") {
  if (status === "changes_requested") return "Changes need review";
  if (status === "checks_passed") return "Ready for human review";
  return "Review needs attention";
}
function nextStep(action: "start_new_review" | "retry_review" | "inspect_findings" | "human_merge" | "none") {
  if (action === "human_merge") return "Untrusted text in this pull request tried to steer the review. Read the changes yourself before merging.";
  if (action === "inspect_findings") return "Inspect the evidence and decide what to change.";
  if (action === "start_new_review") return "The pull request changed. Start a new review at the current commit.";
  if (action === "retry_review") return "Resolve the missing context or checks, then retry once.";
  return "Review the evidence and merge only if you agree with it.";
}
function conclusion(value: ReviewCheckDecision["conclusion"]) {
  return value.split("_").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
function findingLines(finding: ReportFinding, index: number) {
  const location = typeof finding.path === "string" && Number.isInteger(finding.startLine) && Number.isInteger(finding.endLine)
    ? ` · \`${code(finding.path)}:${finding.startLine}${finding.endLine === finding.startLine ? "" : `-${finding.endLine}`}\``
    : "";
  const confidence = finding.resolution === "accepted" ? "Confirmed by evidence" : "Needs human confirmation";
  return [
    `#### ${index + 1}. ${safe(finding.title)}`,
    `**${finding.severity.charAt(0).toUpperCase() + finding.severity.slice(1)} · ${finding.blocking ? "Blocking" : "Advisory"} · ${confidence}**${location}`,
    ...(finding.impact?.trim() ? [``, `**Why it matters:** ${safe(finding.impact)}`] : []),
    ...(finding.explanation?.trim() ? [``, `**What to inspect:** ${safe(finding.explanation)}`] : []),
  ];
}

export function composeVerifiedReport(input: { repository: string; prNumber: number; headSha: string; baseSha: string; configRevision: string; coverage: "complete" | "partial"; injectionUnscoped?: boolean; checks: ReviewCheckDecision[]; findings: ReportFinding[]; claims: MaterialClaim[]; evidence: EvidenceRecord[]; environmentAvailable: boolean; isStale: boolean; costUsd: number; retentionExpiresAt: number }) {
  const decision = computeReviewDecision({ isStale: input.isStale, environmentAvailable: input.environmentAvailable, coverageComplete: input.coverage === "complete", ...(input.injectionUnscoped ? { injectionUnscoped: true } : {}), checks: input.checks, findings: input.findings });
  const claims = gateClaims(input.claims, input.evidence, input.headSha);
  const visibleFindings = input.findings.filter(finding => finding.resolution !== "rejected");
  const blockingFindings = visibleFindings.filter(finding => finding.resolution === "accepted" && finding.blocking).length;
  const failedRequiredChecks = input.checks.filter(check => check.required && check.conclusion === "failed" && check.evidenceComplete).length;
  const requiredChecks = input.checks.filter(check => check.required);
  const failedAdvisory = input.checks.filter(check => !check.required && check.conclusion === "failed");
  const advisoryNote = failedAdvisory.length
    ? ` ${failedAdvisory.length === 1 ? "One advisory check did not pass" : `${failedAdvisory.length} advisory checks did not pass`}: ${failedAdvisory.map(check => `\`${code(check.name)}\``).join(", ")}. Advisory checks do not block a merge.`
    : "";
  const problems = [
    blockingFindings ? `**${blockingFindings} blocking ${blockingFindings === 1 ? "issue" : "issues"}**` : "",
    failedRequiredChecks ? `**${failedRequiredChecks} required ${failedRequiredChecks === 1 ? "check" : "checks"} failed**` : "",
  ].filter(Boolean).join(" and ");
  const summary = problems
    || (decision.status === "checks_passed"
      ? `All ${requiredChecks.length} required ${requiredChecks.length === 1 ? "check" : "checks"} passed with complete evidence`
      : "Complete evidence was not available");
// A failing check produced one bolded table cell and nothing else - no output, no evidence - which
// reads as a check nobody watches, advisory or not. The text was captured by the runner and
// carried all the way to the report worker before being dropped. Cite the tail of it: the last
// lines are where a test runner or a compiler puts the reason.
const excerptLines = 6;
const excerptChars = 600;
function checkExcerpt(check: ReviewCheckDecision) {
  if (!check.excerpt?.trim()) return "";
  const tail = check.excerpt.replace(/\s+$/, "").split("\n").slice(-excerptLines).join("\n").slice(-excerptChars);
  return `\n\n<details>\n<summary>What \`${code(check.name)}\` reported</summary>\n\n\`\`\`\n${fence(tail)}\n\`\`\`\n\n</details>`;
}

  const checkRows = input.checks.length
    ? input.checks.map(check => `| ${safe(check.name)} | ${check.required ? "Required" : "Advisory"} | ${check.conclusion === "failed" ? `**${conclusion(check.conclusion)}**` : conclusion(check.conclusion)}${check.evidenceComplete ? "" : " · evidence incomplete"} |`)
    : ["| No checks configured | — | Not run |"];
  const failedChecks = input.checks.filter(check => check.conclusion === "failed" || check.conclusion === "timed_out");
  const checkExcerpts = failedChecks.map(checkExcerpt).filter(Boolean).join("");
  const evidenceReceipts = visibleFindings.map(finding => `- ${safe(finding.title)} — Evidence: ${finding.evidenceIds.length ? finding.evidenceIds.map(id => `\`${code(id)}\``).join(", ") : "none"}`);
  const claimReceipts = claims.map(claim => `- ${safe(claim.text)} — Evidence: ${claim.evidenceIds.map(id => `\`${code(id)}\``).join(", ")}`);
  const lines = [
    `## ${title(decision.status)}`,
    "",
    `**Repository** \`${code(input.repository)}\`  ·  **Pull request** #${input.prNumber}  ·  **Commit** \`${code(input.headSha.slice(0, 12))}\``,
    "",
    `${summary}.${advisoryNote}`,
    "",
    `**Next step** — ${nextStep(decision.nextAction)}`,
    "",
    "> BuildIT did not merge this pull request. A human owns the merge decision.",
    ...(visibleFindings.length ? ["", "### What needs attention", "", ...visibleFindings.flatMap(findingLines)] : []),
    "",
    "### Validation checks",
    "",
    "| Check | Policy | Result |",
    "| --- | --- | --- |",
    ...checkRows,
    ...(checkExcerpts ? [checkExcerpts] : []),
    ...(claims.length ? ["", "### Additional evidence", "", ...claims.map(claim => `- ${safe(claim.text)}`)] : []),
    "",
    "<details>",
    "<summary>Technical receipt</summary>",
    "",
    "| | |",
    "| --- | --- |",
    `| Head commit | \`${code(input.headSha)}\` |`,
    `| Base commit | \`${code(input.baseSha)}\` |`,
    `| Trusted configuration | \`${code(input.configRevision)}\` |`,
    `| Repository coverage | ${input.coverage === "complete" ? "Complete" : "Partial"} |`,
    `| Model cost | $${input.costUsd.toFixed(4)} |`,
    `| Source evidence deleted after | ${istDate(input.retentionExpiresAt)} |`,
    ...(evidenceReceipts.length || claimReceipts.length ? ["", ...evidenceReceipts, ...claimReceipts] : []),
    "",
    "</details>",
  ];
  return { decision, body: lines.join("\n"), publishedClaimCount: claims.length };
}

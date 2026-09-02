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

export function composeVerifiedReport(input: { repository: string; prNumber: number; headSha: string; baseSha: string; configRevision: string; coverage: "complete" | "partial"; checks: ReviewCheckDecision[]; findings: ReportFinding[]; claims: MaterialClaim[]; evidence: EvidenceRecord[]; environmentAvailable: boolean; isStale: boolean; costUsd: number; retentionExpiresAt: number }) {
  const decision = computeReviewDecision({ isStale: input.isStale, environmentAvailable: input.environmentAvailable, coverageComplete: input.coverage === "complete", checks: input.checks, findings: input.findings });
  const claims = gateClaims(input.claims, input.evidence, input.headSha);
  const visibleFindings = input.findings.filter(finding => finding.resolution !== "rejected");
  const blockingFindings = visibleFindings.filter(finding => finding.resolution === "accepted" && finding.blocking).length;
  const failedRequiredChecks = input.checks.filter(check => check.required && check.conclusion === "failed" && check.evidenceComplete).length;
  const summary = [
    blockingFindings ? `**${blockingFindings} blocking ${blockingFindings === 1 ? "issue" : "issues"}**` : "",
    failedRequiredChecks ? `**${failedRequiredChecks} required ${failedRequiredChecks === 1 ? "check" : "checks"} failed**` : "",
  ].filter(Boolean).join(" and ") || (decision.status === "checks_passed" ? "All required checks produced passing evidence" : "Complete evidence was not available");
  const checkRows = input.checks.length
    ? input.checks.map(check => `| ${safe(check.name)} | ${check.required ? "Required" : "Optional"} | ${conclusion(check.conclusion)}${check.evidenceComplete ? "" : " · evidence incomplete"} |`)
    : ["| No checks configured | — | Not run |"];
  const evidenceReceipts = visibleFindings.map(finding => `- ${safe(finding.title)} — Evidence: ${finding.evidenceIds.length ? finding.evidenceIds.map(id => `\`${code(id)}\``).join(", ") : "none"}`);
  const claimReceipts = claims.map(claim => `- ${safe(claim.text)} — Evidence: ${claim.evidenceIds.map(id => `\`${code(id)}\``).join(", ")}`);
  const lines = [
    `## ${title(decision.status)}`,
    `\`${code(input.repository)}\` #${input.prNumber} · exact commit \`${code(input.headSha.slice(0, 12))}\``,
    "",
    `${summary}.`,
    "",
    `**Next step:** ${nextStep(decision.nextAction)}`,
    "",
    "> BuildIT did not merge this pull request. A human owns the merge decision.",
    ...(visibleFindings.length ? ["", "### What needs attention", "", ...visibleFindings.flatMap(findingLines)] : []),
    "",
    "### Validation checks",
    "",
    "| Check | Policy | Result |",
    "| --- | --- | --- |",
    ...checkRows,
    ...(claims.length ? ["", "### Additional evidence", "", ...claims.map(claim => `- ${safe(claim.text)}`)] : []),
    "",
    "<details>",
    "<summary>Technical receipt</summary>",
    "",
    `- Repository: \`${code(input.repository)}\` · PR #${input.prNumber}`,
    `- Head commit: \`${code(input.headSha)}\``,
    `- Base commit: \`${code(input.baseSha)}\``,
    `- Trusted configuration: \`${code(input.configRevision)}\``,
    `- Coverage: **${input.coverage === "complete" ? "Complete" : "Partial"}**`,
    `- Cost: $${input.costUsd.toFixed(4)}`,
    `- Source-derived evidence expires: ${new Date(input.retentionExpiresAt).toISOString()}`,
    ...(evidenceReceipts.length || claimReceipts.length ? ["", ...evidenceReceipts, ...claimReceipts] : []),
    "",
    "</details>",
  ];
  return { decision, body: lines.join("\n"), publishedClaimCount: claims.length };
}

// The terminal reviewStatus values. Cross-checked against packages/contracts and
// convex/validators.ts by tests/architecture/review-status-contract.test.ts.
export const terminalReviewStatuses: readonly string[] = [
  "checks_passed", "changes_requested", "inconclusive", "delivered",
  "failed_after_bounds", "cancelled", "budget_exhausted", "platform_failed",
];

export type ReviewTone = "success" | "danger" | "running" | "warning";

export type CheckExecution = {
  kind: string;
  required: boolean;
  conclusion: string;
  durationMs: number;
  evidenceAvailable: boolean;
};

export type CheckSummary = CheckExecution & {
  executions: number;
  outcomeSummary: string;
};

const words = (value: string) => value.replaceAll("_", " ").replace(/^./, first => first.toUpperCase());

export function statusPresentation(status: string, stale: boolean, reason?: string) {
  if (stale) return { label: "Out of date", title: "The pull request changed", summary: "This review no longer matches the latest code. Run a new review before deciding whether to merge.", tone: "warning" as ReviewTone, symbol: "↻" };
  if (status === "platform_failed" && reason === "provider_rate_limited") return { label: "Provider is busy", title: "Your model provider is rate-limited", summary: "BuildIT made no code decision. Wait for the provider limit to clear, then retry this exact review.", tone: "warning" as ReviewTone, symbol: "⏳" };
  const known: Record<string, { label: string; title: string; summary: string; tone: ReviewTone; symbol: string }> = {
  cancelled: { label: "Stopped", title: "Review stopped", summary: "No decision was made. BuildIT did not read code, run checks, or change this pull request. Start a new review when you are ready.", tone: "warning", symbol: "■" },
    passed: { label: "Ready for you", title: "All required checks passed", summary: "BuildIT found enough evidence for this exact commit. A human still decides whether to merge.", tone: "success", symbol: "✓" },
    checks_passed: { label: "Ready for you", title: "All required checks passed", summary: "BuildIT found enough evidence for this exact commit. A human still decides whether to merge.", tone: "success", symbol: "✓" },
    delivered: { label: "Fix ready", title: "A tested fix is ready to inspect", summary: "The fix is in a separate pull request. Review the changes and merge only if you agree.", tone: "success", symbol: "✓" },
    changes_requested: { label: "Action needed", title: "Changes are needed before merge", summary: "BuildIT found evidence-backed issues or failed checks. Review the items below with the author.", tone: "danger", symbol: "!" },
    failed_after_bounds: { label: "Needs a developer", title: "BuildIT could not finish the fix", summary: "Three fix rounds were used. The remaining issues are listed below for a developer.", tone: "danger", symbol: "!" },
    platform_failed: { label: "Could not complete", title: "BuildIT hit a service problem", summary: "This is not a code verdict. Retry after the service problem is resolved.", tone: "danger", symbol: "×" },
    budget_exhausted: { label: "Budget reached", title: "Review stopped before the next model step", summary: "BuildIT made no code decision and did not make the model call that could cross your chosen limit.", tone: "warning", symbol: "$" },
    inconclusive: { label: "Not enough proof", title: "A safe decision is not possible yet", summary: "Some required evidence is missing or unclear. Treat this review as not approved.", tone: "warning", symbol: "?" },
  };
  return known[status] ?? { label: "In progress", title: "BuildIT is reviewing this change", summary: "Evidence will appear here as each review step completes.", tone: "running" as ReviewTone, symbol: "●" };
}

// Every value of the nextActionCode union in convex/validators.ts. The Record type makes a
// missing key a compile error, so the map cannot silently drift out of the enum again and
// leave the primary call to action rendering a raw code like "Reconnect provider".
export type NextActionCode =
  | "none" | "inspect_findings" | "request_autofix" | "retry_review" | "reconnect_provider"
  | "restore_installation" | "grant_permission" | "increase_budget" | "human_merge" | "start_new_review";

export const nextActionCodes: readonly NextActionCode[] = [
  "none", "inspect_findings", "request_autofix", "retry_review", "reconnect_provider",
  "restore_installation", "grant_permission", "increase_budget", "human_merge", "start_new_review",
];

type NextAction = { title: string; detail: string; href?: string; hrefLabel?: string };

const nextActions: Record<NextActionCode, NextAction> = {
  none: { title: "Decide whether to merge", detail: "The required checks produced evidence for this exact commit. You own the merge decision." },
  inspect_findings: { title: "Inspect the findings", detail: "Open each finding below, check the cited lines, then decide with the author what to change." },
  request_autofix: { title: "Consider a bounded fix", detail: "BuildIT can prepare a fix as a separate pull request for you to review. It never merges." },
  retry_review: { title: "Retry the review", detail: "This run ended without a code decision. Retry once at the same commit." },
  reconnect_provider: { title: "Reconnect your model provider", detail: "The saved key was rejected or revoked, so analysis could not run.", href: "/setup/model", hrefLabel: "Manage model keys" },
  restore_installation: { title: "Restore GitHub access", detail: "The GitHub App installation is suspended or removed, so BuildIT cannot read this repository.", href: "/repositories", hrefLabel: "Check repository access" },
  grant_permission: { title: "Grant the missing permission", detail: "BuildIT is missing a repository permission it needs for this action.", href: "/repositories", hrefLabel: "Review GitHub access" },
  increase_budget: { title: "Increase the review budget", detail: "No further model call was made. Choose a higher ceiling, then start a new review." },
  human_merge: { title: "Read it yourself before merging", detail: "BuildIT will not merge this and will not vouch for it. Check the change - and, if a fix was proposed, the separate pull request carrying it - and merge only if you agree." },
  start_new_review: { title: "Run a new review", detail: "This run ended without a decision." },
};

// The sample tour renders its own synthetic codes; they are not part of the live enum but are
// still shown to real people, so they need real guidance too.
const sampleTourActions: Record<string, NextAction> = {
  human_review: { title: "Inspect the evidence", detail: "You own the final merge decision." },
  fix_findings: { title: "Ask the author to fix the issues", detail: "Then run BuildIT again on the new commit." },
  await_human_approval: { title: "Inspect the proposed fix", detail: "BuildIT will never merge it for you." },
  wait: { title: "Wait for this review to finish", detail: "BuildIT is still gathering evidence for this exact commit." },
};

export function nextActionPresentation(code: string, stale: boolean): NextAction {
  if (stale) return { title: "Run a new review", detail: "The code changed after this review started." };
  return nextActions[code as NextActionCode] ?? sampleTourActions[code] ?? { title: words(code), detail: "Open the evidence below before taking action." };
}

export function stagePresentation(stage: string) {
  const known: Record<string, string> = {
    queue: "Queued",
    context: "Understanding the change",
    analysis: "Checking the code",
    validation: "Running checks",
    autofix: "Testing a proposed fix",
    delivery: "Preparing the handoff",
    complete: "Complete",
  };
  return known[stage] ?? words(stage);
}

export function eventPresentation(type: string) {
  const known: Record<string, string> = {
    review_created: "Review started",
    context_gathered: "Requirements and code gathered",
    analysis_completed: "Code analysis completed",
    validation_completed: "Checks completed",
    review_cancelled: "Review stopped",
    finding_recorded: "Issue recorded",
    autofix_round_completed: "Fix round completed",
    review_delivered: "Review handed back",
  };
  return known[type] ?? words(type);
}

// Every value of the severity, findingCategory and findingResolution unions in convex/validators.ts.
// A Record over the union makes a missing key a compile error, so a new category cannot silently
// fall through to technicalLabel below and print the database word at a person.
export type FindingSeverity = "critical" | "high" | "warning" | "info";
export type FindingCategory =
  | "correctness" | "security" | "requirement" | "architecture" | "quality" | "dependency" | "test";
export type FindingResolution = "open" | "accepted" | "dismissed" | "fixed" | "uncertain";

const severityLabels: Record<FindingSeverity, string> = {
  critical: "Critical",
  high: "High",
  warning: "Worth checking",
  info: "For information",
};

const categoryLabels: Record<FindingCategory, string> = {
  correctness: "Wrong behaviour",
  security: "Security",
  requirement: "Unmet requirement",
  architecture: "Design problem",
  quality: "Code quality",
  dependency: "Dependency",
  test: "Test coverage",
};

const resolutionLabels: Record<FindingResolution, string> = {
  open: "Open",
  accepted: "Confirmed on the second pass",
  dismissed: "Dismissed by your team",
  fixed: "Fixed",
  uncertain: "A person decides this one",
};

export const findingSeverityLabel = (value: string) => severityLabels[value as FindingSeverity] ?? words(value);
export const findingCategoryLabel = (value: string) => categoryLabels[value as FindingCategory] ?? words(value);
export const findingResolutionLabel = (value: string) => resolutionLabels[value as FindingResolution] ?? words(value);

export const lineRange = (startLine: number, endLine: number) =>
  startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`;

// reviews:compareRuns refuses two runs that are not two runs of one pull request, and it refuses
// by throwing a bare code. Convex wraps that message in a request id and a stack before it reaches
// the browser, so the code is matched inside the message rather than compared to it - and the
// message itself is never rendered.
const comparisonRefusals: Record<string, string> = {
  not_found_or_forbidden:
    "These two runs cannot be compared. BuildIT only compares runs of the same pull request, in a repository your account can read. Choose another run of this pull request.",
};

export function comparisonRefusal(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const known = Object.keys(comparisonRefusals).find(code => message.includes(code));
  return known
    ? comparisonRefusals[known]!
    : "This comparison could not be loaded, so nothing is shown above. Nothing about either review changed. Choose the run again in a moment.";
}

// Every value of the suppressionScope union in convex/validators.ts, in the order a person narrows
// a decision. The Record makes a missing key a compile error, so a new scope cannot reach a select
// as the database word. The labels say how far the decision is recorded as applying: BuildIT reads
// suppressions back per repository today, so none of them promises a narrower silence than that.
export type SuppressionScope = "commit" | "pull_request" | "path" | "repository";
export const suppressionScopes: readonly SuppressionScope[] = ["commit", "pull_request", "path", "repository"];
const suppressionScopeLabels: Record<SuppressionScope, string> = {
  commit: "This commit only",
  pull_request: "This pull request",
  path: "This file",
  repository: "Anywhere in this repository",
};
export const suppressionScopeLabel = (value: string) => suppressionScopeLabels[value as SuppressionScope] ?? words(value);

// findings:dismiss stores this on the suppression and hands it to the evaluation loop as the
// reason a finding was judged a false positive, so it is a code that a curator can count - not a
// free-text box. A box would also be the one place on this page where a person could paste a path
// or a line of code into a field the database classifies as metadata.
export type DismissalReason =
  | "not_a_defect" | "intended_behaviour" | "wrong_lines" | "already_handled" | "out_of_scope";
export const dismissalReasons: readonly DismissalReason[] = [
  "not_a_defect", "intended_behaviour", "wrong_lines", "already_handled", "out_of_scope",
];
const dismissalReasonLabels: Record<DismissalReason, string> = {
  not_a_defect: "This is not a defect",
  intended_behaviour: "The behaviour is deliberate here",
  wrong_lines: "The cited lines are not where this happens",
  already_handled: "Already handled somewhere else",
  out_of_scope: "Not something this repository treats as a problem",
};
export const dismissalReasonLabel = (value: string) => dismissalReasonLabels[value as DismissalReason] ?? words(value);

// findings:dismiss refuses with a bare code, wrapped by Convex in a request id and a stack before
// it reaches the browser. The code is matched inside the message rather than compared to it, and
// the message itself is never rendered. Each sentence ends by saying nothing was recorded, because
// after a refusal the question a person has is whether they half-dismissed something.
const dismissalRefusals: Record<string, string> = {
  not_found_or_forbidden:
    "This finding was not dismissed. Dismissing changes what a later review shows, so it needs developer access to this repository, and the finding has to belong to the review on screen. Nothing was recorded.",
  finding_fingerprint_invalid:
    "This finding was not dismissed, because the reference this page holds for it is not one BuildIT recognises. Reload the review and try again. Nothing was recorded.",
  finding_dismissal_reason_invalid:
    "This finding was not dismissed, because BuildIT could not record the reason given. Choose one of the reasons offered and try again. Nothing was recorded.",
};

export function dismissalRefusal(error: unknown): string {
  // A ConvexError carries its code in .data and repeats it in .message; a transport failure has
  // only a message. Both are searched so neither shape falls through to the generic sentence.
  const source = error as { data?: unknown; message?: unknown } | null;
  const text = [typeof source?.data === "string" ? source.data : "",
    typeof source?.message === "string" ? source.message : String(error ?? "")].join(" ");
  const known = Object.keys(dismissalRefusals).find(code => text.includes(code));
  return known
    ? dismissalRefusals[known]!
    : "This finding was not dismissed and nothing about the review changed. Check your connection and try again in a moment.";
}

// The plain-language details come from the encrypted analysis artifact and the rows come from the
// database, and nothing joins them: the row keeps a keyed HMAC of the path, which a browser cannot
// compute from the path the artifact carries. What both sides copy from the same arbitrated finding
// without changing it is its category, severity, blocking flag and line range, so that is the join.
// Where one key describes more than one finding on either side - two files can hold the same kind
// of defect on the same lines - the pairing is refused rather than guessed, because prose attached
// to the wrong finding would name the wrong file to the person deciding whether to merge.
export type FindingKeyParts = { category: string; severity: string; blocking: boolean; startLine: number; endLine: number };
const findingKey = (item: FindingKeyParts) =>
  [item.category, item.severity, item.blocking, item.startLine, item.endLine].join(" ");

export function pairFindingDetails<Detail extends FindingKeyParts>(
  rows: ReadonlyArray<FindingKeyParts & { id: string }>,
  details: readonly Detail[],
): Map<string, Detail> {
  const count = (items: ReadonlyArray<FindingKeyParts>) => {
    const seen = new Map<string, number>();
    for (const item of items) seen.set(findingKey(item), (seen.get(findingKey(item)) ?? 0) + 1);
    return seen;
  };
  const rowCounts = count(rows), detailCounts = count(details);
  const detailByKey = new Map(details.map(detail => [findingKey(detail), detail]));
  const paired = new Map<string, Detail>();
  for (const row of rows) {
    const key = findingKey(row), detail = detailByKey.get(key);
    if (detail && rowCounts.get(key) === 1 && detailCounts.get(key) === 1) paired.set(row.id, detail);
  }
  return paired;
}

// A review can run the same named check against more than one immutable worktree.
// The audit store keeps every execution; the main result groups them so people do
// not mistake repeated evidence for separate checks.
export function summarizeChecks(checks: CheckExecution[]): CheckSummary[] {
  const grouped = new Map<string, CheckExecution[]>();
  for (const check of checks) {
    const key = `${check.kind}\u0000${check.required}`;
    grouped.set(key, [...(grouped.get(key) ?? []), check]);
  }
  return [...grouped.values()].map((executions) => {
    const first = executions[0]!;
    const counts = new Map<string, number>();
    for (const execution of executions) counts.set(execution.conclusion, (counts.get(execution.conclusion) ?? 0) + 1);
    const outcomeSummary = [...counts.entries()]
      .map(([outcome, count]) => `${count} ${outcome}`)
      .join(", ");
    return {
      kind: first.kind,
      required: first.required,
      conclusion: counts.size === 1 ? first.conclusion : "mixed",
      durationMs: executions.reduce((total, execution) => total + execution.durationMs, 0),
      evidenceAvailable: executions.every((execution) => execution.evidenceAvailable),
      executions: executions.length,
      outcomeSummary,
    };
  });
}

export const technicalLabel = words;

export function pullRequestHref(owner: string, name: string, prNumber: number) {
  if (!owner || !name || !Number.isSafeInteger(prNumber) || prNumber < 1) return undefined;
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pull/${prNumber}`;
}

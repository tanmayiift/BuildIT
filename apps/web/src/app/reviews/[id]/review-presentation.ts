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

export function nextActionPresentation(code: string, stale: boolean) {
  if (stale) return { title: "Run a new review", detail: "The code changed after this review started." };
  const known: Record<string, { title: string; detail: string }> = {
    start_new_review: { title: "Run a new review", detail: "This run ended without a decision." },
    human_review: { title: "Inspect the evidence", detail: "You own the final merge decision." },
    fix_findings: { title: "Ask the author to fix the issues", detail: "Then run BuildIT again on the new commit." },
    await_human_approval: { title: "Inspect the proposed fix", detail: "BuildIT will never merge it for you." },
    retry: { title: "Retry the review", detail: "The previous run ended because of a service problem." },
    increase_budget: { title: "Increase the review budget", detail: "No further model call was made. Choose a higher ceiling, then start a new review." },
  };
  return known[code] ?? { title: words(code), detail: "Open the evidence below before taking action." };
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

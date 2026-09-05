export type QueueReview = {
  id: string;
  repositoryId: string;
  prNumber: number;
  headSha: string;
  status: string;
  statusReasonCode?: string;
  isStale: boolean;
  coverageLevel: string;
  currentStage: string;
  nextActionCode: string;
  updatedAt: number;
};

export type QueueReviewGroup = {
  review: QueueReview;
  attemptCount: number;
  failedAttemptCount: number;
  latestAttempt: QueueReview;
};

function pullCommitKey(review: QueueReview) {
  return `${review.repositoryId}:${review.prNumber}:${review.headSha}`;
}

export function groupQueueReviews(reviews: QueueReview[]): QueueReviewGroup[] {
  const groups = new Map<string, QueueReviewGroup>();
  for (const review of reviews) {
    const key = pullCommitKey(review);
    const existing = groups.get(key);
    if (existing) {
      existing.attemptCount += 1;
      if (review.status === "platform_failed") existing.failedAttemptCount += 1;
      if (review.updatedAt > existing.latestAttempt.updatedAt) existing.latestAttempt = review;
      continue;
    }
    groups.set(key, {
      review,
      attemptCount: 1,
      failedAttemptCount: review.status === "platform_failed" ? 1 : 0,
      latestAttempt: review,
    });
  }
  for (const group of groups.values()) {
    const matching = reviews.filter(review => pullCommitKey(review) === pullCommitKey(group.review));
    const latestActive = matching.filter(review => active.has(review.status)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const latestDecision = matching.filter(review => !active.has(review.status) && !retry.has(review.status)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    group.review = latestActive ?? latestDecision ?? group.latestAttempt;
  }
  return [...groups.values()].sort((a, b) => b.latestAttempt.updatedAt - a.latestAttempt.updatedAt);
}

const active = new Set([
  "queued", "gathering_context", "analyzing", "validating", "autofix_queued",
  "autofixing", "validating_round", "validating_final", "cancelling",
]);
const retry = new Set(["inconclusive", "blocked", "cancelled", "budget_exhausted", "platform_failed"]);

export type QueueSection = "running" | "decision" | "retry";
export function queueSection(review: QueueReview): QueueSection {
  if (active.has(review.status)) return "running";
  if (retry.has(review.status)) return "retry";
  return "decision";
}

const statusLabels: Record<string, string> = {
  queued: "Queued",
  gathering_context: "Reading context",
  analyzing: "Reviewing code",
  validating: "Running checks",
  checks_passed: "Checks passed",
  changes_requested: "Changes needed",
  inconclusive: "Review incomplete",
  autofix_queued: "Fix queued",
  autofixing: "Preparing fix",
  validating_round: "Testing fix",
  validating_final: "Final checks",
  delivered: "Fix ready",
  failed_after_bounds: "Human review needed",
  blocked: "Setup needed",
  cancelling: "Stopping",
  cancelled: "Stopped",
  budget_exhausted: "Budget reached",
  platform_failed: "Review didn't run",
};

const reasonLabels: Record<string, string> = {
  checks_complete: "Required checks finished at this exact commit.",
  blocking_findings: "Evidence-backed findings need a human decision.",
  required_check_failed: "At least one required check failed.",
  required_check_missing: "A required check did not produce complete evidence.",
  unsupported_check: "The repository asks for a check BuildIT cannot run yet.",
  environment_unavailable: "The isolated runner was unavailable. No code decision was made.",
  review_timeout: "The review reached its time limit. No code decision was made.",
  final_validation_incomplete: "The fix candidate did not complete final validation.",
  human_review_required: "The critic could not resolve a finding after two passes, so a person decides this one.",
  stale_commit: "The commit moved while this review was running, so nothing it found is about the code that is there now.",
  prompt_injection_unscoped: "BuildIT found instruction-like text it could not attribute to a changed file, so it will not claim it reviewed the code rather than the instructions. Read the diff yourself before merging.",
  incomplete_coverage: "BuildIT could not read enough of the change to stand behind a verdict.",
  provider_credential_invalid: "Reconnect the selected model provider before retrying.",
  installation_suspended: "Restore the GitHub App installation before retrying.",
  permission_revoked: "Restore repository permission before retrying.",
  user_cancelled: "A person stopped this run before it reached a decision.",
  blocked_expired: "The blocked review expired before access was restored.",
  spend_ceiling_reached: "The review stopped before exceeding its approved model budget.",
  concurrency_limit_reached: "Your workspace already has as many reviews running as its limit allows. This one starts when an earlier review finishes.",
  superseded_by_new_commit: "A newer commit replaced the one this review was pinned to. Start a review at the current commit.",
  provider_rate_limited: "The model provider was rate-limited. No code decision was made.",
  platform_error: "BuildIT stopped before it could make a code decision.",
  delivery_complete: "The tested candidate is ready for human inspection.",
};

export function queueStatusLabel(review: QueueReview) {
  return statusLabels[review.status] ?? "Review update";
}

export function queueStatusDetail(review: QueueReview) {
  if (review.isStale) return "The pull request changed. Start a review at the latest commit.";
  return review.statusReasonCode ? reasonLabels[review.statusReasonCode] ?? "Open the result for details." : "Open the result for details.";
}

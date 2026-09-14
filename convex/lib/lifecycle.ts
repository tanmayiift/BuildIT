import { EXECUTION_JOB_DEADLINE_MS, EXECUTION_MAX_ATTEMPTS } from "@buildit/contracts";

export const terminalStatuses = new Set([
  "checks_passed", "changes_requested", "inconclusive", "delivered",
  "failed_after_bounds", "cancelled", "budget_exhausted", "platform_failed",
]);
export const activeStatuses = [
  "queued", "gathering_context", "analyzing", "validating", "autofix_queued",
  "autofixing", "validating_round", "validating_final", "cancelling", "blocked",
] as const;

const interruptible = new Set([
  "queued", "gathering_context", "analyzing", "validating", "autofix_queued",
  "autofixing", "validating_round", "validating_final",
]);
const next: Record<string, readonly string[]> = {
  queued: ["gathering_context"], gathering_context: ["analyzing"], analyzing: ["validating"],
  validating: ["checks_passed", "changes_requested", "inconclusive"],
  autofix_queued: ["autofixing"], autofixing: ["validating_round", "failed_after_bounds"],
  validating_round: ["autofixing", "validating_final", "failed_after_bounds"],
  validating_final: ["delivered", "inconclusive"], cancelling: ["cancelled"],
};
export function transitionAllowed(from: string, to: string, resume?: string): boolean {
  if (terminalStatuses.has(from)) return false;
  if (from === "blocked") return resume === to && interruptible.has(to);
  return Boolean(next[from]?.includes(to)) || (interruptible.has(from) && ["blocked", "cancelling", "budget_exhausted", "platform_failed"].includes(to));
}

// A cancelled review still owns the in_progress "BuildIT / review" check run that went up when it
// started, and GitHub leaves that run spinning until something completes it. A workspace that made
// the check required could then never merge the pull request - BuildIT itself blocked the merge,
// and no action in the product cleared it, because the sweeper only walks active statuses and
// `cancelled` is terminal. Every writer that ends a review by cancellation renders its notice from
// here so the three of them cannot say three different things.
export function cancellationNotice(input: { headSha: string; reasonCode?: string }) {
  const body = input.reasonCode === "superseded_by_new_commit"
    ? ["A newer commit replaced the one this review was reading, so BuildIT stopped it.",
      "No code decision was reached and no code was changed. The review of the new commit answers on its own check."]
    : input.reasonCode === "blocked_expired"
      ? ["This review waited for capacity beyond the allowed time and was stopped.",
        "No code decision was reached. Usage shows any recorded model spend from earlier work.",
        "Comment `@buildit review` to start a new one."]
      : ["This review was cancelled before it finished.",
        "No code decision was reached and no code was changed.",
        "Comment `@buildit review` to start a new one."];
  return {
    title: input.reasonCode === "superseded_by_new_commit"
      ? "BuildIT: superseded by a newer commit"
      : input.reasonCode === "blocked_expired"
        ? "BuildIT: review expired while waiting for capacity"
        : "BuildIT: review cancelled",
    summary: [
      `Head: \`${input.headSha.toLowerCase()}\``,
      "",
      ...body.flatMap(line => [line, ""]),
      "BuildIT did not merge this pull request.",
    ].join("\n"),
  };
}

// The retention a review actually gets, from the number the organization was told. Capped at the
// 7-day ceiling the permission receipt states, and defaulting to it when the row is unreadable, so
// a missing value can never extend retention past what was promised.
export const maximumRetentionHours = 168;
export function retentionMs(retentionHours: number | undefined) {
  return Math.min(maximumRetentionHours, retentionHours && retentionHours > 0 ? retentionHours : maximumRetentionHours) * 3_600_000;
}

// executionJobs was swept by nobody. The by_lease index existed with no reader, so a job whose
// worker died between two segments kept its row `running` for ever, and kept the paid sandbox that
// worker had opened. claimExecutionJob now refuses past the attempt cap and past the deadline, but
// refusing to re-drive a job is not the same as declaring it dead: the row stays non-terminal, the
// review it belongs to stays "In progress" to the person waiting on it, and the sandbox keeps
// billing. These are the three ways a job is dead, and the code each one writes.
export const executionReapReasons = {
  reviewGone: "reaped_review_unreachable",
  deadline: "reaped_job_deadline",
  attempts: "reaped_attempts_exhausted",
} as const;
export type ExecutionReapReason = (typeof executionReapReasons)[keyof typeof executionReapReasons];
// executionJobsData.claim reads this. A reaped job must not be re-claimed, and the lease cannot be
// what stops it: the sweeper deliberately leaves the dead lease in place rather than releasing it,
// and an expired lease is an invitation to claim, not a bar to it.
export const reapedExecutionFailureCodes: ReadonlySet<string> = new Set(Object.values(executionReapReasons));

// Whether the review a job was opened for is still the thing that job is executing. Mirrors the
// staleness test executionJobsData.create refuses on, because a job outliving its own scope - the
// review cancelled, superseded by a newer commit, or already finished some other way - is the
// commonest way one is abandoned, and it is invisible from the job row alone.
export function executionReviewLive(
  review: { status: string; headSha: string; executionGeneration: number; isStale: boolean } | null,
  job: { expectedHeadSha: string; expectedGeneration: number },
) {
  if (!review || terminalStatuses.has(review.status)) return false;
  return review.headSha === job.expectedHeadSha && review.executionGeneration === job.expectedGeneration && !review.isStale;
}

export function executionReapReason(input: {
  attempt: number; createdAt: number; leaseUntil?: number; reviewLive: boolean; now: number;
}): ExecutionReapReason | null {
  // Deadline first and unconditionally, because it is the only rule that does not depend on how
  // the job has been behaving. A job that keeps re-claiming inside its attempt budget, against a
  // review that still looks live, is exactly the case the other two rules cannot see.
  if (input.now - input.createdAt > EXECUTION_JOB_DEADLINE_MS) return executionReapReasons.deadline;
  if (input.attempt >= EXECUTION_MAX_ATTEMPTS) return executionReapReasons.attempts;
  // Only once the lease has lapsed. A worker still inside its lease may be mid-segment against a
  // review that was cancelled a second ago; it will find that out at its next checkpoint, and
  // killing the row underneath it would race that write for no gain - the lease is at most 285s.
  if ((input.leaseUntil ?? 0) <= input.now && !input.reviewLive) return executionReapReasons.reviewGone;
  return null;
}

// Five broker calls to stop one sandbox. Past that the sandbox is either already gone or the
// broker cannot reach the provider at all, and re-sending the same job key every ten minutes for
// ever costs more than the sandbox does. A row that exhausts this keeps its attempt count as the
// evidence that something is still being paid for that BuildIT could not prove it stopped.
export const sandboxReclaimMaxAttempts = 5;

// GitHub keeps its delivery log for 30 days and lets a person replay a delivery inside that
// window. All four webhookDeliveries reads are point lookups on deliveryId - the check that stops
// a replay starting a second review of the same event - so deleting a row sooner than GitHub can
// resend it would make a replay read as new. 30 days is therefore the floor, not a preference.
export const webhookDeliveryRetentionMs = 30 * 86_400_000;

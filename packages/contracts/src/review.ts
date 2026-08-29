import { z } from "zod";

export const reviewStatus = z.enum([
  "queued", "gathering_context", "analyzing", "validating",
  "checks_passed", "changes_requested", "inconclusive", "autofix_queued",
  "autofixing", "validating_round", "validating_final", "delivered",
  "failed_after_bounds", "blocked", "cancelling", "cancelled",
  "budget_exhausted", "platform_failed",
]);
export type ReviewStatus = z.infer<typeof reviewStatus>;

export const activeStatuses = new Set<ReviewStatus>([
  "queued", "gathering_context", "analyzing", "validating", "autofix_queued",
  "autofixing", "validating_round", "validating_final", "blocked", "cancelling",
]);
export const terminalStatuses = new Set<ReviewStatus>([
  "checks_passed", "changes_requested", "inconclusive", "delivered",
  "failed_after_bounds", "cancelled", "budget_exhausted", "platform_failed",
]);

export const reviewMode = z.enum(["review", "autofix"]);
export type ReviewMode = z.infer<typeof reviewMode>;
export const terminationBound = z.enum([
  "round_limit", "attempt_limit", "wall_clock_limit", "repeated_patch",
]);
export type TerminationBound = z.infer<typeof terminationBound>;
export const statusReasonCode = z.enum([
  "checks_complete", "blocking_findings", "required_check_missing",
  "unsupported_check", "environment_unavailable", "review_timeout",
  "final_validation_incomplete", "provider_credential_invalid",
  "installation_suspended", "permission_revoked", "user_cancelled",
  "blocked_expired", "spend_ceiling_reached", "platform_error", "delivery_complete",
]);
export type StatusReasonCode = z.infer<typeof statusReasonCode>;
export const nextActionCode = z.enum([
  "none", "inspect_findings", "request_autofix", "retry_review",
  "reconnect_provider", "restore_installation", "grant_permission",
  "increase_budget", "human_merge", "start_new_review",
]);
export const checkOutcome = z.enum([
  "passed", "failed", "not_run", "timed_out", "truncated", "flaky",
]);

const normalTransitions: Record<ReviewStatus, readonly ReviewStatus[]> = {
  queued: ["gathering_context"], gathering_context: ["analyzing"],
  analyzing: ["validating"],
  validating: ["checks_passed", "changes_requested", "inconclusive"],
  checks_passed: [], changes_requested: [], inconclusive: [],
  autofix_queued: ["autofixing"],
  autofixing: ["validating_round", "failed_after_bounds"],
  validating_round: ["autofixing", "validating_final", "failed_after_bounds"],
  validating_final: ["delivered", "inconclusive"], delivered: [],
  failed_after_bounds: [], blocked: [], cancelling: ["cancelled"], cancelled: [],
  budget_exhausted: [], platform_failed: [],
};
const interruptibleStatuses = new Set<ReviewStatus>([
  "queued", "gathering_context", "analyzing", "validating", "autofix_queued",
  "autofixing", "validating_round", "validating_final",
]);

export function canTransition(from: ReviewStatus, to: ReviewStatus, blockedResumeStatus?: ReviewStatus): boolean {
  if (terminalStatuses.has(from)) return false;
  if (from === "blocked") return blockedResumeStatus === to && interruptibleStatuses.has(to);
  if (normalTransitions[from].includes(to)) return true;
  return interruptibleStatuses.has(from) && ["blocked", "cancelling", "budget_exhausted", "platform_failed"].includes(to);
}
export function assertTransition(from: ReviewStatus, to: ReviewStatus, blockedResumeStatus?: ReviewStatus): void {
  if (!canTransition(from, to, blockedResumeStatus)) throw new Error(`invalid_review_transition:${from}:${to}`);
}

export const reviewRecord = z.object({
  id: z.string().min(1), organizationId: z.string().min(1), repositoryId: z.string().min(1),
  prNumber: z.number().int().positive(), mode: reviewMode,
  headSha: z.string().regex(/^[0-9a-f]{40}$/), status: reviewStatus,
  statusReasonCode: statusReasonCode.optional(), nextActionCode,
  isStale: z.boolean(), staleSince: z.number().optional(),
  observedHeadSha: z.string().regex(/^[0-9a-f]{40}$/).optional(),
  terminationBound: terminationBound.optional(), budgetCeilingId: z.string().min(1).optional(),
  budgetLimit: z.number().nonnegative(), budgetConsumed: z.number().nonnegative(),
  completedRoundCount: z.number().int().min(0).max(3),
  patchAttemptCount: z.number().int().min(0).max(6),
  diagnosticRunCount: z.number().int().nonnegative(),
  providerRetryCount: z.number().int().nonnegative(), commandRetryCount: z.number().int().nonnegative(),
  blockedResumeStatus: reviewStatus.optional(), blockedSince: z.number().optional(),
  blockedExpiresAt: z.number().optional(), completedAt: z.number().optional(),
}).superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (value.mode === "review" && value.completedRoundCount !== 0) issue("review mode cannot have Autofix rounds");
  if (value.patchAttemptCount < value.completedRoundCount) issue("patch attempts cannot be fewer than completed rounds");
  if (value.isStale !== Boolean(value.staleSince && value.observedHeadSha)) issue("stale state requires staleSince and observedHeadSha, and current state forbids them");
  if (value.status === "failed_after_bounds" && !value.terminationBound) issue("failed_after_bounds requires terminationBound");
  if (value.status !== "failed_after_bounds" && value.terminationBound) issue("terminationBound is valid only for failed_after_bounds");
  if (value.status === "budget_exhausted") {
    if (!value.budgetCeilingId) issue("budget_exhausted requires budgetCeilingId");
    if (value.budgetConsumed < value.budgetLimit) issue("budget_exhausted requires consumption at or above its limit");
  } else if (value.budgetCeilingId) issue("budgetCeilingId is valid only for budget_exhausted");
  if (["inconclusive", "blocked", "cancelled", "platform_failed"].includes(value.status) && !value.statusReasonCode) issue(`${value.status} requires statusReasonCode`);
  if (value.status === "blocked") {
    if (!value.blockedResumeStatus || !value.blockedSince || !value.blockedExpiresAt) issue("blocked requires resume status and TTL timestamps");
    if (value.blockedExpiresAt && value.blockedSince && value.blockedExpiresAt <= value.blockedSince) issue("blocked expiry must be after blocked start");
  } else if (value.blockedResumeStatus || value.blockedSince || value.blockedExpiresAt) issue("blocked fields are valid only while blocked");
  if (terminalStatuses.has(value.status) !== Boolean(value.completedAt)) issue("terminal state requires completedAt and active state forbids it");
});

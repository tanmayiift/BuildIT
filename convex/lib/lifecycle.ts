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
      ? ["This review waited for a free slot longer than BuildIT holds one, so it never started.",
        "No code decision was reached and nothing was charged.",
        "Comment `@buildit review` to start a new one."]
      : ["This review was cancelled before it finished.",
        "No code decision was reached and no code was changed.",
        "Comment `@buildit review` to start a new one."];
  return {
    title: input.reasonCode === "superseded_by_new_commit"
      ? "BuildIT: superseded by a newer commit"
      : input.reasonCode === "blocked_expired"
        ? "BuildIT: review expired before it could start"
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

// GitHub keeps its delivery log for 30 days and lets a person replay a delivery inside that
// window. All four webhookDeliveries reads are point lookups on deliveryId - the check that stops
// a replay starting a second review of the same event - so deleting a row sooner than GitHub can
// resend it would make a replay read as new. 30 days is therefore the floor, not a preference.
export const webhookDeliveryRetentionMs = 30 * 86_400_000;

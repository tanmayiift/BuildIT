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

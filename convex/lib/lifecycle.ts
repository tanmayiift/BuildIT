export const terminalStatuses = new Set([
  "checks_passed", "changes_requested", "inconclusive", "delivered",
  "failed_after_bounds", "cancelled", "budget_exhausted", "platform_failed",
]);
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

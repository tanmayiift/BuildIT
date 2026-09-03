import type { PlatformFailureReason } from "./platformFailureReport";

// When a provider is the reason a review died, another connected key can answer instead. A clean
// restart rather than a mid-chain switch: one verdict stays attributable to one model, and the
// report can name which provider produced it.
//
// Only failures that are about the provider qualify. A repository too large or a diff that will not
// fit is going to fail the same way on any model, and retrying it elsewhere spends a second
// review's money to reach the same answer.
const providerFailures = new Set<PlatformFailureReason>(["provider_rate_limited", "model_unavailable"]);

export function fallbackWorthTrying(input: {
  reason: PlatformFailureReason;
  /** Providers with a valid credential in this workspace, excluding the one that just failed. */
  alternatives: readonly string[];
  /** Set when this review is itself already a fallback, which stops a chain of them. */
  parentReviewId?: unknown;
}) {
  if (input.parentReviewId) return undefined;
  if (!providerFailures.has(input.reason)) return undefined;
  // Deterministic, so a retried review picks the same alternative rather than a different one
  // each time and makes the failure impossible to reproduce.
  return [...input.alternatives].sort()[0];
}

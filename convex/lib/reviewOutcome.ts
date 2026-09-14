// What counts as a successful review, in one place, because it was answered differently in three.
//
// activation.ts counted `inconclusive` as a completed review. publicProof.ts excluded it from
// "decisive verdicts". Both numbers were published. And activation.ts disagreed with itself:
// completedEvidenceStatuses carried `failed_after_bounds` while the funnel's `completed` count did
// not. So "how many reviews succeeded" had three answers depending on which screen you read, and
// the north star the product is steered by is exactly that question.
//
// The fix is not to collapse them into one number. They measure different things and both are
// worth having:
//
//   decisive   - BuildIT reached a judgement the author can act on. This is the north-star
//                numerator: a review that says "inconclusive" consumed a model call and told
//                nobody anything about their code.
//   concluded  - the review stopped and reported something, verdict or not. This is the funnel's
//                question: did a person who set BuildIT up ever see a result come back?
//
// An inconclusive review is concluded and not decisive, and that is the whole distinction. Naming
// them differently is what stops the next reader assuming either one is "success".

import type { ReviewStatus } from "@buildit/contracts";

/** Reached a judgement about the code. The north-star numerator. */
export const decisiveStatuses: ReadonlySet<string> = new Set<ReviewStatus | string>([
  "checks_passed",
  "changes_requested",
  "delivered",
]);

/**
 * Stopped and reported something, whether or not it judged the code. Superset of `decisive`:
 * adds the outcomes where BuildIT finished but had nothing to say about the change.
 */
export const concludedStatuses: ReadonlySet<string> = new Set<ReviewStatus | string>([
  ...decisiveStatuses,
  "inconclusive",
  "failed_after_bounds",
]);

/**
 * Stopped without reporting anything the author asked for. Not the inverse of `concluded` - a
 * review still running is neither - so both are counted explicitly rather than by subtraction.
 */
export const abandonedStatuses: ReadonlySet<string> = new Set<ReviewStatus | string>([
  "budget_exhausted",
  "platform_failed",
  "cancelled",
]);

export function isDecisive(status: string) {
  return decisiveStatuses.has(status);
}

export function isConcluded(status: string) {
  return concludedStatuses.has(status);
}

export function isAbandoned(status: string) {
  return abandonedStatuses.has(status);
}

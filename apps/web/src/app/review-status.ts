// One name per review status, for every page that shows one.
//
// There were five vocabularies for the same eighteen-value enum - the queue, the review detail,
// /history, /proof, and a fifth inside the detail page's presentation - and seventeen of the eighteen
// statuses had conflicting labels across them. platform_failed alone had four names: "Review didn't
// run", "Platform failure", "Did not finish" and "Could not complete". A reader moving from the queue
// to the review to the proof page saw the same review described three different ways, on a product
// whose argument is that it says exactly what it means.
//
// The Record type makes a missing status a compile error, and review-status.test.ts checks this map
// against the union in convex/validators.ts, so a status added there cannot ship unnamed here.
export type ReviewStatus =
  | "queued" | "gathering_context" | "analyzing" | "validating"
  | "checks_passed" | "changes_requested" | "inconclusive"
  | "autofix_queued" | "autofixing" | "validating_round" | "validating_final" | "delivered"
  | "failed_after_bounds" | "blocked" | "cancelling" | "cancelled" | "budget_exhausted" | "platform_failed";

// Chosen once, deliberately. Each label says what happened in plain words and, where something went
// wrong, whose fault it was.
//   - checks_passed is "Checks passed", not "Ready for you": BuildIT never decides a merge, and a label
//     implying readiness is the one claim this product refuses to make.
//   - changes_requested matches GitHub's own term, which every reader of a pull request already knows.
//   - inconclusive is named plainly because it is a first-class verdict here, not a softened failure.
//   - platform_failed is "BuildIT failed", because the fault is BuildIT's and /proof says so - a
//     neutral "Did not finish" would hide exactly the thing that page exists to admit.
//   - blocked says what the reader has to do, which "Blocked" alone does not.
export const reviewStatusLabels: Record<ReviewStatus, string> = {
  queued: "Queued",
  gathering_context: "Reading context",
  analyzing: "Reviewing code",
  validating: "Running checks",
  checks_passed: "Checks passed",
  changes_requested: "Changes requested",
  inconclusive: "Inconclusive",
  autofix_queued: "Fix queued",
  autofixing: "Preparing fix",
  validating_round: "Testing fix",
  validating_final: "Final checks",
  delivered: "Fix delivered",
  failed_after_bounds: "Needs a developer",
  blocked: "Setup needed",
  cancelling: "Stopping",
  cancelled: "Stopped",
  budget_exhausted: "Budget reached",
  platform_failed: "BuildIT failed",
};

export const reviewStatuses = Object.keys(reviewStatusLabels) as ReviewStatus[];

/** Whether a value is a real review status, as opposed to a sample-tour state ("running",
 *  "passed") or a status the server added before this build learned it. */
export function isReviewStatus(value: string): value is ReviewStatus {
  return Object.prototype.hasOwnProperty.call(reviewStatusLabels, value);
}

/** The one label for a review status. An unknown value is described, never printed raw. */
export function reviewStatusLabel(status: string) {
  return (reviewStatusLabels as Record<string, string>)[status] ?? "Status unavailable";
}

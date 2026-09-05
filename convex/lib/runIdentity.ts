// One execution of a review had no name. It was the tuple (reviewId, headSha, executionGeneration),
// passed separately into every worker and fence-checked in about thirty places, and exposed
// nowhere: publicReview and getEvidence both omit executionGeneration entirely. So an operator
// asking "show me what happened on that run" had no identifier to ask with, and a review that was
// retried three times presented as one indistinguishable smear of rows.
//
// runId names it. It is derived rather than stored, so it cannot drift from the tuple it stands
// for, and it sorts stably because the generation is zero-padded.
//
// This is also the fix for the reviewEvents collision: sequence numbers carry no generation, so a
// re-run writes sequence 2 over the first run's sequence 2 and checkpoint throws
// checkpoint_conflict (durableReview.ts). Rows that carry runId can tell the attempts apart.

export function runIdFor(reviewId: string, executionGeneration: number): string {
  if (!reviewId) throw new Error("run_id_review_required");
  if (!Number.isInteger(executionGeneration) || executionGeneration < 0 || executionGeneration > 9_999) {
    throw new Error("run_id_generation_invalid");
  }
  return `${reviewId}:${String(executionGeneration).padStart(4, "0")}`;
}

export function parseRunId(runId: string): { reviewId: string; executionGeneration: number } {
  const match = /^([^:]+):(\d{4})$/.exec(runId);
  if (!match?.[1] || !match[2]) throw new Error("run_id_malformed");
  return { reviewId: match[1], executionGeneration: Number(match[2]) };
}

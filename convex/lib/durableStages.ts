export const durableReviewStages = ["context", "analysis", "validation"] as const;
export type DurableReviewStage = (typeof durableReviewStages)[number];

export function nextStageAfter(completed: readonly DurableReviewStage[]): DurableReviewStage | undefined {
  const completedSet = new Set(completed);
  return durableReviewStages.find((stage) => !completedSet.has(stage));
}

export type QueueReview = {
  id: string;
  repositoryId: string;
  prNumber: number;
  headSha: string;
  status: string;
  statusReasonCode?: string;
  isStale: boolean;
  coverageLevel: string;
  currentStage: string;
  nextActionCode: string;
  updatedAt: number;
};

export type QueueReviewGroup = { review: QueueReview; matchingAttemptCount: number };

function retryKey(review: QueueReview) {
  return `${review.repositoryId}:${review.prNumber}:${review.headSha}:${review.status}:${review.statusReasonCode}`;
}

export function groupQueueReviews(reviews: QueueReview[]): QueueReviewGroup[] {
  const groups = new Map<string, QueueReviewGroup>();
  for (const review of reviews) {
    const canGroup = review.status === "platform_failed" && review.statusReasonCode === "provider_rate_limited";
    const key = canGroup ? retryKey(review) : review.id;
    const existing = groups.get(key);
    if (existing) {
      existing.matchingAttemptCount += 1;
      continue;
    }
    groups.set(key, { review, matchingAttemptCount: 1 });
  }
  return [...groups.values()];
}

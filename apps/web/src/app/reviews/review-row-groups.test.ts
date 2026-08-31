import { describe, expect, it } from "vitest";
import { groupQueueReviews, type QueueReview } from "./review-row-groups.js";

const retry = (id: string, updatedAt: number): QueueReview => ({ id, repositoryId: "repo-a", prNumber: 2, headSha: "a".repeat(40), status: "platform_failed", statusReasonCode: "provider_rate_limited", isStale: false, coverageLevel: "full", currentStage: "complete", nextActionCode: "retry_review", updatedAt });

describe("review queue grouping", () => {
  it("groups only identical provider-limit retries and keeps the newest sorted row", () => {
    const newest = retry("newest", 3), grouped = groupQueueReviews([newest, retry("older", 2), retry("oldest", 1)]);
    expect(grouped).toEqual([{ review: newest, matchingAttemptCount: 3 }]);
  });

  it("never hides a distinct terminal state, reason, or exact head", () => {
    const first = retry("first", 3), differentReason = { ...retry("second", 2), statusReasonCode: "platform_error" }, differentHead = { ...retry("third", 1), headSha: "b".repeat(40) };
    expect(groupQueueReviews([first, differentReason, differentHead])).toHaveLength(3);
  });
});

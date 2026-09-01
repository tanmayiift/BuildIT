import { describe, expect, it } from "vitest";
import { groupQueueReviews, queueSection, queueStatusDetail, queueStatusLabel, type QueueReview } from "./review-row-groups.js";

const retry = (id: string, updatedAt: number): QueueReview => ({ id, repositoryId: "repo-a", prNumber: 2, headSha: "a".repeat(40), status: "platform_failed", statusReasonCode: "provider_rate_limited", isStale: false, coverageLevel: "full", currentStage: "complete", nextActionCode: "retry_review", updatedAt });

describe("review queue presentation", () => {
  it("shows one latest result per pull request and exact commit", () => {
    const newest = { ...retry("newest", 3), status: "changes_requested", statusReasonCode: "required_check_failed" }, grouped = groupQueueReviews([retry("older", 2), newest, retry("oldest", 1)]);
    expect(grouped).toEqual([{ review: newest, latestAttempt: newest, attemptCount: 3, failedAttemptCount: 2 }]);
  });

  it("keeps different commits separate and sorts their latest results", () => {
    const oldHead = retry("old-head", 2), newHead = { ...retry("new-head", 4), headSha: "b".repeat(40) };
    expect(groupQueueReviews([oldHead, newHead]).map(group => group.review.id)).toEqual(["new-head", "old-head"]);
  });

  it("separates code decisions from service retries in plain language", () => {
    const failure = retry("failure", 1), decision = { ...retry("decision", 2), status: "changes_requested", statusReasonCode: "required_check_failed" };
    expect(queueSection(failure)).toBe("retry");
    expect(queueStatusLabel(failure)).toBe("Review didn't run");
    expect(queueStatusDetail(failure)).toContain("No code decision was made");
    expect(queueSection(decision)).toBe("decision");
    expect(queueStatusLabel(decision)).toBe("Changes needed");
    expect(queueStatusDetail(decision)).toBe("At least one required check failed.");
  });

  it("does not let a later retry failure hide a real code decision", () => {
    const decision = { ...retry("decision", 2), status: "changes_requested", statusReasonCode: "required_check_failed" }, laterFailure = retry("later-failure", 3);
    const [group] = groupQueueReviews([decision, laterFailure]);
    expect(group).toMatchObject({ review: decision, latestAttempt: laterFailure, attemptCount: 2 });
    expect(queueSection(group!.review)).toBe("decision");
  });

  it("shows a running retry over an older decision", () => {
    const decision = { ...retry("decision", 2), status: "changes_requested", statusReasonCode: "required_check_failed" }, running = { ...retry("running", 3), status: "analyzing" };
    const [group] = groupQueueReviews([decision, running]);
    expect(group).toMatchObject({ review: running, latestAttempt: running });
    expect(queueSection(group!.review)).toBe("running");
  });
});

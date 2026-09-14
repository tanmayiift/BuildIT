import { EXECUTION_JOB_DEADLINE_MS, EXECUTION_MAX_ATTEMPTS } from "@buildit/contracts";
import { describe, expect, it } from "vitest";
import { cancellationNotice, executionReapReason, executionReviewLive } from "./lifecycle";

describe("cancellation receipts do not invent billing evidence", () => {
  it("does not promise an expired blocked review had never started or spent", () => {
    const notice = cancellationNotice({ headSha: "a".repeat(40), reasonCode: "blocked_expired" });
    expect(notice.summary).not.toContain("never started");
    expect(notice.summary).not.toContain("nothing was charged");
    expect(notice.title).not.toContain("before it could start");
  });
});

// Nothing read executionJobs.by_lease, so a job whose worker died between two segments was never
// declared dead by anything: the row stayed non-terminal, the review stayed "In progress", and the
// sandbox the worker had opened kept billing. These are the three ways a job is dead.
describe("declaring an execution job abandoned", () => {
  const live = { attempt: 1, createdAt: 0, leaseUntil: 10_000, reviewLive: true, now: 5_000 };

  it("leaves a job alone while its worker holds a live lease against a live review", () => {
    expect(executionReapReason(live)).toBeNull();
  });

  it("reaps past the job deadline even with attempts and a live review left", () => {
    expect(executionReapReason({ ...live, now: EXECUTION_JOB_DEADLINE_MS + 1 })).toBe("reaped_job_deadline");
  });

  it("reaps a job that has used its last attempt", () => {
    expect(executionReapReason({ ...live, attempt: EXECUTION_MAX_ATTEMPTS })).toBe("reaped_attempts_exhausted");
  });

  // The lease is the whole point of the wait. A worker inside its lease finds out at its next
  // checkpoint that the review went away; killing the row underneath it would race that write.
  it("waits for the lease to lapse before reaping a job whose review went away", () => {
    expect(executionReapReason({ ...live, reviewLive: false })).toBeNull();
    expect(executionReapReason({ ...live, reviewLive: false, leaseUntil: 4_000 })).toBe("reaped_review_unreachable");
    expect(executionReapReason({ ...live, reviewLive: false, leaseUntil: undefined })).toBe("reaped_review_unreachable");
  });

  it("treats a missing, finished or superseded review as unreachable", () => {
    const job = { expectedHeadSha: "a".repeat(40), expectedGeneration: 0 };
    const review = { status: "validating", headSha: job.expectedHeadSha, executionGeneration: 0, isStale: false };
    expect(executionReviewLive(review, job)).toBe(true);
    expect(executionReviewLive(null, job)).toBe(false);
    expect(executionReviewLive({ ...review, status: "cancelled" }, job)).toBe(false);
    expect(executionReviewLive({ ...review, executionGeneration: 1 }, job)).toBe(false);
    expect(executionReviewLive({ ...review, headSha: "b".repeat(40) }, job)).toBe(false);
    expect(executionReviewLive({ ...review, isStale: true }, job)).toBe(false);
  });
});

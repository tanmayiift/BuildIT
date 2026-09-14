import { describe, expect, it } from "vitest";
import type { ExecutionJob } from "../src/executionJob";
import { EXECUTION_JOB_DEADLINE_MS, EXECUTION_MAX_ATTEMPTS, applyExecutionCheckpoint, claimExecutionJob, createExecutionJob } from "../src/executionJob";

// Resumption is what makes an infinite loop reachable for the first time. Before it, a job did its
// work in one call and either finished or did not; now a segment can land, fail, and be picked up
// again, and three properties have to hold or it never stops: attempts end, the whole job ends, and
// a segment that did nothing is not mistaken for progress.
describe("bounds that stop a resumable job looping", () => {
  const base = "a".repeat(40), head = "b".repeat(40);
  const job = () => createExecutionJob({
    jobId: "job-loop", organizationId: "org-1", repositoryId: "repo-1", reviewId: "review-1",
    runId: "loop:0000", expectedHeadSha: head, baseSha: base,
    expectedGeneration: 0, now: 1_000,
  });

  it("refuses a seventh attempt rather than handing the same failure to another worker", () => {
    let value: ExecutionJob = job();
    // Same worker each time, so the lease never blocks the next claim - this is about the attempt
    // ceiling, not about lease contention.
    for (let attempt = 1; attempt <= EXECUTION_MAX_ATTEMPTS; attempt += 1) {
      value = claimExecutionJob(value, "worker-a", 1_000 + attempt);
      expect(value.attempt).toBe(attempt);
    }
    expect(() => claimExecutionJob(value, "worker-a", 2_000)).toThrow(/attempts_exhausted/);
  });

  it("refuses a claim past the whole-job deadline, however few attempts were used", () => {
    const value = job();
    expect(() => claimExecutionJob(value, "worker-a", 1_000 + EXECUTION_JOB_DEADLINE_MS + 1))
      .toThrow(/deadline_exceeded/);
    // One millisecond inside it is still work.
    expect(claimExecutionJob(value, "worker-a", 1_000 + EXECUTION_JOB_DEADLINE_MS).status).toBe("running");
  });

  it("refuses a checkpoint that stays on its stage without moving the cursor", () => {
    let claimed = claimExecutionJob(job(), "worker-a", 1_001);
    claimed = applyExecutionCheckpoint(claimed, {
      requestKey: "req-0", expectedVersion: claimed.stateVersion, expectedStage: "prepare",
      nextStage: "prepare", cursor: "prepare:started", durationMs: 1_000, now: 1_002,
    }).job;
    claimed = claimExecutionJob(claimed, "worker-a", 1_003);
    expect(() => applyExecutionCheckpoint(claimed, {
      requestKey: "req-1", expectedVersion: claimed.stateVersion, expectedStage: "prepare",
      nextStage: "prepare", cursor: "prepare:started", durationMs: 1_000, now: 1_004,
    })).toThrow(/cursor_stalled/);
  });

  it("still allows a failing checkpoint to hold its stage, which is how a retry is recorded", () => {
    const claimed = claimExecutionJob(job(), "worker-a", 1_001);
    const { job: failed } = applyExecutionCheckpoint(claimed, {
      requestKey: "req-2", expectedVersion: claimed.stateVersion, expectedStage: "prepare",
      nextStage: "prepare", cursor: "prepare:attempted", durationMs: 1_000, now: 1_002,
      failureCode: "broker_timeout",
    });
    expect(failed.status).toBe("failed");
    expect(claimExecutionJob(failed, "worker-b", 1_003).status).toBe("running");
  });

  it("accepts a checkpoint that advances the cursor within the same stage", () => {
    let value: ExecutionJob = claimExecutionJob(job(), "worker-a", 1_001);
    value = applyExecutionCheckpoint(value, {
      requestKey: "req-3", expectedVersion: value.stateVersion, expectedStage: "prepare",
      nextStage: "install", cursor: "install:pending", durationMs: 1_000, now: 1_002,
    }).job;
    value = claimExecutionJob(value, "worker-a", 1_003);
    const advanced = applyExecutionCheckpoint(value, {
      requestKey: "req-4", expectedVersion: value.stateVersion, expectedStage: "install",
      nextStage: "install", cursor: "install:done", durationMs: 1_000, now: 1_004,
    });
    expect(advanced.job.cursor).toBe("install:done");
  });
});

import { describe, expect, it } from "vitest";
import { applyExecutionCheckpoint, assertExecutionStageDuration, cancelExecutionJob, claimExecutionJob, createExecutionJob, EXECUTION_FUNCTION_LIMIT_MS, EXECUTION_STAGE_LIMIT_MS } from "../src/executionJob.js";

const base = "b".repeat(40);
const head = "a".repeat(40);
const input = { jobId: "job-1", organizationId: "org-1", repositoryId: "repo-1", reviewId: "review-1", runId: "review-1:0", expectedHeadSha: head, baseSha: base, expectedGeneration: 0, now: 1_000 };

describe("durable execution jobs", () => {
  it("keeps each stage below the 300 second function ceiling", () => {
    expect(EXECUTION_FUNCTION_LIMIT_MS).toBe(300_000);
    expect(EXECUTION_STAGE_LIMIT_MS).toBeLessThan(EXECUTION_FUNCTION_LIMIT_MS);
    expect(() => assertExecutionStageDuration(EXECUTION_STAGE_LIMIT_MS)).not.toThrow();
    expect(() => assertExecutionStageDuration(EXECUTION_STAGE_LIMIT_MS + 1)).toThrow("execution_stage_timeout");
  });

  it("advances one stage and replays the same callback without duplicating it", () => {
    const created = createExecutionJob(input);
    const claimed = claimExecutionJob(created, "worker-a", 1_001);
    const checkpoint = { requestKey: "prepare-1", expectedVersion: 1, expectedStage: "prepare" as const, nextStage: "scanners" as const, cursor: "context-artifact", artifactIds: ["artifact-1"], now: 1_002, durationMs: 100 };
    const first = applyExecutionCheckpoint(claimed, checkpoint);
    expect(first.replayed).toBe(false);
    expect(first.job).toMatchObject({ stage: "scanners", stateVersion: 2, status: "checkpointed", artifactIds: ["artifact-1"] });
    expect(applyExecutionCheckpoint(first.job, checkpoint)).toEqual({ job: first.job, replayed: true });
  });

  it("refuses stale or out-of-order checkpoints and never advances after cancellation", () => {
    const created = createExecutionJob(input);
    const claimed = claimExecutionJob(created, "worker-a", 1_001);
    expect(() => applyExecutionCheckpoint(claimed, { requestKey: "wrong-version", expectedVersion: 0, expectedStage: "prepare", nextStage: "scanners", cursor: "x", now: 1_002, durationMs: 1 })).toThrow("execution_checkpoint_conflict");
    expect(() => applyExecutionCheckpoint(claimed, { requestKey: "wrong-stage", expectedVersion: 1, expectedStage: "prepare", nextStage: "checks", cursor: "x", now: 1_002, durationMs: 1 })).toThrow("execution_stage_order_invalid");
    const cancelled = cancelExecutionJob(claimed, 1_002);
    expect(cancelled.status).toBe("cancelled");
    expect(() => applyExecutionCheckpoint(cancelled, { requestKey: "late", expectedVersion: 1, expectedStage: "prepare", nextStage: "scanners", cursor: "x", now: 1_003, durationMs: 1 })).toThrow("execution_job_cancelled");
  });

  it("records a failed stage while retaining its checkpoint and does not turn it into success", () => {
    const claimed = claimExecutionJob(createExecutionJob(input), "worker-a", 1_001);
    const result = applyExecutionCheckpoint(claimed, { requestKey: "failed-scan", expectedVersion: 1, expectedStage: "prepare", nextStage: "scanners", cursor: "scanners-failed", now: 1_002, durationMs: 200, failureCode: "runner_unavailable" });
    expect(result.job).toMatchObject({ status: "failed", stage: "scanners", cursor: "scanners-failed", failureCode: "runner_unavailable" });
    const retried = claimExecutionJob(result.job, "worker-b", 1_003);
    expect(retried).toMatchObject({ status: "running", stage: "scanners", cursor: "scanners-failed", attempt: 2 });
    expect(retried.failureCode).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import type { ExecutionJob } from "../src/executionJob";
import { EXECUTION_LEASE_MS, EXECUTION_JOB_DEADLINE_MS, EXECUTION_MAX_ATTEMPTS, applyExecutionCheckpoint, claimExecutionJob, createExecutionJob, credentialTeardownRevisions, executionStages, stampCredentialTeardown } from "../src/executionJob";

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

  // Walked stage by stage down to `checks`, because `checks` is the stage that genuinely re-enters -
  // once per check pair - and it is the only reason same-stage progression is allowed at all.
  it("accepts a checkpoint that advances the cursor within the same stage", () => {
    let value: ExecutionJob = job(), now = 1_000;
    for (const [from, to] of [["prepare", "scanners"], ["scanners", "install"], ["install", "checks"]] as const) {
      value = claimExecutionJob(value, "worker-a", (now += 1));
      value = applyExecutionCheckpoint(value, {
        requestKey: `req-${to}`, expectedVersion: value.stateVersion, expectedStage: from,
        nextStage: to, cursor: `${to}:0:pending`, durationMs: 1_000, now: (now += 1),
      }).job;
    }
    value = claimExecutionJob(value, "worker-a", (now += 1));
    const advanced = applyExecutionCheckpoint(value, {
      requestKey: "req-checks-1", expectedVersion: value.stateVersion, expectedStage: "checks",
      nextStage: "checks", cursor: "checks:1:lint", durationMs: 1_000, now: (now += 1),
    });
    expect(advanced.job.cursor).toBe("checks:1:lint");
  });
});

// The secret scan reads the tree as it arrived. While a review was one call the runner could scan
// before it installed regardless of what this list said; each stage is now its own invocation, so
// the list is the running order, and `scanners` after `checks` means gitleaks reading node_modules
// and whatever the repository's own suite wrote.
describe("the order the stages run in", () => {
  it("scans before anything is installed into the tree", () => {
    expect(executionStages.indexOf("scanners")).toBeLessThan(executionStages.indexOf("install"));
    expect(executionStages.indexOf("scanners")).toBeLessThan(executionStages.indexOf("checks"));
    expect(executionStages[0]).toBe("prepare");
    expect(executionStages[executionStages.length - 1]).toBe("complete");
  });
});

// The environment probe that proves no credential is reachable inside the sandbox runs once, in
// `prepare`. While a review was one call, the proof and the evidence were the same object and
// summarizeExecution read it straight off. Segmented, the proving segment and the finishing segment
// are different requests to a stateless broker, so the proof has to live on the durable record - and
// re-probing every segment, the obvious repair, makes the claim cheap rather than durable.
describe("the credential teardown proof survives the segments after it", () => {
  const base = "a".repeat(40), head = "b".repeat(40);
  const job = () => createExecutionJob({
    jobId: "job-teardown", organizationId: "org-1", repositoryId: "repo-1", reviewId: "review-1",
    runId: "teardown:0000", expectedHeadSha: head, baseSha: base, expectedGeneration: 0, now: 1_000,
  });

  it("carries both revisions on the cursor through every later stage", () => {
    let value: ExecutionJob = job(), now = 1_000;
    for (const [from, to] of [["prepare", "scanners"], ["scanners", "install"], ["install", "checks"]] as const) {
      value = claimExecutionJob(value, "worker-a", (now += 1));
      value = applyExecutionCheckpoint(value, {
        requestKey: `req-${to}`, expectedVersion: value.stateVersion, expectedStage: from, nextStage: to,
        cursor: stampCredentialTeardown(`${to}:0:none`, ["base", "head"]), durationMs: 10, now: (now += 1),
      }).job;
      expect(credentialTeardownRevisions(value.cursor), to).toEqual(["base", "head"]);
    }
  });

  it("reads back nothing from a cursor that never carried it, so an unproved job cannot be completed", () => {
    expect(credentialTeardownRevisions("checks:0:test")).toEqual([]);
    expect(credentialTeardownRevisions("")).toEqual([]);
    expect(credentialTeardownRevisions(stampCredentialTeardown("checks:0:test", ["head"]))).toEqual(["head"]);
  });

  it("does not let a stamp accumulate or carry anything that is not a revision", () => {
    const once = stampCredentialTeardown("checks:0:test", ["head", "base", "head"]);
    expect(once).toBe("checks:0:test|teardown=base+head");
    expect(stampCredentialTeardown(once, ["base"])).toBe("checks:0:test|teardown=base");
    expect(() => stampCredentialTeardown("checks:0:test", [])).toThrow("execution_teardown_proof_invalid");
    expect(() => stampCredentialTeardown("checks:0:test", ["base|teardown=head"])).toThrow("execution_teardown_proof_invalid");
  });
});

// The gap a seven-invocation run newly created. A checkpoint released the lease unconditionally,
// which was harmless while a job did all its work in one call - the only thing that could follow
// was a retry, and a retry should be claimable. Once segments are separate invocations, the job
// sits unleased between them with a live worker still driving it, and the sweep added to reap jobs
// nobody is driving cannot tell the difference: it kills a review that is progressing normally.
describe("holding the lease across a segment boundary", () => {
  const base = "a".repeat(40), head = "b".repeat(40);
  const claimed = () => claimExecutionJob(createExecutionJob({
    jobId: "job-lease", organizationId: "org-1", repositoryId: "repo-1", reviewId: "review-1",
    runId: "lease:0000", expectedHeadSha: head, baseSha: base, expectedGeneration: 0, now: 1_000,
  }), "worker-a", 1_001);

  const advance = (job: ReturnType<typeof claimed>, extra: Partial<Parameters<typeof applyExecutionCheckpoint>[1]> = {}) =>
    applyExecutionCheckpoint(job, {
      requestKey: "req-1", expectedVersion: job.stateVersion, expectedStage: job.stage,
      nextStage: job.stage, cursor: "checks:test", durationMs: 1_000, now: 2_000, ...extra,
    }).job;

  it("keeps the lease for a worker that says it is continuing", () => {
    const next = advance(claimed(), { holdLeaseUntil: 2_000 + EXECUTION_LEASE_MS });
    expect(next.leaseOwner).toBe("worker-a");
    expect(next.leaseUntil).toBe(2_000 + EXECUTION_LEASE_MS);
  });

  it("still releases when the worker does not ask to hold, which is what a retry needs", () => {
    const next = advance(claimed());
    expect(next.leaseOwner).toBeUndefined();
    expect(next.leaseUntil).toBeUndefined();
  });

  it("releases on a failing checkpoint however the worker asks, because that worker is done", () => {
    const next = advance(claimed(), { holdLeaseUntil: 2_000 + EXECUTION_LEASE_MS, failureCode: "broker_timeout" });
    expect(next.leaseOwner).toBeUndefined();
  });

  it("refuses a hold longer than a claim would grant, so a dead worker still frees the job on time", () => {
    expect(() => advance(claimed(), { holdLeaseUntil: 2_000 + EXECUTION_LEASE_MS + 1 })).toThrow(/lease_hold_too_long/);
    expect(() => advance(claimed(), { holdLeaseUntil: 2_000 })).toThrow(/lease_hold_invalid/);
  });
});

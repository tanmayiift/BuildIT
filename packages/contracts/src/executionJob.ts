/**
 * Durable execution state shared by the broker and its worker.
 *
 * A Vercel request is a transport boundary, not the lifetime of a review.  The
 * job state is deliberately serialisable so it can be stored in Convex (or a
 * queue-backed worker) and replayed after a function timeout without running
 * an already-completed stage again.
 */

export const EXECUTION_FUNCTION_LIMIT_MS = 300_000;
// Leave room for request parsing, artifact writes, telemetry and a graceful
// checkpoint before the platform's hard 300 second function limit.
export const EXECUTION_STAGE_LIMIT_MS = 270_000;
export const EXECUTION_LEASE_MS = 285_000;
// Retrying a failed stage is correct - a broker timeout or a dropped connection deserves another
// worker. Retrying it without end is not, and that is what this record did: claimExecutionJob
// refuses a completed or cancelled job and accepts a failed one, incrementing attempt with no
// ceiling, while nothing reads the by_lease index to sweep the table. Unbounded attempts plus
// automatic re-claim plus no sweeper is a permanent loop, and it becomes reachable the moment work
// is actually resumable rather than done in one call.
//
// Six attempts is roughly half an hour of leases. Past that the failure is not transient and a
// seventh worker will not discover anything the first six missed.
export const EXECUTION_MAX_ATTEMPTS = 6;
// A whole job, across every segment, measured from creation. Long enough for a large repository
// split into per-check segments; short enough that a job nobody is driving stops being counted as
// live work. The stage cap bounds one segment; this bounds the sum of them.
export const EXECUTION_JOB_DEADLINE_MS = 45 * 60_000;
// A stage like `checks` is re-entered once per check pair, so the ceiling has to clear the largest
// plan a repository can produce while still being a ceiling. Fifty pairs is far more than
// defaultExecutionPlans generates and still terminates.
export const EXECUTION_MAX_STAGE_REENTRIES = 50;

export const executionStages = [
  "prepare",
  "install",
  "checks",
  "diagnostics",
  "scanners",
  "compare",
  "complete",
] as const;

export type ExecutionStage = (typeof executionStages)[number];
export type ExecutionJobStatus = "queued" | "running" | "checkpointed" | "completed" | "failed" | "cancelled";

export type ExecutionJob = {
  jobId: string;
  organizationId: string;
  repositoryId: string;
  reviewId: string;
  runId: string;
  expectedHeadSha: string;
  baseSha: string;
  expectedGeneration: number;
  stage: ExecutionStage;
  cursor: string;
  /** Times the current stage has been re-entered. Reset when the stage advances. */
  stageReentries?: number;
  stateVersion: number;
  attempt: number;
  status: ExecutionJobStatus;
  leaseOwner?: string;
  leaseUntil?: number;
  artifactIds: string[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  failureCode?: string;
  lastRequestKey?: string;
};

export type ExecutionCheckpoint = {
  requestKey: string;
  expectedVersion: number;
  expectedStage: ExecutionStage;
  nextStage: ExecutionStage;
  cursor: string;
  artifactIds?: string[];
  now: number;
  durationMs: number;
  failureCode?: string;
};

function assertNonEmpty(value: string, code: string) {
  if (typeof value !== "string" || value.length === 0 || value.length > 300) throw new Error(code);
}

function assertSha(value: string, code: string) {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error(code);
}

function stageIndex(stage: ExecutionStage) {
  const index = executionStages.indexOf(stage);
  if (index < 0) throw new Error("execution_stage_invalid");
  return index;
}

export function assertExecutionStageDuration(durationMs: number, limitMs = EXECUTION_STAGE_LIMIT_MS) {
  if (!Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > limitMs) throw new Error("execution_stage_timeout");
  return durationMs;
}

export function createExecutionJob(input: Omit<ExecutionJob, "stage" | "cursor" | "stageReentries" | "stateVersion" | "attempt" | "status" | "artifactIds" | "createdAt" | "updatedAt"> & { now: number }) {
  assertNonEmpty(input.jobId, "execution_job_id_invalid");
  assertNonEmpty(input.organizationId, "execution_scope_invalid");
  assertNonEmpty(input.repositoryId, "execution_scope_invalid");
  assertNonEmpty(input.reviewId, "execution_scope_invalid");
  assertNonEmpty(input.runId, "execution_run_id_invalid");
  assertSha(input.expectedHeadSha, "execution_head_invalid");
  assertSha(input.baseSha, "execution_base_invalid");
  if (input.baseSha === input.expectedHeadSha) throw new Error("execution_commits_must_differ");
  if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 0) throw new Error("execution_generation_invalid");
  if (!Number.isSafeInteger(input.now) || input.now < 0) throw new Error("execution_time_invalid");
  return {
    jobId: input.jobId,
    organizationId: input.organizationId,
    repositoryId: input.repositoryId,
    reviewId: input.reviewId,
    runId: input.runId,
    expectedHeadSha: input.expectedHeadSha,
    baseSha: input.baseSha,
    expectedGeneration: input.expectedGeneration,
    stage: "prepare" as const,
    cursor: "",
    stageReentries: 0,
    stateVersion: 1,
    attempt: 0,
    status: "queued" as const,
    artifactIds: [],
    createdAt: input.now,
    updatedAt: input.now,
  } satisfies ExecutionJob;
}

export function claimExecutionJob(job: ExecutionJob, workerId: string, now: number, leaseMs = EXECUTION_LEASE_MS): ExecutionJob {
  assertNonEmpty(workerId, "execution_worker_invalid");
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("execution_time_invalid");
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > EXECUTION_FUNCTION_LIMIT_MS) throw new Error("execution_lease_invalid");
  if (["completed", "cancelled"].includes(job.status)) throw new Error("execution_job_terminal");
  if (job.attempt >= EXECUTION_MAX_ATTEMPTS) throw new Error("execution_job_attempts_exhausted");
  if (now - job.createdAt > EXECUTION_JOB_DEADLINE_MS) throw new Error("execution_job_deadline_exceeded");
  if (job.leaseOwner && job.leaseUntil !== undefined && job.leaseUntil > now && job.leaseOwner !== workerId) throw new Error("execution_job_leased");
  const { failureCode: _failureCode, ...withoutFailure } = job;
  return { ...withoutFailure, status: "running", attempt: job.attempt + 1, leaseOwner: workerId, leaseUntil: now + leaseMs, updatedAt: now };
}

export function applyExecutionCheckpoint(job: ExecutionJob, checkpoint: ExecutionCheckpoint): { job: ExecutionJob; replayed: boolean } {
  assertNonEmpty(checkpoint.requestKey, "execution_request_key_invalid");
  if (job.lastRequestKey === checkpoint.requestKey) return { job, replayed: true };
  if (job.status === "cancelled") throw new Error("execution_job_cancelled");
  if (["completed", "failed"].includes(job.status)) throw new Error("execution_job_terminal");
  if (job.stateVersion !== checkpoint.expectedVersion || job.stage !== checkpoint.expectedStage) throw new Error("execution_checkpoint_conflict");
  // Strict +1 was right while a job did all its work in one call, and it is wrong now: a stage like
  // `checks` exists precisely to be re-entered, once per check pair, until the plan is exhausted.
  // Forbidding same-stage progression made the segmented shape inexpressible.
  //
  // So same-stage is allowed on one condition - the cursor must strictly advance. That condition is
  // the whole loop guard. A segment that re-enters its stage having moved the cursor did a unit of
  // work; one that re-enters without moving it did nothing, and is the livelock this record makes
  // reachable for the first time. Lexicographic comparison, because the cursor is opaque to this
  // layer and the worker owns its encoding; it need only be monotonic.
  // Two guards, because either alone is not enough. The cursor must change, which catches a worker
  // that checkpoints having done nothing. And re-entries are counted and capped, which catches the
  // case a cursor comparison cannot: an A-B-A-B cycle where every step differs from the last and
  // the job still never ends.
  //
  // Comparing cursors for ordering rather than difference was the first attempt and it was wrong -
  // the cursor is opaque here, the worker owns its encoding, and "install:done" sorts before
  // "install:pending". A guard that depends on the caller choosing lexicographically monotonic
  // strings is a guard that fails silently the first time someone names a step badly.
  const reentering = checkpoint.nextStage === checkpoint.expectedStage;
  if (!checkpoint.failureCode && reentering && checkpoint.cursor === job.cursor) throw new Error("execution_cursor_stalled");
  const reentries = reentering ? (job.stageReentries ?? 0) + 1 : 0;
  if (reentries > EXECUTION_MAX_STAGE_REENTRIES) throw new Error("execution_stage_reentry_exhausted");
  if (!checkpoint.failureCode && !reentering && checkpoint.nextStage !== "complete" && stageIndex(checkpoint.nextStage) !== stageIndex(checkpoint.expectedStage) + 1) throw new Error("execution_stage_order_invalid");
  if (checkpoint.failureCode && checkpoint.nextStage !== checkpoint.expectedStage && checkpoint.nextStage !== "complete" && stageIndex(checkpoint.nextStage) !== stageIndex(checkpoint.expectedStage) + 1) throw new Error("execution_stage_order_invalid");
  assertExecutionStageDuration(checkpoint.durationMs);
  if (!Number.isSafeInteger(checkpoint.now) || checkpoint.now < job.updatedAt) throw new Error("execution_time_invalid");
  assertNonEmpty(checkpoint.cursor, "execution_cursor_invalid");
  const artifactIds = checkpoint.artifactIds ? [...new Set(checkpoint.artifactIds)] : job.artifactIds;
  if (artifactIds.some(id => typeof id !== "string" || id.length === 0 || id.length > 300)) throw new Error("execution_artifact_reference_invalid");
  const terminal = checkpoint.nextStage === "complete";
  const { leaseOwner: _leaseOwner, leaseUntil: _leaseUntil, ...withoutLease } = job;
  const next: ExecutionJob = {
    ...withoutLease,
    stage: checkpoint.nextStage,
    cursor: checkpoint.cursor,
    stageReentries: reentries,
    stateVersion: job.stateVersion + 1,
    status: checkpoint.failureCode ? "failed" : terminal ? "completed" : "checkpointed",
    artifactIds,
    updatedAt: checkpoint.now,
    ...(checkpoint.failureCode ? { failureCode: checkpoint.failureCode } : {}),
    ...(terminal && !checkpoint.failureCode ? { completedAt: checkpoint.now } : {}),
    lastRequestKey: checkpoint.requestKey,
  };
  return { job: next, replayed: false };
}

export function cancelExecutionJob(job: ExecutionJob, now: number): ExecutionJob {
  if (!Number.isSafeInteger(now) || now < job.updatedAt) throw new Error("execution_time_invalid");
  if (job.status === "completed" || job.status === "failed") return job;
  const { leaseOwner: _leaseOwner, leaseUntil: _leaseUntil, ...withoutLease } = job;
  return { ...withoutLease, status: "cancelled", updatedAt: now };
}

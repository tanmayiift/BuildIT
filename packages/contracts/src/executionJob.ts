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

export function createExecutionJob(input: Omit<ExecutionJob, "stage" | "cursor" | "stateVersion" | "attempt" | "status" | "artifactIds" | "createdAt" | "updatedAt"> & { now: number }) {
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
  if (!checkpoint.failureCode && checkpoint.nextStage !== "complete" && stageIndex(checkpoint.nextStage) !== stageIndex(checkpoint.expectedStage) + 1) throw new Error("execution_stage_order_invalid");
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

import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { assertReviewParent } from "./lib/parentConsistency";
import { reapedExecutionFailureCodes, sandboxReclaimMaxAttempts } from "./lib/lifecycle";
import { applyExecutionCheckpoint, claimExecutionJob, createExecutionJob, cancelExecutionJob, type ExecutionCheckpoint, type ExecutionJob } from "@buildit/contracts";
import type { Doc } from "./_generated/dataModel";
import * as value from "./validators";

const scopeArgs = {
  organizationId: v.id("organizations"), reviewId: v.id("reviews"),
  expectedHeadSha: v.string(), expectedGeneration: v.number(),
};

function toRunnerJob(row: Doc<"executionJobs">): ExecutionJob {
  return {
    jobId: row.jobKey,
    organizationId: String(row.organizationId), repositoryId: String(row.repositoryId), reviewId: String(row.reviewId),
    runId: row.runId, expectedHeadSha: row.expectedHeadSha, baseSha: row.baseSha,
    expectedGeneration: row.expectedGeneration, stage: row.stage, cursor: row.cursor,
    stateVersion: row.stateVersion, attempt: row.attempt, status: row.status,
    ...(row.leaseOwner === undefined ? {} : { leaseOwner: row.leaseOwner }),
    ...(row.leaseUntil === undefined ? {} : { leaseUntil: row.leaseUntil }),
    artifactIds: row.artifactIds.map(String),
    createdAt: row.createdAt, updatedAt: row.updatedAt,
    ...(row.completedAt === undefined ? {} : { completedAt: row.completedAt }),
    ...(row.failureCode === undefined ? {} : { failureCode: row.failureCode }),
    ...(row.lastRequestKey === undefined ? {} : { lastRequestKey: row.lastRequestKey }),
  };
}

export const create = internalMutation({
  args: {
    ...scopeArgs, jobKey: v.string(), runId: v.string(), baseSha: v.string(), now: v.number(),
  },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale) throw new ConvexError("execution_scope_stale");
    if (review.repositoryId === undefined || args.baseSha === args.expectedHeadSha) throw new ConvexError("execution_scope_invalid");
    const existing = await ctx.db.query("executionJobs").withIndex("by_job_key", q => q.eq("jobKey", args.jobKey)).unique();
    if (existing) {
      if (existing.organizationId !== args.organizationId || existing.repositoryId !== review.repositoryId || existing.reviewId !== args.reviewId || existing.runId !== args.runId || existing.expectedHeadSha !== args.expectedHeadSha || existing.baseSha !== args.baseSha || existing.expectedGeneration !== args.expectedGeneration) throw new ConvexError("execution_job_key_conflict");
      return existing._id;
    }
    const job = createExecutionJob({ jobId: args.jobKey, organizationId: String(args.organizationId), repositoryId: String(review.repositoryId), reviewId: String(args.reviewId), runId: args.runId, expectedHeadSha: args.expectedHeadSha, baseSha: args.baseSha, expectedGeneration: args.expectedGeneration, now: args.now });
    return ctx.db.insert("executionJobs", {
      organizationId: args.organizationId, repositoryId: review.repositoryId, reviewId: args.reviewId,
      jobKey: job.jobId, runId: job.runId, expectedHeadSha: job.expectedHeadSha, baseSha: job.baseSha, expectedGeneration: job.expectedGeneration,
      stage: job.stage, cursor: job.cursor, stateVersion: job.stateVersion, attempt: job.attempt, status: job.status,
      artifactIds: [], createdAt: job.createdAt, updatedAt: job.updatedAt,
    });
  },
});

export const claim = internalMutation({
  args: { jobId: v.id("executionJobs"), workerId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.jobId);
    if (!row) throw new ConvexError("execution_job_not_found");
    // claimExecutionJob accepts a `failed` job on purpose - a stage that failed on a broker timeout
    // deserves another worker. A job the reconcile sweep declared dead is not that, and nothing in
    // the contract can tell the two apart: the sweeper leaves the lease expired, and an expired
    // lease is what invites a claim. The distinction is the failure code, so the refusal is here.
    if (row.status === "failed" && row.failureCode !== undefined && reapedExecutionFailureCodes.has(row.failureCode)) throw new ConvexError("execution_job_reaped");
    const next = claimExecutionJob(toRunnerJob(row), args.workerId, args.now);
    await ctx.db.patch(row._id, {
      status: next.status, attempt: next.attempt, leaseOwner: next.leaseOwner, leaseUntil: next.leaseUntil, updatedAt: next.updatedAt,
    });
    return next;
  },
});

type CheckpointArgs = {
  jobId: Doc<"executionJobs">["_id"]; requestKey: string; expectedVersion: number; expectedStage: ExecutionJob["stage"];
  nextStage: ExecutionJob["stage"]; cursor: string; artifactIds?: Array<Doc<"artifacts">["_id"]>; durationMs: number; failureCode?: string; now: number; holdLeaseUntil?: number;
};

async function persistCheckpoint(ctx: MutationCtx, args: CheckpointArgs) {
    const row = await ctx.db.get(args.jobId);
    if (!row) throw new ConvexError("execution_job_not_found");
    const checkpoint: ExecutionCheckpoint = {
      requestKey: args.requestKey, expectedVersion: args.expectedVersion, expectedStage: args.expectedStage,
      nextStage: args.nextStage, cursor: args.cursor, ...(args.artifactIds === undefined ? {} : { artifactIds: args.artifactIds.map(String) }),
      now: args.now, durationMs: args.durationMs, ...(args.failureCode === undefined ? {} : { failureCode: args.failureCode }),
      ...(args.holdLeaseUntil === undefined ? {} : { holdLeaseUntil: args.holdLeaseUntil }),
    };
    const result = applyExecutionCheckpoint(toRunnerJob(row), checkpoint);
    if (result.replayed) return { id: row._id, replayed: true, stateVersion: row.stateVersion, status: row.status };
    const next = result.job;
    await ctx.db.patch(row._id, {
      stage: next.stage, cursor: next.cursor, stateVersion: next.stateVersion, status: next.status, artifactIds: next.artifactIds as typeof row.artifactIds,
      durationMs: args.durationMs, updatedAt: next.updatedAt, leaseOwner: next.leaseOwner, leaseUntil: next.leaseUntil,
      ...(next.failureCode === undefined ? { failureCode: undefined } : { failureCode: next.failureCode }),
      ...(next.lastRequestKey === undefined ? {} : { lastRequestKey: next.lastRequestKey }),
      ...(next.completedAt === undefined ? {} : { completedAt: next.completedAt }),
    });
    return { id: row._id, replayed: false, stateVersion: next.stateVersion, status: next.status };
}

export const checkpoint = internalMutation({
  args: {
    jobId: v.id("executionJobs"), requestKey: v.string(), expectedVersion: v.number(), expectedStage: value.executionStage,
    nextStage: value.executionStage, cursor: v.string(), artifactIds: v.optional(v.array(v.id("artifacts"))), durationMs: v.number(), holdLeaseUntil: v.optional(v.number()), failureCode: v.optional(v.string()), now: v.number(),
  },
  handler: async (ctx, args) => persistCheckpoint(ctx, args),
});

// Record a bounded, stable failure code after a worker or broker error. This is deliberately a
// separate mutation from `checkpoint`: the caller may have no next stage to advance to, but the
// lease must still be released so a later worker can claim and retry the same stage.
export const fail = internalMutation({
  args: { jobId: v.id("executionJobs"), failureCode: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.jobId);
    if (!row) throw new ConvexError("execution_job_not_found");
    if (["completed", "cancelled", "failed"].includes(row.status)) return { status: row.status, replayed: true };
    const code = args.failureCode.trim().slice(0, 80);
    if (!/^[a-z0-9_.:-]{1,80}$/.test(code)) throw new ConvexError("execution_failure_code_invalid");
    try {
      return await persistCheckpoint(ctx, {
        jobId: args.jobId,
        requestKey: `failure:${String(args.jobId)}:${row.stateVersion}:${code}`,
        expectedVersion: row.stateVersion,
        expectedStage: row.stage,
        nextStage: row.stage,
        cursor: `failure:${code}`,
        durationMs: Math.max(0, Math.min(270_000, args.now - row.updatedAt)),
        failureCode: code,
        now: args.now,
      });
    } catch (error) {
      // A concurrent worker may already have checkpointed or failed this stage. Re-read the row
      // and return its durable state instead of hiding the original worker error.
      const current = await ctx.db.get(args.jobId);
      if (current && ["completed", "cancelled", "failed", "checkpointed"].includes(current.status)) return { id: current._id, replayed: true, stateVersion: current.stateVersion, status: current.status };
      throw error;
    }
  },
});

export const cancel = internalMutation({
  args: { jobId: v.id("executionJobs"), now: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.jobId);
    if (!row) return null;
    const next = cancelExecutionJob(toRunnerJob(row), args.now);
    // Cancelling orphans the sandbox by definition - no worker will ever come back for this job -
    // so the reclamation intent is stamped here as well as by the sweep. Without it a cancelled
    // job's sandbox billed until the provider's own idle timeout, and nothing in BuildIT knew it
    // existed. `fail` deliberately does not do this: that stage is still retryable.
    if (next.status !== row.status) await ctx.db.patch(row._id, { status: next.status, updatedAt: next.updatedAt, leaseOwner: undefined, leaseUntil: undefined, sandboxReclaimAt: row.sandboxReclaimAt ?? args.now, sandboxReclaimAttempts: row.sandboxReclaimAttempts ?? 0 });
    return next.status;
  },
});

export const get = internalQuery({
  args: { jobId: v.id("executionJobs") },
  handler: async (ctx, args) => ctx.db.get(args.jobId),
});

// The seam. A Convex mutation cannot call the sandbox SDK, and Convex holds no Vercel credentials
// to call it with - the broker mints those per request from its own OIDC token - so the sweeper
// records which sandboxes are orphaned and sandboxReclaimWorker hands the keys to the broker, which
// calls into packages/runner. Everything a reclaim request needs is returned here, because the
// action runs outside the transaction and must not read rows itself.
export const listAbandonedSandboxes = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 50) throw new ConvexError("sandbox_reclaim_limit_invalid");
    const rows = await ctx.db.query("executionJobs")
      .withIndex("by_sandbox_reclaim", q => q.eq("sandboxReclaimedAt", undefined).gt("sandboxReclaimAt", 0))
      .take(args.limit);
    return rows.map(row => ({
      jobId: row._id, jobKey: row.jobKey, organizationId: row.organizationId, repositoryId: row.repositoryId,
      reviewId: row.reviewId, baseSha: row.baseSha, headSha: row.expectedHeadSha, attempts: row.sandboxReclaimAttempts ?? 0,
    }));
  },
});

export const recordSandboxReclaim = internalMutation({
  args: { jobId: v.id("executionJobs"), released: v.boolean(), now: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.jobId);
    if (!row || row.sandboxReclaimAt === undefined || row.sandboxReclaimedAt !== undefined) return null;
    const attempts = (row.sandboxReclaimAttempts ?? 0) + 1;
    // Giving up closes the row out too. A row left pending is re-sent to the broker every cycle for
    // ever, so the backlog would grow without bound against a provider that is never going to
    // answer. The attempt count stays at the cap as the evidence: a sandbox BuildIT could not prove
    // it stopped is still being paid for, and that is an operator's problem, not a retry's.
    const exhausted = attempts >= sandboxReclaimMaxAttempts;
    await ctx.db.patch(row._id, { sandboxReclaimAttempts: attempts, ...(args.released || exhausted ? { sandboxReclaimedAt: args.now } : {}) });
    return { released: args.released, attempts, exhausted };
  },
});

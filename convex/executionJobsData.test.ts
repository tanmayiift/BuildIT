import { EXECUTION_JOB_DEADLINE_MS, EXECUTION_MAX_ATTEMPTS } from "@buildit/contracts";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sandboxReclaimMaxAttempts } from "./lib/lifecycle";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const base = "b".repeat(40), head = "a".repeat(40);

async function seed(t: ReturnType<typeof convexTest>) {
  return t.run(async ctx => {
    const now = 1_000;
    const organizationId = await ctx.db.insert("organizations", { name: "Execution", slug: "execution", timezone: "UTC", region: "eu-west-1", retentionHours: 24, monthlyBudget: 50, concurrencyLimit: 2, planId: "test", fingerprintKeyVersion: 1, createdAt: now });
    const installationId = await ctx.db.insert("githubInstallations", { organizationId, installationId: 1, accountLogin: "execution", accountType: "user", permissionSnapshot: { metadata: "read", contents: "read", pullRequests: "write", issues: "read", checks: "write" }, status: "active", createdAt: now, updatedAt: now });
    const repositoryId = await ctx.db.insert("repositories", { organizationId, installationId, githubRepositoryId: 1, owner: "execution", name: "repo", defaultBranch: "main", enabled: true, autofixMode: "stacked", forkPolicy: "manual_review_only", indexState: "ready", concurrencyLimit: 1, createdAt: now, updatedAt: now });
    const configArtifactId = await ctx.db.insert("artifacts", { organizationId, repositoryId, type: "configuration", storageKey: "config", encrypted: true, checksum: "a", size: 1, redactionStatus: "redacted", expiresAt: 9e12, deletionAttempts: 0 });
    const configRevisionId = await ctx.db.insert("configRevisions", { organizationId, repositoryId, sourceCommitSha: base, sourceRef: "main", configArtifactId, contentHash: "config", rulesDigest: "rules", schemaVersion: "1", validationState: "valid", provenance: "defaults_only", refProtectionState: "unverified", createdAt: now });
    const reviewId = await ctx.db.insert("reviews", { organizationId, repositoryId, configRevisionId, githubRepositoryId: 1, prNumber: 1, isFork: false, baseRef: "main", baseSha: base, headSha: head, requiredCheckPolicy: "advisory", completedRoundCount: 0, patchAttemptCount: 0, diagnosticRunCount: 0, providerRetryCount: 0, commandRetryCount: 0, trigger: "dashboard", triggerVerb: "review", triggerActor: "test", triggerActorPermission: "admin", mode: "review", status: "validating", budgetLimit: 5, budgetConsumed: 0, nextActionCode: "none", isStale: false, trustedRef: "main", trustedRefSha: base, configProvenance: "defaults_only", provider: "anthropic", model: "test", modelVersion: "test", promptVersion: "test", evalSetVersion: "test", coverageLevel: "full", currentStage: "validation", runnerImageVersion: "test", executionGeneration: 0, queuePriority: 0, expiresAt: 9e12, createdAt: now, updatedAt: now });
    return { organizationId, repositoryId, reviewId } satisfies { organizationId: Id<"organizations">; repositoryId: Id<"repositories">; reviewId: Id<"reviews"> };
  });
}

describe("durable execution job persistence", () => {
  it("creates, claims, checkpoints, and replays one job without duplicate state", async () => {
    const t = convexTest(schema, modules), scope = await seed(t);
    const args = { organizationId: scope.organizationId, reviewId: scope.reviewId, expectedHeadSha: head, expectedGeneration: 0, jobKey: "validation:job-1", runId: "job-1:0000", baseSha: base, now: 1_001 };
    const id = await t.mutation(internal.executionJobsData.create, args);
    expect(await t.mutation(internal.executionJobsData.create, args)).toBe(id);
    await t.mutation(internal.executionJobsData.claim, { jobId: id, workerId: "worker-a", now: 1_002 });
    const checkpoint = { jobId: id, requestKey: "prepare-1", expectedVersion: 1, expectedStage: "prepare" as const, nextStage: "scanners" as const, cursor: "context", durationMs: 20, now: 1_003 };
    expect(await t.mutation(internal.executionJobsData.checkpoint, checkpoint)).toMatchObject({ replayed: false, stateVersion: 2, status: "checkpointed" });
    expect(await t.mutation(internal.executionJobsData.checkpoint, checkpoint)).toMatchObject({ replayed: true, stateVersion: 2, status: "checkpointed" });
    expect(await t.query(internal.executionJobsData.get, { jobId: id })).toMatchObject({ stage: "scanners", stateVersion: 2, status: "checkpointed", cursor: "context" });
  });

  it("records a failed stage and lets a later worker retry it", async () => {
    const t = convexTest(schema, modules), scope = await seed(t);
    const id = await t.mutation(internal.executionJobsData.create, {
      organizationId: scope.organizationId, reviewId: scope.reviewId, expectedHeadSha: head, expectedGeneration: 0,
      jobKey: "validation:job-failure", runId: "job-failure:0000", baseSha: base, now: 1_001,
    });
    await t.mutation(internal.executionJobsData.claim, { jobId: id, workerId: "worker-a", now: 1_002 });
    expect(await t.mutation(internal.executionJobsData.fail, { jobId: id, failureCode: "broker_timeout", now: 1_003 })).toMatchObject({ status: "failed", replayed: false });
    expect(await t.mutation(internal.executionJobsData.fail, { jobId: id, failureCode: "broker_timeout", now: 1_004 })).toMatchObject({ status: "failed", replayed: true });
    await t.mutation(internal.executionJobsData.claim, { jobId: id, workerId: "worker-b", now: 1_005 });
    expect(await t.query(internal.executionJobsData.get, { jobId: id })).toMatchObject({ status: "running", attempt: 2, stage: "prepare" });
  });
});

async function insertJob(t: ReturnType<typeof convexTest>, scope: Awaited<ReturnType<typeof seed>>, over: Record<string, unknown> = {}) {
  return t.run(async ctx => ctx.db.insert("executionJobs", {
    organizationId: scope.organizationId, repositoryId: scope.repositoryId, reviewId: scope.reviewId,
    jobKey: "validation:job-live", runId: "job-live:0000", expectedHeadSha: head, baseSha: base, expectedGeneration: 0,
    stage: "prepare" as const, cursor: "", stateVersion: 1, attempt: 1, status: "running" as const,
    leaseOwner: "worker-a", leaseUntil: 2_000, artifactIds: [], createdAt: 1_000, updatedAt: 1_000, ...over,
  }));
}

const scheduled = (t: ReturnType<typeof convexTest>) => t.run(async ctx => ctx.db.system.query("_scheduled_functions").collect());

// convex/schema.ts declared executionJobs.by_lease and nothing anywhere read it. A job whose worker
// died between two segments therefore stayed `running` for ever: no retry, no failure, no end - and
// the paid sandbox that worker had opened kept running against a review that showed "In progress"
// to the person waiting on it.
describe("the reconcile sweep reaps execution jobs nobody is driving", () => {
  it("reaps a lapsed job whose review is gone and leaves the live one alone", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules), scope = await seed(t);
    const abandoned = await insertJob(t, scope, { jobKey: "validation:job-dead", expectedGeneration: 0 });
    const healthy = await insertJob(t, scope, { jobKey: "validation:job-ok", leaseUntil: 9_000 });
    // The commonest abandonment: a newer commit superseded the review, so the generation moved and
    // no worker will ever finish this job - but nothing told the job that.
    await t.run(async ctx => ctx.db.patch(scope.reviewId, { executionGeneration: 1 }));

    await t.mutation(internal.reconcileWorker.sweep, { now: 3_000 });

    expect(await t.run(ctx => ctx.db.get(abandoned))).toMatchObject({ status: "failed", failureCode: "reaped_review_unreachable" });
    expect(await t.run(ctx => ctx.db.get(healthy)), "the sweep reaped a job whose worker was still inside its lease").toMatchObject({ status: "running" });
    vi.useRealTimers();
  });

  it("reaps a job past its deadline with attempts to spare, and ends the review it was executing", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules), scope = await seed(t);
    const now = 1_000 + EXECUTION_JOB_DEADLINE_MS + 1;
    // lastProgressAt is recent, so the existing stuck-review sweep would not have touched this
    // review: whatever ends it here is the job sweep and nothing else.
    await t.run(async ctx => ctx.db.patch(scope.reviewId, { lastProgressAt: now - 1_000 }));
    const jobId = await insertJob(t, scope, { attempt: 1, leaseUntil: 2_000 });

    await t.mutation(internal.reconcileWorker.sweep, { now });

    expect(await t.run(ctx => ctx.db.get(jobId))).toMatchObject({ status: "failed", failureCode: "reaped_job_deadline" });
    const review = await t.run(ctx => ctx.db.get(scope.reviewId));
    expect(review, "a reaped job left its review active for ever").toMatchObject({ status: "platform_failed", statusReasonCode: "platform_error", executionGeneration: 1 });
    expect((await scheduled(t)).some(job => job.name.includes("acknowledge")), "nothing told the pull request the review had been given up on").toBe(true);
    vi.useRealTimers();
  });

  it("reaps a job that has used its last attempt", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules), scope = await seed(t);
    const jobId = await insertJob(t, scope, { attempt: EXECUTION_MAX_ATTEMPTS, leaseUntil: 2_000 });

    await t.mutation(internal.reconcileWorker.sweep, { now: 3_000 });

    expect(await t.run(ctx => ctx.db.get(jobId))).toMatchObject({ status: "failed", failureCode: "reaped_attempts_exhausted" });
    vi.useRealTimers();
  });

  // claimExecutionJob accepts a `failed` job on purpose, so marking a dead job failed and releasing
  // its lease - which is what executionJobsData.fail does - would hand it straight to the next
  // worker and rebuild the unbounded retry loop the reap exists to end.
  it("will not hand a reaped job to another worker, and keeps the dead lease as the record", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules), scope = await seed(t);
    const jobId = await insertJob(t, scope, { attempt: 1, leaseUntil: 2_000 });
    await t.run(async ctx => ctx.db.patch(scope.reviewId, { status: "cancelled" }));

    await t.mutation(internal.reconcileWorker.sweep, { now: 3_000 });

    await expect(t.mutation(internal.executionJobsData.claim, { jobId, workerId: "worker-b", now: 4_000 })).rejects.toThrow("execution_job_reaped");
    expect(await t.run(ctx => ctx.db.get(jobId))).toMatchObject({ status: "failed", attempt: 1, leaseOwner: "worker-a", leaseUntil: 2_000 });
    vi.useRealTimers();
  });

  // A Convex mutation cannot call the sandbox SDK, so the sweep records the orphan and the reclaim
  // worker hands the key to the broker. Without the record a sweep that ran while the broker was
  // down would forget the sandbox existed and pay for it until the provider's own idle timeout.
  it("records the orphaned sandbox and stops asking once the runner confirms it is gone", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules), scope = await seed(t);
    const jobId = await insertJob(t, scope, { jobKey: "validation:job-sandbox", leaseUntil: 2_000 });
    await t.run(async ctx => ctx.db.patch(scope.reviewId, { status: "cancelled" }));

    await t.mutation(internal.reconcileWorker.sweep, { now: 3_000 });

    expect(await t.query(internal.executionJobsData.listAbandonedSandboxes, { limit: 25 }))
      .toMatchObject([{ jobId, jobKey: "validation:job-sandbox", baseSha: base, headSha: head, attempts: 0 }]);
    expect(await t.mutation(internal.executionJobsData.recordSandboxReclaim, { jobId, released: true, now: 4_000 })).toMatchObject({ released: true, exhausted: false });
    expect(await t.query(internal.executionJobsData.listAbandonedSandboxes, { limit: 25 })).toEqual([]);
    vi.useRealTimers();
  });

  it("gives up on a sandbox the broker never manages to stop, keeping the attempts as evidence", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules), scope = await seed(t);
    const jobId = await insertJob(t, scope, { leaseUntil: 2_000 });
    await t.run(async ctx => ctx.db.patch(scope.reviewId, { status: "cancelled" }));
    await t.mutation(internal.reconcileWorker.sweep, { now: 3_000 });

    const outcomes = [];
    for (let attempt = 0; attempt < sandboxReclaimMaxAttempts; attempt += 1) {
      outcomes.push(await t.mutation(internal.executionJobsData.recordSandboxReclaim, { jobId, released: false, now: 4_000 + attempt }));
    }

    expect(outcomes.at(-1)).toMatchObject({ released: false, attempts: sandboxReclaimMaxAttempts, exhausted: true });
    expect(await t.query(internal.executionJobsData.listAbandonedSandboxes, { limit: 25 })).toEqual([]);
    expect(await t.run(ctx => ctx.db.get(jobId))).toMatchObject({ sandboxReclaimAttempts: sandboxReclaimMaxAttempts });
    vi.useRealTimers();
  });

  // An unbounded sweep reads the whole table in one transaction and crosses Convex's read limit,
  // where a query does not degrade - it hard-fails, and then nothing is ever reaped again.
  it("bounds one pass and reaps the remainder on the next", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules), scope = await seed(t);
    await t.run(async ctx => ctx.db.patch(scope.reviewId, { status: "cancelled" }));
    for (let index = 0; index < 203; index += 1) await insertJob(t, scope, { jobKey: `validation:job-${index}`, leaseUntil: 2_000 });

    expect(await t.mutation(internal.reconcileWorker.sweep, { now: 3_000 })).toMatchObject({ jobsReaped: 200 });
    expect(await t.mutation(internal.reconcileWorker.sweep, { now: 4_000 })).toMatchObject({ jobsReaped: 3 });
    vi.useRealTimers();
  });
});

// by_lease is keyed on status, not on organization, so the sweep walks every tenant's rows in one
// transaction. A mutation that throws rolls the whole transaction back: one corrupt row would then
// mean nothing anywhere is ever reaped again, and the leak this sweep exists to stop becomes
// permanent. It also must not act on that row - retiring it would post "review did not complete"
// onto another tenant's repository on the strength of the corruption.
describe("one corrupt execution job does not wedge the sweep", () => {
  it("skips a job whose review belongs to another organization and reaps the rest", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules), scope = await seed(t), other = await seed(t);
    await t.run(async ctx => ctx.db.patch(scope.reviewId, { status: "cancelled" }));
    const crossTenant = await insertJob(t, scope, { jobKey: "validation:job-cross", reviewId: other.reviewId, leaseUntil: 2_000 });
    const reapable = await insertJob(t, scope, { jobKey: "validation:job-sound", leaseUntil: 2_000 });

    const result = await t.mutation(internal.reconcileWorker.sweep, { now: 3_000 });

    expect(result).toMatchObject({ jobsReaped: 1, jobsUnreapable: 1 });
    expect(await t.run(ctx => ctx.db.get(reapable))).toMatchObject({ status: "failed", failureCode: "reaped_review_unreachable" });
    expect(await t.run(ctx => ctx.db.get(crossTenant)), "the sweep acted on a row whose parents do not agree").toMatchObject({ status: "running" });
    expect(await t.run(ctx => ctx.db.get(other.reviewId)), "another tenant's review was retired by a corrupt row").toMatchObject({ status: "validating" });
    vi.useRealTimers();
  });
});

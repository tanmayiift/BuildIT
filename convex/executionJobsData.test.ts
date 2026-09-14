import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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
    const checkpoint = { jobId: id, requestKey: "prepare-1", expectedVersion: 1, expectedStage: "prepare" as const, nextStage: "install" as const, cursor: "context", durationMs: 20, now: 1_003 };
    expect(await t.mutation(internal.executionJobsData.checkpoint, checkpoint)).toMatchObject({ replayed: false, stateVersion: 2, status: "checkpointed" });
    expect(await t.mutation(internal.executionJobsData.checkpoint, checkpoint)).toMatchObject({ replayed: true, stateVersion: 2, status: "checkpointed" });
    expect(await t.query(internal.executionJobsData.get, { jobId: id })).toMatchObject({ stage: "install", stateVersion: 2, status: "checkpointed", cursor: "context" });
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

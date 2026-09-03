import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// The privacy copy promises source evidence is deleted, and until now the only thing that made
// that happen was the retention clock. An organization owner asking for their evidence gone today
// had nothing to invoke, and neither did docs/runbooks/deletion-failure.md. Erasure brings the
// expiry forward so the existing cleanup cron claims the rows on its next pass; it deliberately
// does not delete anything itself, because the confirmed-delete path in artifactCleanupWorker -
// which reads the key back and accepts only a NotFound - is the only thing that can prove the
// object actually left storage.

async function seed(t: ReturnType<typeof convexTest>) {
  return t.run(async ctx => {
    const now = 1_000;
    const organizationId = await ctx.db.insert("organizations", { name: "Ledgerline", slug: "ledgerline", timezone: "UTC",
      region: "eu-west-1", retentionHours: 24, monthlyBudget: 50, concurrencyLimit: 3, planId: "trial",
      fingerprintKeyVersion: 1, createdAt: now });
    const installationId = await ctx.db.insert("githubInstallations", { organizationId, installationId: 123,
      accountLogin: "ledgerline", accountType: "user",
      permissionSnapshot: { metadata: "read", contents: "read", pullRequests: "write", issues: "read", checks: "write" },
      status: "active", createdAt: now, updatedAt: now });
    const repositoryId = await ctx.db.insert("repositories", { organizationId, installationId, githubRepositoryId: 42,
      owner: "ledgerline", name: "api", defaultBranch: "main", enabled: true, autofixMode: "stacked",
      forkPolicy: "manual_review_only", indexState: "ready", concurrencyLimit: 1, createdAt: now, updatedAt: now });
    const configArtifactId = await ctx.db.insert("artifacts", { organizationId, repositoryId, type: "configuration",
      storageKey: "ledgerline/config", encrypted: true, checksum: "hash", size: 1, redactionStatus: "redacted",
      expiresAt: now + 60_000, deletionAttempts: 0 });
    const configRevisionId = await ctx.db.insert("configRevisions", { organizationId, repositoryId,
      sourceCommitSha: "b".repeat(40), sourceRef: "main", configArtifactId, contentHash: "config-hash",
      rulesDigest: "rules-hash", schemaVersion: "1", validationState: "valid", provenance: "defaults_only",
      refProtectionState: "unverified", createdAt: now });
    await ctx.db.patch(repositoryId, { configRevisionId });
    const reviewId = await ctx.db.insert("reviews", { organizationId, repositoryId, githubRepositoryId: 42, prNumber: 1,
      isFork: false, baseRef: "main", baseSha: "b".repeat(40), headSha: "a".repeat(40), requiredCheckPolicy: "advisory",
      completedRoundCount: 0, patchAttemptCount: 0, diagnosticRunCount: 0, providerRetryCount: 0, commandRetryCount: 0,
      trigger: "dashboard", triggerVerb: "review", triggerActor: "owner", triggerActorPermission: "admin",
      mode: "review", status: "checks_passed", budgetLimit: 10, budgetConsumed: 1, nextActionCode: "none",
      isStale: false, trustedRef: "main", trustedRefSha: "b".repeat(40), configRevisionId,
      configProvenance: "defaults_only", provider: "anthropic", model: "test-model", modelVersion: "test",
      promptVersion: "test", evalSetVersion: "test", coverageLevel: "full", currentStage: "complete",
      runnerImageVersion: "test", executionGeneration: 0, queuePriority: 0,
      expiresAt: now + 10_000_000, createdAt: now, updatedAt: now });
    const artifactId = await ctx.db.insert("artifacts", { organizationId, repositoryId, reviewId, type: "command_output",
      storageKey: "placeholder", encrypted: true, checksum: "output-hash", size: 10, redactionStatus: "redacted",
      expiresAt: now + 10_000_000, deletionAttempts: 0 });
    await ctx.db.patch(artifactId, { storageKey: `artifacts/${organizationId}/${repositoryId}/${reviewId}/${artifactId}/output` });
    return { organizationId, repositoryId, reviewId, artifactId };
  });
}

describe("erasure on request", () => {
  it("brings every artifact for a review within reach of the cleanup cron", async () => {
    const t = convexTest(schema, modules), seeded = await seed(t);
    const result = await t.mutation(internal.artifactCleanupData.eraseReviewEvidence, { reviewId: seeded.reviewId, now: 5_000 });
    expect(result).toEqual({ expired: 1 });

    const claimed = await t.mutation(internal.artifactCleanupData.claimExpired, { now: 6_000, leaseId: "11111111-1111-1111-1111-111111111111", limit: 25 });
    expect(claimed.map(item => item.artifactId)).toEqual([seeded.artifactId]);
  });

  it("does not mark anything deleted, because only a confirmed storage delete may do that", async () => {
    const t = convexTest(schema, modules), seeded = await seed(t);
    await t.mutation(internal.artifactCleanupData.eraseReviewEvidence, { reviewId: seeded.reviewId, now: 5_000 });
    const artifact = await t.run(async ctx => ctx.db.get(seeded.artifactId));
    expect(artifact?.deletedAt).toBeUndefined();
  });

  it("leaves an artifact already deleted untouched", async () => {
    const t = convexTest(schema, modules), seeded = await seed(t);
    await t.run(async ctx => ctx.db.patch(seeded.artifactId, { deletedAt: 4_000 }));
    const result = await t.mutation(internal.artifactCleanupData.eraseReviewEvidence, { reviewId: seeded.reviewId, now: 5_000 });
    expect(result).toEqual({ expired: 0 });
  });
});

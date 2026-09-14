import type { convexTest } from "convex-test";

export async function summaryFixture(t: ReturnType<typeof convexTest>, slug = "summary", now = Date.now()) {
  return t.run(async ctx => {
    const organizationId = await ctx.db.insert("organizations", { name: slug, slug, timezone: "Asia/Kolkata", region: "eu-west-1", retentionHours: 24, monthlyBudget: 100, concurrencyLimit: 2, planId: "test", fingerprintKeyVersion: 1, createdAt: now });
    await ctx.db.insert("memberships", { organizationId, userId: slug, role: "owner", status: "active", createdAt: now, updatedAt: now });
    const installationId = await ctx.db.insert("githubInstallations", { organizationId, installationId: now, accountLogin: slug, accountType: "organization", permissionSnapshot: { metadata: "read", contents: "write", pullRequests: "write", issues: "read", checks: "write" }, status: "active", createdAt: now, updatedAt: now });
    const repositoryId = await ctx.db.insert("repositories", { organizationId, installationId, githubRepositoryId: now, owner: slug, name: "fixture", defaultBranch: "main", enabled: true, autofixMode: "stacked", forkPolicy: "manual_review_only", indexState: "ready", concurrencyLimit: 1, createdAt: now, updatedAt: now });
    const configRevisionId = await ctx.db.insert("configRevisions", { organizationId, repositoryId, sourceCommitSha: "b".repeat(40), sourceRef: "main", contentHash: "config", rulesDigest: "rules", schemaVersion: "1", validationState: "valid", provenance: "defaults_only", refProtectionState: "unverified", createdAt: now });
    const reviewId = await ctx.db.insert("reviews", {
      organizationId, repositoryId, githubRepositoryId: now, prNumber: 1, isFork: false,
      baseRef: "main", baseSha: "b".repeat(40), headSha: "a".repeat(40), requiredCheckPolicy: "advisory",
      completedRoundCount: 0, patchAttemptCount: 0, diagnosticRunCount: 0, providerRetryCount: 0, commandRetryCount: 0,
      trigger: "dashboard", triggerVerb: "review", triggerActor: slug, triggerActorPermission: "admin", mode: "review", status: "queued",
      budgetLimit: 10, budgetConsumed: 0, nextActionCode: "none", isStale: false, trustedRef: "main", trustedRefSha: "b".repeat(40),
      configRevisionId, configProvenance: "defaults_only", provider: "anthropic", model: "test-model", modelVersion: "test", promptVersion: "test",
      evalSetVersion: "test", coverageLevel: "limited", currentStage: "queue", runnerImageVersion: "test", executionGeneration: 0, queuePriority: 0,
      expiresAt: now + 86_400_000, createdAt: now, updatedAt: now,
    });
    return { organizationId, installationId, repositoryId, reviewId, configRevisionId };
  });
}

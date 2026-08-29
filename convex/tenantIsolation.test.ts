/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedTenant(t: ReturnType<typeof convexTest>, slug: string, userId: string) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const organizationId = await ctx.db.insert("organizations", {
      name: slug, slug, timezone: "Asia/Kolkata", region: "eu-west-1", retentionHours: 24,
      monthlyBudget: 100, concurrencyLimit: 2, planId: "test", fingerprintKeyVersion: 1, createdAt: now,
    });
    await ctx.db.insert("memberships", {
      organizationId, userId, role: "owner", status: "active", createdAt: now, updatedAt: now,
    });
    const installationId = await ctx.db.insert("githubInstallations", {
      organizationId, installationId: Math.floor(Math.random() * 1_000_000), accountLogin: slug,
      accountType: "organization", permissionSnapshot: {
        metadata: "read", contents: "write", pullRequests: "write", issues: "write", checks: "write",
      }, status: "active", createdAt: now, updatedAt: now,
    });
    const repositoryId = await ctx.db.insert("repositories", {
      organizationId, installationId, githubRepositoryId: Math.floor(Math.random() * 1_000_000),
      owner: slug, name: "fixture", defaultBranch: "main", enabled: true,
      autofixMode: "stacked", forkPolicy: "manual_review_only", indexState: "ready",
      concurrencyLimit: 1, createdAt: now, updatedAt: now,
    });
    const configArtifactId = await ctx.db.insert("artifacts", {
      organizationId, type: "configuration", storageKey: `${slug}/config`, encrypted: true,
      checksum: "hash", size: 1, redactionStatus: "redacted", expiresAt: now + 60_000,
      deletionAttempts: 0,
    });
    const configRevisionId = await ctx.db.insert("configRevisions", {
      organizationId, repositoryId, sourceCommitSha: "b".repeat(40), sourceRef: "main",
      configArtifactId, contentHash: "config-hash", rulesDigest: "rules-hash", schemaVersion: "1",
      validationState: "valid", provenance: "defaults_only", refProtectionState: "unverified", createdAt: now,
    });
    await ctx.db.patch(repositoryId, { configRevisionId });
    const reviewId = await ctx.db.insert("reviews", {
      organizationId, repositoryId, githubRepositoryId: 1, prNumber: 1, isFork: false,
      baseRef: "main", baseSha: "b".repeat(40), headSha: "a".repeat(40),
      requiredCheckPolicy: "advisory", completedRoundCount: 0, patchAttemptCount: 0,
      diagnosticRunCount: 0, providerRetryCount: 0, commandRetryCount: 0,
      trigger: "dashboard", triggerVerb: "review", triggerActor: userId,
      triggerActorPermission: "admin", mode: "review", status: "queued",
      budgetLimit: 10, budgetConsumed: 0, nextActionCode: "none", isStale: false,
      trustedRef: "main", trustedRefSha: "b".repeat(40), configRevisionId,
      configProvenance: "defaults_only", provider: "anthropic", model: "test-model",
      modelVersion: "test", promptVersion: "test", evalSetVersion: "test",
      coverageLevel: "limited", currentStage: "queue", runnerImageVersion: "test",
      expiresAt: now + 60_000, createdAt: now, updatedAt: now,
    });
    const artifactId = await ctx.db.insert("artifacts", {
      organizationId, reviewId, type: "command_output", storageKey: `${slug}/output`, encrypted: true,
      checksum: "output-hash", size: 10, redactionStatus: "redacted", expiresAt: now + 60_000,
      deletionAttempts: 0,
    });
    await ctx.db.insert("providerCredentials", {
      organizationId, provider: "anthropic", encryptedCiphertext: "ciphertext",
      nonce: "nonce", authTag: "tag", aadDigest: "aad", keyVersion: 1,
      maskedSuffix: "…1234", status: "valid", createdBy: userId, createdAt: now,
    });
    return { organizationId, reviewId, artifactId };
  });
}

describe("Convex tenant isolation", () => {
  it("returns only organizations belonging to the authenticated user", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t, "alpha", "alice");
    await seedTenant(t, "beta", "bob");
    const result = await t.withIdentity({ subject: "alice" }).query(api.organizations.listMine, {});
    expect(result.map((organization) => organization.slug)).toEqual(["alpha"]);
  });

  it("rejects guessed organization and review IDs from another tenant", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t, "alpha", "alice");
    const beta = await seedTenant(t, "beta", "bob");
    const asAlice = t.withIdentity({ subject: "alice" });
    await expect(asAlice.query(api.reviews.list, { organizationId: beta.organizationId })).rejects.toThrow("not_found_or_forbidden");
    await expect(asAlice.query(api.reviews.get, { reviewId: beta.reviewId })).rejects.toThrow("not_found_or_forbidden");
    await expect(asAlice.query(api.artifacts.getMetadata, { artifactId: beta.artifactId })).rejects.toThrow("not_found_or_forbidden");
  });

  it("never returns encrypted provider credential fields", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const result = await t.withIdentity({ subject: "alice" }).query(api.integrations.listProviderCredentials, { organizationId: alpha.organizationId });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ provider: "anthropic", maskedSuffix: "…1234" });
    expect(result[0]).not.toHaveProperty("encryptedCiphertext");
    expect(result[0]).not.toHaveProperty("nonce");
    expect(result[0]).not.toHaveProperty("authTag");
  });

  it("requires admin access for credential metadata", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("memberships", {
        organizationId: alpha.organizationId, userId: "viewer", role: "viewer",
        status: "active", createdAt: now, updatedAt: now,
      });
    });
    await expect(t.withIdentity({ subject: "viewer" }).query(api.integrations.listProviderCredentials, { organizationId: alpha.organizationId })).rejects.toThrow("not_found_or_forbidden");
  });
});

/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
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
      executionGeneration: 0, queuePriority: 0,
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
    expect(result.map((organization: { slug: string }) => organization.slug)).toEqual(["alpha"]);
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

describe("Convex review state integrity", () => {
  it("replays a persisted workflow checkpoint idempotently", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTenant(t, "alpha", "alice");
    const args = {
      organizationId: seeded.organizationId, reviewId: seeded.reviewId,
      expectedHeadSha: "a".repeat(40), expectedGeneration: 0,
      stage: "context" as const, sequence: 1, now: 2,
    };
    const first = await t.mutation(internal.durableReview.checkpoint, args);
    const replay = await t.mutation(internal.durableReview.checkpoint, { ...args, now: 3 });
    expect(replay).toBe(first);
    const events = await t.run((ctx) => ctx.db.query("reviewEvents").collect());
    expect(events).toHaveLength(1);
  });

  it("preserves terminal status while allowing an independent stale marker", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTenant(t, "alpha", "alice");
    await t.mutation(internal.reviewState.transition, {
      reviewId: seeded.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0,
      to: "gathering_context", nextActionCode: "none", now: 2,
    });
    await t.mutation(internal.reviewState.transition, {
      reviewId: seeded.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0,
      to: "analyzing", nextActionCode: "none", now: 3,
    });
    await t.mutation(internal.reviewState.transition, {
      reviewId: seeded.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0,
      to: "validating", nextActionCode: "none", now: 4,
    });
    await t.mutation(internal.reviewState.transition, {
      reviewId: seeded.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0,
      to: "checks_passed", statusReasonCode: "checks_complete", nextActionCode: "none", now: 5,
    });
    await expect(t.mutation(internal.reviewState.transition, {
      reviewId: seeded.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0,
      to: "analyzing", nextActionCode: "none", now: 6,
    })).rejects.toThrow("invalid_transition");
    await t.mutation(internal.reviewState.markStale, {
      reviewId: seeded.reviewId, observedHeadSha: "c".repeat(40), now: 7,
    });
    const stored = await t.run((ctx) => ctx.db.get(seeded.reviewId));
    expect(stored).toMatchObject({ status: "checks_passed", isStale: true, observedHeadSha: "c".repeat(40) });
  });

  it("fences a worker immediately when cancellation is requested", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTenant(t, "alpha", "alice");
    const lease = await t.mutation(internal.reviewState.acquireLease, {
      reviewId: seeded.reviewId, workerId: "worker-1", now: 1, leaseMs: 100,
    });
    expect(lease.generation).toBe(0);
    await t.mutation(internal.reviewState.requestCancellation, {
      reviewId: seeded.reviewId, actorId: "alice", now: 2,
    });
    await expect(t.mutation(internal.reviewState.transition, {
      reviewId: seeded.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0,
      to: "gathering_context", nextActionCode: "none", now: 3,
    })).rejects.toThrow("cancelled_or_replaced");
  });

  it("enforces append-only event sequence numbers", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTenant(t, "alpha", "alice");
    await t.mutation(internal.reviewState.appendEvent, {
      organizationId: seeded.organizationId, reviewId: seeded.reviewId, sequence: 1,
      type: "review_created", stage: "queue", internalCode: "created", now: 1,
    });
    await expect(t.mutation(internal.reviewState.appendEvent, {
      organizationId: seeded.organizationId, reviewId: seeded.reviewId, sequence: 3,
      type: "stage_started", stage: "context", internalCode: "context", now: 2,
    })).rejects.toThrow("invalid_event_sequence");
  });

  it("allows only one active review per repository, PR, head, and mode", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTenant(t, "alpha", "alice");
    const duplicateReviewId = await t.run(async (ctx) => {
      const original = await ctx.db.get(seeded.reviewId);
      if (!original) throw new Error("missing fixture");
      const { _id: _ignoredId, _creationTime: _ignoredTime, ...copy } = original;
      return ctx.db.insert("reviews", copy);
    });
    await t.mutation(internal.reviewState.claimActiveReview, { reviewId: seeded.reviewId, now: 1 });
    await expect(t.mutation(internal.reviewState.claimActiveReview, { reviewId: duplicateReviewId, now: 2 })).rejects.toThrow("active_review_exists");
  });

  it("deduplicates identical side effects and rejects key reuse with new content", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTenant(t, "alpha", "alice");
    const args = {
      organizationId: seeded.organizationId, reviewId: seeded.reviewId,
      operationKey: "review:summary", type: "comment_update" as const, requestHash: "hash-1", now: 1,
    };
    const first = await t.mutation(internal.reviewState.reserveSideEffect, args);
    const replay = await t.mutation(internal.reviewState.reserveSideEffect, { ...args, now: 2 });
    expect(replay).toBe(first);
    await expect(t.mutation(internal.reviewState.reserveSideEffect, { ...args, requestHash: "hash-2", now: 3 })).rejects.toThrow("idempotency_key_conflict");
  });

  it("counts applied patches and validated rounds independently within hard bounds", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTenant(t, "alpha", "alice");
    await t.run((ctx) => ctx.db.patch(seeded.reviewId, { mode: "autofix", status: "autofix_queued" }));
    const attemptId = await t.mutation(internal.reviewState.recordAutofixAttempt, {
      organizationId: seeded.organizationId, reviewId: seeded.reviewId, attemptNumber: 1,
      patchFingerprint: "patch-1", outcome: "applied", promptVersion: "test", startedAt: 1, completedAt: 2,
    });
    await expect(t.mutation(internal.reviewState.recordAutofixRound, {
      organizationId: seeded.organizationId, reviewId: seeded.reviewId, roundNumber: 1,
      attemptId, candidateCommitSha: "d".repeat(40), validationScope: "affected_subset",
      validationOutcome: "passed", completedValidation: false, startedAt: 2,
    })).rejects.toThrow("round_requires_validation");
    await t.mutation(internal.reviewState.recordAutofixRound, {
      organizationId: seeded.organizationId, reviewId: seeded.reviewId, roundNumber: 1,
      attemptId, candidateCommitSha: "d".repeat(40), validationScope: "affected_subset",
      validationOutcome: "passed", completedValidation: true, startedAt: 2, completedAt: 3,
    });
    await expect(t.mutation(internal.reviewState.recordAutofixAttempt, {
      organizationId: seeded.organizationId, reviewId: seeded.reviewId, attemptNumber: 7,
      patchFingerprint: "patch-7", outcome: "empty", promptVersion: "test", startedAt: 4,
    })).rejects.toThrow("attempt_out_of_bounds");
  });
});

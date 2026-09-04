import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const head = "a".repeat(40);

// Automatic review spends the customer's own key without anyone asking, so every one of these is a
// reason not to start one. The debounce is the third: a burst of pushes settles on one head, and a
// review already covering that head means the burst has already been answered.
async function seed(t: ReturnType<typeof convexTest>, over: Record<string, unknown> = {}) {
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
      forkPolicy: "manual_review_only", indexState: "ready", concurrencyLimit: 1, createdAt: now, updatedAt: now, ...over });
    return { organizationId, repositoryId };
  });
}


async function insertReview(t: ReturnType<typeof convexTest>, seeded: { organizationId: string; repositoryId: string }, over: Record<string, unknown>) {
  await t.run(async ctx => {
    const configArtifactId = await ctx.db.insert("artifacts", { organizationId: seeded.organizationId as never, repositoryId: seeded.repositoryId as never,
      type: "configuration", storageKey: "k", encrypted: true, checksum: "h", size: 1, redactionStatus: "redacted", expiresAt: 9e12, deletionAttempts: 0 });
    const configRevisionId = await ctx.db.insert("configRevisions", { organizationId: seeded.organizationId as never, repositoryId: seeded.repositoryId as never,
      sourceCommitSha: "b".repeat(40), sourceRef: "main", configArtifactId, contentHash: "c", rulesDigest: "r",
      schemaVersion: "1", validationState: "valid", provenance: "defaults_only", refProtectionState: "unverified", createdAt: 1 });
    await ctx.db.insert("reviews", { organizationId: seeded.organizationId as never, repositoryId: seeded.repositoryId as never,
      githubRepositoryId: 42, prNumber: 7, isFork: false, baseRef: "main", baseSha: "b".repeat(40), headSha: head,
      requiredCheckPolicy: "advisory", completedRoundCount: 0, patchAttemptCount: 0, diagnosticRunCount: 0,
      providerRetryCount: 0, commandRetryCount: 0, trigger: "automatic", triggerVerb: "review", triggerActor: "x",
      triggerActorPermission: "write", mode: "review", status: "queued", budgetLimit: 5, budgetConsumed: 0,
      nextActionCode: "none", isStale: false, trustedRef: "main", trustedRefSha: "b".repeat(40), configRevisionId,
      configProvenance: "defaults_only", provider: "anthropic", model: "m", modelVersion: "1", promptVersion: "1",
      evalSetVersion: "1", coverageLevel: "full", currentStage: "queue", runnerImageVersion: "i",
      executionGeneration: 0, queuePriority: 0, expiresAt: 9e12, createdAt: 1, updatedAt: 1, ...over });
  });
}

const ask = (t: ReturnType<typeof convexTest>) => t.query(internal.automaticReviewData.automaticEligibility,
  { installationId: 123, githubRepositoryId: 42, prNumber: 7, headSha: head });

describe("when an automatic review may start", () => {
  it("does not, until the repository opts in", async () => {
    const t = convexTest(schema, modules); await seed(t);
    expect(await ask(t)).toMatchObject({ eligible: false, reason: "manual_only" });
  });

  it("does once it has", async () => {
    const t = convexTest(schema, modules); await seed(t, { reviewTrigger: "automatic" });
    expect(await ask(t)).toMatchObject({ eligible: true });
  });

  it("does not while the pull request is paused", async () => {
    const t = convexTest(schema, modules); const seeded = await seed(t, { reviewTrigger: "automatic" });
    await t.mutation(internal.automaticReviewData.setPause, { ...seeded, prNumber: 7, paused: true, actor: "a", now: 2_000 });
    expect(await ask(t)).toMatchObject({ eligible: false, reason: "pull_request_paused" });

    await t.mutation(internal.automaticReviewData.setPause, { ...seeded, prNumber: 7, paused: false, actor: "a", now: 3_000 });
    expect(await ask(t)).toMatchObject({ eligible: true });
  });

  it("does not while a live review already covers this exact head", async () => {
    const t = convexTest(schema, modules); const seeded = await seed(t, { reviewTrigger: "automatic" });
    await insertReview(t, seeded, {});
    expect(await ask(t)).toMatchObject({ eligible: false, reason: "already_reviewing_this_head" });
  });

  it("does again once that review went stale, because the head moved on", async () => {
    const t = convexTest(schema, modules); const seeded = await seed(t, { reviewTrigger: "automatic" });
    await insertReview(t, seeded, { isStale: true });
    expect(await ask(t)).toMatchObject({ eligible: true });
  });

  it("does not when the repository itself is paused", async () => {
    const t = convexTest(schema, modules); await seed(t, { reviewTrigger: "automatic", pausedAt: 500 });
    expect(await ask(t)).toMatchObject({ eligible: false, reason: "repository_unavailable" });
  });
});

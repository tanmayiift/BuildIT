import { convexTest } from "convex-test";
import workpoolComponent from "@convex-dev/workpool/test";
import { describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { recordBaseAdvance } from "./reviewState";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const head = "a".repeat(40);
const base = "b".repeat(40);
const merged = "c".repeat(40);

type Seed = { organizationId: Id<"organizations">; repositoryId: Id<"repositories">; configRevisionId: Id<"configRevisions"> };

async function seed(t: ReturnType<typeof convexTest>): Promise<Seed> {
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
      storageKey: "k", encrypted: true, checksum: "h", size: 1, redactionStatus: "redacted", expiresAt: 9e12, deletionAttempts: 0 });
    const configRevisionId = await ctx.db.insert("configRevisions", { organizationId, repositoryId,
      sourceCommitSha: base, sourceRef: "main", configArtifactId, contentHash: "c", rulesDigest: "r",
      schemaVersion: "1", validationState: "valid", provenance: "defaults_only", refProtectionState: "unverified", createdAt: now });
    return { organizationId, repositoryId, configRevisionId };
  });
}

async function insertReview(t: ReturnType<typeof convexTest>, seeded: Seed, over: Record<string, unknown> = {}) {
  return t.run(async ctx => ctx.db.insert("reviews", {
    organizationId: seeded.organizationId, repositoryId: seeded.repositoryId, configRevisionId: seeded.configRevisionId,
    githubRepositoryId: 42, prNumber: 7, isFork: false, baseRef: "main", baseSha: base, headSha: head,
    requiredCheckPolicy: "advisory", completedRoundCount: 0, patchAttemptCount: 0, diagnosticRunCount: 0,
    providerRetryCount: 0, commandRetryCount: 0, trigger: "github_comment", triggerVerb: "review", triggerActor: "x",
    triggerActorPermission: "write", mode: "review", status: "analyzing", budgetLimit: 5, budgetConsumed: 0,
    nextActionCode: "none", isStale: false, trustedRef: "main", trustedRefSha: base,
    configProvenance: "defaults_only", provider: "anthropic", model: "m", modelVersion: "1", promptVersion: "1",
    evalSetVersion: "1", coverageLevel: "full", currentStage: "analysis", runnerImageVersion: "i",
    executionGeneration: 0, queuePriority: 0, expiresAt: 9e12, createdAt: 1, updatedAt: 1, ...over,
  }));
}

const scheduled = (t: ReturnType<typeof convexTest>) =>
  t.run(async ctx => ctx.db.system.query("_scheduled_functions").collect());

// Cancelling a review closed it in the database and did nothing on GitHub, so the acknowledgement
// check run it had already posted stayed in_progress on the head commit for good. Where an
// organization made "BuildIT / review" a required check, BuildIT itself was then the reason the
// pull request could not be merged, and no action in the product cleared it.
describe("a cancelled review resolves the check run it put up", () => {
  it("publishes a completed check run when a cancellation lands", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const reviewId = await insertReview(t, seeded);

    await t.mutation(internal.reviewState.requestCancellation, { reviewId, actorId: "actor", now: 2_000 });

    const jobs = await scheduled(t);
    const notice = jobs.find(job => job.name.includes("reviewPublicationWorker") && job.name.includes("acknowledge"));
    expect(notice, "cancelling a review scheduled no check-run update").toBeDefined();
    expect(notice!.args[0]).toMatchObject({ conclusion: "neutral", githubRepositoryId: 42, headSha: head });
    expect(String(notice!.args[0].title)).toContain("cancelled");
    expect(String(notice!.args[0].summary)).toContain(head);
    vi.useRealTimers();
  });

  it("says nothing while the review is only being asked to stop", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const reviewId = await insertReview(t, seeded, { workflowId: "wf_1" });

    await t.mutation(internal.reviewState.requestCancellation, { reviewId, actorId: "actor", now: 2_000 });

    const review = await t.run(ctx => ctx.db.get(reviewId));
    expect(review!.status).toBe("cancelling");
    expect((await scheduled(t)).filter(job => job.name.includes("acknowledge"))).toHaveLength(0);
    vi.useRealTimers();
  });

  it("resolves the run for a blocked review the sweeper gives up on", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    await insertReview(t, seeded, { status: "blocked", blockedReason: "queued", blockedSince: 1, blockedExpiresAt: 1_500 });

    await t.mutation(internal.reconcileWorker.sweep, { now: 2_000 });

    const notice = (await scheduled(t)).find(job => job.name.includes("acknowledge"));
    expect(notice, "an expired blocked review left its check run in progress").toBeDefined();
    expect(notice!.args[0]).toMatchObject({ conclusion: "neutral" });
    vi.useRealTimers();
  });
});

// A push to the default branch cancelled every in-flight review in the repository, so one routine
// merge killed every running review and nothing re-queued them. The base moving does not make the
// head commit's findings wrong; it makes them findings against an older base.
describe("a merge into the default branch does not kill the reviews running against it", () => {
  it("leaves the review running and records which base it is deciding against", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const reviewId = await insertReview(t, seeded);

    const result = await t.run(ctx => recordBaseAdvance(ctx, {
      repositoryId: seeded.repositoryId, organizationId: seeded.organizationId,
      branch: "main", afterSha: merged.toUpperCase(), now: 3_000,
    }));

    expect(result.driftedCount).toBe(1);
    const review = await t.run(ctx => ctx.db.get(reviewId));
    expect(review!.status).toBe("analyzing");
    expect(review!.isStale).toBe(false);
    expect(review!.completedAt).toBeUndefined();
    expect(review!.observedBaseSha).toBe(merged);
    expect(review!.baseAdvancedAt).toBe(3_000);
  });

  it("leaves a review targeting another branch alone", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const reviewId = await insertReview(t, seeded, { baseRef: "release/1.x" });

    const result = await t.run(ctx => recordBaseAdvance(ctx, {
      repositoryId: seeded.repositoryId, organizationId: seeded.organizationId,
      branch: "main", afterSha: merged, now: 3_000,
    }));

    expect(result.driftedCount).toBe(0);
    expect((await t.run(ctx => ctx.db.get(reviewId)))!.observedBaseSha).toBeUndefined();
  });

  it("tells the reader which base the verdict was reached against", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const reviewId = await insertReview(t, seeded);
    const ask = () => t.query(internal.reviewState.baseAdvance, { organizationId: seeded.organizationId, reviewId });

    expect(await ask()).toBeNull();
    await t.run(ctx => recordBaseAdvance(ctx, { repositoryId: seeded.repositoryId, organizationId: seeded.organizationId,
      branch: "main", afterSha: merged, now: 3_000 }));
    expect(await ask()).toMatchObject({ baseRef: "main", baseSha: base, observedBaseSha: merged });
  });
});

// The stuck-review sweeper measured how long ago the review row was CREATED, so a review that was
// progressing normally and a review that had not started because the step pool was full were both
// killed at two hours and told they had stopped responding.
describe("the stuck-review sweeper reaps on inactivity, not on age", () => {
  const threeHours = 3 * 60 * 60_000;

  it("leaves a review that checkpointed a minute ago alone", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const now = Date.now() + threeHours;
    const reviewId = await insertReview(t, seeded, { startedAt: 1, lastProgressAt: now - 60_000 });

    await t.mutation(internal.reconcileWorker.sweep, { now });

    expect((await t.run(ctx => ctx.db.get(reviewId)))!.status).toBe("analyzing");
  });

  it("still retires one that has gone quiet, and says so on the pull request", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const now = Date.now() + threeHours;
    const reviewId = await insertReview(t, seeded, { startedAt: 1, lastProgressAt: 2 });

    await t.mutation(internal.reconcileWorker.sweep, { now });

    const review = await t.run(ctx => ctx.db.get(reviewId));
    expect(review!.status).toBe("platform_failed");
    expect(review!.executionGeneration).toBe(1);
    expect((await scheduled(t)).some(job => job.name.includes("acknowledge"))).toBe(true);
    vi.useRealTimers();
  });
});

// The stage order was flipped to [context, validation, analysis] so validation evidence feeds the
// model, and the checkpoint's status mapping was left behind: the dashboard said "Reviewing code"
// while the sandbox ran the checks, and "Running checks" while the model reviewed.
describe("the checkpoint names the stage that runs next", () => {
  const checkpoint = (t: ReturnType<typeof convexTest>, seeded: Seed, reviewId: Id<"reviews">, stage: "context" | "validation" | "analysis", sequence: number) =>
    t.mutation(internal.durableReview.checkpoint, {
      organizationId: seeded.organizationId, reviewId, expectedHeadSha: head,
      expectedGeneration: 0, stage, sequence, now: 5_000 + sequence,
    });

  it("moves to the validation stage after context, not to analysis", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const reviewId = await insertReview(t, seeded, { status: "gathering_context", currentStage: "context" });
    await checkpoint(t, seeded, reviewId, "context", 2);
    expect((await t.run(ctx => ctx.db.get(reviewId)))!.status).toBe("validating");
  });

  it("moves to the analysis stage after validation", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const reviewId = await insertReview(t, seeded, { status: "validating", currentStage: "validation" });
    await checkpoint(t, seeded, reviewId, "validation", 3);
    expect((await t.run(ctx => ctx.db.get(reviewId)))!.status).toBe("analyzing");
  });

  // finalizeDecision refuses any other status, and the report is composed and published from there.
  it("hands the finished analysis to delivery in the status delivery expects", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const reviewId = await insertReview(t, seeded, { status: "analyzing", currentStage: "analysis" });
    await checkpoint(t, seeded, reviewId, "analysis", 4);
    const review = await t.run(ctx => ctx.db.get(reviewId));
    expect(review!.status).toBe("validating");
    expect(review!.currentStage).toBe("analysis");
  });

  it("stamps real time, because the workflow's own clock is synthetic", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const reviewId = await insertReview(t, seeded, { status: "gathering_context", currentStage: "context" });
    const before = Date.now();
    await checkpoint(t, seeded, reviewId, "context", 2);
    const review = await t.run(ctx => ctx.db.get(reviewId));
    expect(review!.updatedAt).toBe(5_002);
    expect(review!.lastProgressAt).toBeGreaterThanOrEqual(before);
  });
});

// An autofix run killed by its provider recorded the literal "platform_error" while computing the
// real reason and discarding it, and it could never reach the provider fallback that would have
// rescued the identical `@buildit review`.
describe("an autofix run killed by its provider", () => {
  const autofix = { mode: "autofix" as const, status: "validating" as const, currentStage: "analysis" as const };

  it("records why it died, not the catch-all", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const reviewId = await insertReview(t, seeded, autofix);

    await t.mutation(internal.reviewAutofixData.failPlatform, {
      organizationId: seeded.organizationId, reviewId, expectedHeadSha: head,
      expectedGeneration: 0, code: "rate_limited", now: 6_000,
    });

    expect((await t.run(ctx => ctx.db.get(reviewId)))!.statusReasonCode).toBe("provider_rate_limited");
  });

  it("publishes the failure when there is no second key to fall back to", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    // The publication runs on the workpool, so the component is real here: the point of this case
    // is that the enqueue happens rather than the run ending in silence.
    workpoolComponent.register(t, "reviewWorkpool");
    const seeded = await seed(t);
    const reviewId = await insertReview(t, seeded, { ...autofix, statusReasonCode: "provider_rate_limited", status: "platform_failed" });

    const outcome = await t.mutation(internal.durableReview.fallbackOrReport, {
      organizationId: seeded.organizationId, reviewId, expectedHeadSha: head, expectedGeneration: 0, now: 7_000,
    });

    expect(outcome).toBe("failure_published");
    expect(await t.run(ctx => ctx.db.query("reviews").collect())).toHaveLength(1);
    vi.useRealTimers();
  });

  it("restarts on the workspace's second key instead of stopping", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const reviewId = await insertReview(t, seeded, { ...autofix, statusReasonCode: "provider_rate_limited", status: "platform_failed" });
    await t.run(ctx => ctx.db.insert("providerCredentials", {
      organizationId: seeded.organizationId, credentialScopeId: "scope-1", provider: "openai",
      encryptedCiphertext: "x", nonce: "n", authTag: "t", aadDigest: "d", wrappedDataKey: "w", kmsKeyId: "k",
      envelopeVersion: 1, keyVersion: 1, maskedSuffix: "1234", availableModels: ["gpt-5.4-mini"],
      status: "valid", createdBy: "u", createdAt: 1, lastValidatedAt: 2,
    }));

    const outcome = await t.mutation(internal.durableReview.fallbackOrReport, {
      organizationId: seeded.organizationId, reviewId, expectedHeadSha: head, expectedGeneration: 0, now: 7_000,
    });

    expect(outcome).toBe("fallback_started");
    const reviews = await t.run(ctx => ctx.db.query("reviews").collect());
    const retry = reviews.find(item => item.parentReviewId === reviewId);
    expect(retry, "no replacement review was queued on the second provider").toBeDefined();
    expect(retry).toMatchObject({ provider: "openai", status: "queued", headSha: head, executionGeneration: 0 });
    vi.useRealTimers();
  });
});

// Publication used to be scheduled once with no retry, so a GitHub incident lasting longer than a
// few seconds turned a finished review into no output at all while the dashboard said it passed.
// Retries are bounded, so this is what the last one leaves behind.
describe("when publication has run out of attempts", () => {
  it("says so on the pull request rather than going quiet", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const reviewId = await insertReview(t, seeded, { status: "checks_passed", statusReasonCode: "checks_complete", completedAt: 8_000 });

    await t.mutation(internal.durableReview.publicationCompleted, {
      workId: "work_1" as never, result: { kind: "failed", error: "github_pull_503" },
      context: { reviewId, kind: "verdict" },
    });

    const notice = (await scheduled(t)).find(job => job.name.includes("acknowledge"));
    expect(notice, "a review that could never publish told the author nothing").toBeDefined();
    expect(notice!.args[0]).toMatchObject({ conclusion: "action_required", headSha: head });
    expect(String(notice!.args[0].summary)).toContain("No code was changed");
    const events = await t.run(ctx => ctx.db.query("reviewEvents").collect());
    expect(events.map(item => item.internalCode)).toContain("publication_gave_up");
    vi.useRealTimers();
  });

  it("stays silent when publication succeeded", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const reviewId = await insertReview(t, seeded, { status: "checks_passed", statusReasonCode: "checks_complete", completedAt: 8_000 });

    await t.mutation(internal.durableReview.publicationCompleted, {
      workId: "work_1" as never, result: { kind: "success", returnValue: { checkId: "1", commentId: "2" } },
      context: { reviewId, kind: "verdict" },
    });

    expect(await scheduled(t)).toHaveLength(0);
    expect(await t.run(ctx => ctx.db.query("reviewEvents").collect())).toHaveLength(0);
    vi.useRealTimers();
  });
});

// A review cancelled or superseded while the retries ran has already said so on that commit.
describe("the give-up notice does not talk over a cancellation", () => {
  it("stays quiet for a review that was cancelled while publication retried", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const reviewId = await insertReview(t, seeded, { status: "cancelled", statusReasonCode: "user_cancelled", completedAt: 8_000 });

    await t.mutation(internal.durableReview.publicationCompleted, {
      workId: "work_1" as never, result: { kind: "failed", error: "stale_or_replaced_review" },
      context: { reviewId, kind: "verdict" },
    });

    expect((await scheduled(t)).filter(job => job.name.includes("acknowledge"))).toHaveLength(0);
    const events = await t.run(ctx => ctx.db.query("reviewEvents").collect());
    expect(events.map(item => item.internalCode)).toContain("publication_gave_up");
    vi.useRealTimers();
  });
});

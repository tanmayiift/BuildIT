/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { summaryFixture } from "./testing/summaryFixture";
const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules), now = Date.now();
  const b = await summaryFixture(t, "integrity", now);
  await t.run(async ctx => {
    await ctx.db.patch(b.reviewId, { model: "claude-sonnet-4-5", status: "checks_passed", completedAt: now, budgetLimit: 0.01 });
    await ctx.db.insert("providerCredentials", { organizationId: b.organizationId, credentialScopeId: "test-credential", provider: "anthropic",
      encryptedCiphertext: "test-ciphertext", nonce: "test-nonce", authTag: "test-tag", aadDigest: "a".repeat(64), wrappedDataKey: "test-wrapped", kmsKeyId: "test-kms",
      envelopeVersion: 1, keyVersion: 1, maskedSuffix: "test", availableModels: ["claude-sonnet-4-5"], status: "valid", createdBy: "test", createdAt: now, lastValidatedAt: now });
  });
  return { t, b, now };
}
const stage = (b: Awaited<ReturnType<typeof summaryFixture>>, now: number) => ({
  organizationId: b.organizationId, reviewId: b.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0,
  stage: "findings" as const, provider: "anthropic" as const, model: "claude-sonnet-4-5", promptVersion: "v1", schemaVersion: "v1",
  finishReason: "tool_use", requestHash: "9".repeat(64), requestId: "paid-late", attempt: 1, outcome: "valid" as const, inputTokens: 1_000, outputTokens: 1_000, now,
});

describe("execution evidence always names the intended run", () => {
  it("Ask finds the latest completed run beyond ten commit-sorted older runs", async () => {
    const { t, b, now } = await fixture();
    await t.run(async ctx => {
      const { _id, _creationTime, ...review } = (await ctx.db.get(b.reviewId))!;
      for (let i = 0; i < 20; i++) await ctx.db.insert("reviews", { ...review, headSha: "f".repeat(40), createdAt: now - 1000 - i, completedAt: now - 1000 - i });
      // Recent pending attempts cannot hide the most recently completed evidence either.
      for (let i = 0; i < 20; i++) await ctx.db.insert("reviews", { ...review, status: "queued", headSha: "e".repeat(40), createdAt: now + i, completedAt: undefined });
    });
    expect(await t.query(internal.reviewAskData.askScope, { organizationId: b.organizationId, repositoryId: b.repositoryId, prNumber: 1, now })).toMatchObject({ reviewId: b.reviewId });
  });
  it("Ask does not answer from evidence made stale by a newer commit", async () => {
    const { t, b, now } = await fixture();
    await t.run(ctx => ctx.db.patch(b.reviewId, { isStale: true, staleSince: now }));
    expect(await t.query(internal.reviewAskData.askScope, { organizationId: b.organizationId, repositoryId: b.repositoryId, prNumber: 1, now })).toBeNull();
  });
  it("a paid legacy callback after cancellation preserves the cost and cancelled state", async () => {
    const { t, b, now } = await fixture();
    await t.run(ctx => ctx.db.patch(b.reviewId, { status: "cancelled", executionGeneration: 1, completedAt: now - 1 }));
    await t.mutation(internal.reviewModelData.recordStageRun, stage(b, now)).catch(() => undefined);
    expect(await t.run(ctx => ctx.db.query("usageLedger").collect())).toMatchObject([{ totalCostMicros: 90_000 }]);
    expect(await t.run(ctx => ctx.db.get(b.reviewId))).toMatchObject({ status: "cancelled", executionGeneration: 1, budgetConsumed: 0.09, completedAt: now - 1 });
    expect(await t.run(ctx => ctx.db.query("modelStageRuns").collect())).toMatchObject([{ runId: `${b.reviewId}:0000` }]);
  });
  it("a replay after 500 stage records does not add another charge", async () => {
    const { t, b, now } = await fixture();
    await t.run(async ctx => {
      await ctx.db.patch(b.reviewId, { status: "analyzing", completedAt: undefined, budgetLimit: 100 });
      for (let i = 0; i < 500; i++) await ctx.db.insert("modelStageRuns", {
        organizationId: b.organizationId, repositoryId: b.repositoryId, reviewId: b.reviewId, stage: "findings", provider: "anthropic", model: "claude-sonnet-4-5",
        promptVersion: "v1", schemaVersion: "v1", finishReason: "tool_use", requestHash: i.toString(16).padStart(64, "0"), requestId: `older-${i}`,
        attempt: 1, outcome: "valid", inputTokens: 1, outputTokens: 1, createdAt: now - 1000 - i,
      });
    });
    await t.mutation(internal.reviewModelData.recordStageRun, stage(b, now));
    await t.mutation(internal.reviewModelData.recordStageRun, stage(b, now));
    expect(await t.run(ctx => ctx.db.query("usageLedger").collect())).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.query("modelStageRuns").collect())).toHaveLength(501);
  });
});

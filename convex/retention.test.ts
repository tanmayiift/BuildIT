import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ignoredWebhookDeliveryRetentionMs } from "./lib/lifecycle";
import { outlivesReview, reviewCascade, reviewRetentionMs, usedRefreshTokenRetentionMs } from "./retention";
import schema from "./schema";
import { tablePolicies } from "./tablePolicy";
import { summaryFixture } from "./testing/summaryFixture";

const modules = import.meta.glob("./**/*.ts");
const day = 86_400_000;

// The rows here were write-only or spent and only grew. What matters as much as what is deleted is
// what is not: a token a signed-in browser will present next, a live session, a delivery whose
// replay must still read as a duplicate.
describe("what the retention sweep removes and what it keeps", () => {
  it("deletes spent and expired sign-in tokens, keeps the one a browser will use next", async () => {
    const t = convexTest(schema, modules), now = 100 * day;
    const ids = await t.run(async ctx => {
      const userId = await ctx.db.insert("users", {});
      const live = await ctx.db.insert("authSessions", { userId, expirationTime: now + 10 * day });
      const ended = await ctx.db.insert("authSessions", { userId, expirationTime: now - day });
      // Convex Auth's own shapes: unused tokens have no firstUsedTime.
      const current = await ctx.db.insert("authRefreshTokens", { sessionId: live, expirationTime: now + 30 * day });
      const justUsed = await ctx.db.insert("authRefreshTokens", { sessionId: live, expirationTime: now + 30 * day, firstUsedTime: now - 60_000 });
      const longUsed = await ctx.db.insert("authRefreshTokens", { sessionId: live, expirationTime: now + 30 * day, firstUsedTime: now - usedRefreshTokenRetentionMs - 1 });
      const expired = await ctx.db.insert("authRefreshTokens", { sessionId: live, expirationTime: now - 1 });
      const ofEnded = await ctx.db.insert("authRefreshTokens", { sessionId: ended, expirationTime: now + day });
      return { live, ended, current, justUsed, longUsed, expired, ofEnded };
    });
    const result = await t.mutation(internal.retention.sweep, { now });
    expect(result).toMatchObject({ sessions: 1, refreshTokens: 3 });
    const exists = (id: string) => t.run(async ctx => (await ctx.db.get(id as never)) !== null);
    expect(await exists(ids.live)).toBe(true);
    expect(await exists(ids.current)).toBe(true);
    // Inside a day it is still kept: a browser that refreshed a minute ago may retry with it.
    expect(await exists(ids.justUsed)).toBe(true);
    for (const gone of [ids.ended, ids.longUsed, ids.expired, ids.ofEnded]) expect(await exists(gone)).toBe(false);
  });

  it("purges stored deliveries nothing will read, and keeps the ones that guard against a replay", async () => {
    const t = convexTest(schema, modules), now = 100 * day;
    await t.run(async ctx => {
      const row = (deliveryId: string, event: string, disposition: "processed" | "rejected" | "ignored_bot", receivedAt: number) =>
        ctx.db.insert("webhookDeliveries", { deliveryId, event, action: "completed", signatureValid: true, disposition, status: "completed", receivedAt, expiresAt: receivedAt + 30 * day });
      await row("check", "check_run", "rejected", now - 60_000);
      await row("bot-old", "issue_comment", "ignored_bot", now - ignoredWebhookDeliveryRetentionMs - 1);
      await row("bot-new", "issue_comment", "ignored_bot", now - 60_000);
      await row("command", "issue_comment", "processed", now - 20 * day);
    });
    let cursor: string | null = null, deleted = 0;
    for (;;) {
      const page: { deleted: number; cursor: string; isDone: boolean } = await t.mutation(internal.retention.purgeUnreadDeliveries, { cursor, now });
      deleted += page.deleted; cursor = page.cursor;
      if (page.isDone) break;
    }
    expect(deleted).toBe(2);
    const kept = await t.run(async ctx => (await ctx.db.query("webhookDeliveries").collect()).map(row => row.deliveryId).sort());
    expect(kept).toEqual(["bot-new", "command"]);
  });
});

// Review history is kept 30 days, then goes with everything it owns (the owner's decision, 7 Oct).
const makeTest = () => convexTest(schema, modules);
type Test = ReturnType<typeof makeTest>;
describe("review history past thirty days", () => {
  it("names every table that holds a review's rows, as deleted with it or kept with a reason", () => {
    const naming = Object.entries(tablePolicies).filter(([table, policy]) => table !== "reviews" && (policy.parents as readonly string[]).includes("reviewId")).map(([table]) => table).sort();
    expect([...Object.keys(reviewCascade), ...Object.keys(outlivesReview)].sort()).toEqual(naming);
  });

  const now = 400 * day, old = now - reviewRetentionMs - day;
  async function review(t: Test, base: Awaited<ReturnType<typeof summaryFixture>>, over: { status: "checks_passed" | "queued"; updatedAt: number }) {
    return t.run(async ctx => {
      const { _id, _creationTime, ...copy } = (await ctx.db.get(base.reviewId))!;
      const reviewId = await ctx.db.insert("reviews", { ...copy, ...over, currentStage: over.status === "queued" ? "queue" : "complete" });
      const artifactId = await ctx.db.insert("artifacts", { organizationId: base.organizationId, repositoryId: base.repositoryId, reviewId, type: "review_message", storageKey: `artifacts/${base.organizationId}/${base.repositoryId}/${reviewId}/x/report`,
        encrypted: true, checksum: "a".repeat(64), size: 1, storageState: "stored", expiresAt: old + day, deletedAt: old + day, deletionAttempts: 1 });
      await ctx.db.insert("reviewEvents", { organizationId: base.organizationId, reviewId, sequence: 1, type: "review_created", stage: "queue", internalCode: "test", metadata: {}, createdAt: over.updatedAt });
      await ctx.db.insert("findings", { organizationId: base.organizationId, reviewId, fingerprintHmac: "f".repeat(64), category: "correctness", severity: "high", confidence: 0.9, blocking: true,
        contentArtifactId: artifactId, evidenceIds: [artifactId], pathHmac: "e".repeat(64), startLine: 1, endLine: 1, resolution: "open", createdAt: over.updatedAt, updatedAt: over.updatedAt, expiresAt: over.updatedAt + day });
      await ctx.db.insert("usageLedger", { organizationId: base.organizationId, repositoryId: base.repositoryId, reviewId, kind: "model_tokens", quantity: 1, unitCost: 8, totalCostMicros: 8_000, currency: "provider_billed", occurredAt: over.updatedAt });
      await ctx.db.insert("notificationFanouts", { organizationId: base.organizationId, reviewId, generation: 0, decisionStatus: "inconclusive", dedupeKey: `${reviewId}:0:inconclusive`, complete: true, createdAt: over.updatedAt });
      return { reviewId, artifactId };
    });
  }
  const rowsOf = (t: Test, reviewId: Id<"reviews">) => t.run(async ctx => ({
    review: await ctx.db.get(reviewId),
    events: (await ctx.db.query("reviewEvents").withIndex("by_review", q => q.eq("reviewId", reviewId)).collect()).length,
    findings: (await ctx.db.query("findings").withIndex("by_review_severity", q => q.eq("reviewId", reviewId)).collect()).length,
    ledger: (await ctx.db.query("usageLedger").withIndex("by_review", q => q.eq("reviewId", reviewId)).collect()).length,
    artifacts: (await ctx.db.query("artifacts").withIndex("by_review", q => q.eq("reviewId", reviewId)).collect()).length,
    fanouts: (await ctx.db.query("notificationFanouts").withIndex("by_dedupe_key", q => q.gte("dedupeKey", `${reviewId}:`).lt("dedupeKey", `${reviewId};`)).collect()).length,
  }));

  it("deletes a finished review older than thirty days with everything it owns, and nothing younger or unfinished", async () => {
    vi.useFakeTimers();
    try {
      const t = makeTest(), base = await summaryFixture(t, "retention", old);
      const expired = await review(t, base, { status: "checks_passed", updatedAt: old });
      const recent = await review(t, base, { status: "checks_passed", updatedAt: now - day });
      const running = await review(t, base, { status: "queued", updatedAt: old });
      // An object the cleanup worker has not yet proven gone keeps its review, and is expired so the
      // worker takes it on its next tick.
      const pending = await review(t, base, { status: "checks_passed", updatedAt: old });
      await t.run(ctx => ctx.db.patch(pending.artifactId, { deletedAt: undefined, expiresAt: now + day }));
      const usageMonth = await t.run(ctx => ctx.db.insert("usageMonths", { organizationId: base.organizationId, month: "1971-02", periodStart: 0, periodEnd: 1, estimatedMicros: 8_000, reservedMicros: 0,
        unknownInvocationCount: 0, legacyEstimatedMicros: 0, legacyUnknownCount: 0, legacyRows: 0, reconciliationComplete: true, createdAt: old, updatedAt: old }));

      await t.mutation(internal.retention.expireReviews, { now });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      expect(await rowsOf(t, expired.reviewId)).toEqual({ review: null, events: 0, findings: 0, ledger: 0, artifacts: 0, fanouts: 0 });
      expect(await rowsOf(t, recent.reviewId)).toMatchObject({ events: 1, findings: 1, ledger: 1, artifacts: 1, fanouts: 1 });
      expect((await rowsOf(t, running.reviewId)).review).not.toBeNull();
      expect((await rowsOf(t, pending.reviewId)).review).not.toBeNull();
      expect((await t.run(ctx => ctx.db.get(pending.artifactId)))?.expiresAt).toBeLessThan(now);
      // The month's billing total is not a review's row and survives it.
      expect(await t.run(ctx => ctx.db.get(usageMonth))).toMatchObject({ estimatedMicros: 8_000 });
    } finally { vi.useRealTimers(); }
  });
});

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { ignoredWebhookDeliveryRetentionMs } from "./lib/lifecycle";
import { usedRefreshTokenRetentionMs } from "./retention";
import schema from "./schema";

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

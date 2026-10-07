import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { ignoredWebhookDeliveryRetentionMs } from "./lib/lifecycle";
import { handledWebhookEvents } from "./lib/webhookEvents";

// What the database keeps only as long as something needs it. Everything here was write-only or
// spent - read by nothing after the moment it mattered - and grew with traffic: on 7 Oct 2026 the
// deployment held 1,488 refresh tokens for two users, 267 lock rows nothing read, and 5,564 webhook
// deliveries, most of them check events no handler looks at. Functionality, billing and analytics
// rows (reviews and their evidence, usage, invocations, audit) are not touched here.
//
// Every pass is bounded, so the sweep cannot itself become the expensive query it exists to avoid.
const sweepBatch = 500;

// A refresh token is single-use. Once used it is kept only so a replay inside Convex Auth's 10-second
// reuse window can be told apart from theft; a day later a replay of a deleted token is simply
// refused, which signs that client out rather than letting it in.
export const usedRefreshTokenRetentionMs = 86_400_000;
// A sign-in verifier lives for one OAuth round trip.
export const verifierRetentionMs = 86_400_000;

export const sweep = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const deleted = { sessions: 0, refreshTokens: 0, verifiers: 0, reviewLocks: 0 };

    for (const session of await ctx.db.query("authSessions").take(sweepBatch)) {
      if (session.expirationTime >= now) continue;
      const tokens = await ctx.db.query("authRefreshTokens").withIndex("sessionIdAndParentRefreshTokenId", q => q.eq("sessionId", session._id)).take(sweepBatch);
      for (const token of tokens) { await ctx.db.delete(token._id); deleted.refreshTokens += 1; }
      if (tokens.length < sweepBatch) { await ctx.db.delete(session._id); deleted.sessions += 1; }
    }

    for (const token of await ctx.db.query("authRefreshTokens").take(sweepBatch * 2)) {
      const spent = token.firstUsedTime !== undefined && token.firstUsedTime < now - usedRefreshTokenRetentionMs;
      if (token.expirationTime < now || spent) { await ctx.db.delete(token._id); deleted.refreshTokens += 1; }
    }

    for (const verifier of await ctx.db.query("authVerifiers").take(sweepBatch)) {
      if (verifier._creationTime < now - verifierRetentionMs) { await ctx.db.delete(verifier._id); deleted.verifiers += 1; }
    }

    // No longer written; emptied here, then the table is dropped from the schema.
    for (const lock of await ctx.db.query("reviewLocks").take(sweepBatch)) { await ctx.db.delete(lock._id); deleted.reviewLocks += 1; }

    return deleted;
  },
});

// Deliveries recorded before the webhook handler stopped storing what it ignores (7 Oct 2026) still
// carry the 30-day expiry every row used to get. This pages through them once and deletes the ones
// nothing will read: events no handler acts on, and deliveries ignored on arrival that are past the
// one-day window. Run it until isDone; new rows never need it.
export const purgeUnreadDeliveries = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const page = await ctx.db.query("webhookDeliveries").paginate({ cursor: args.cursor, numItems: sweepBatch });
    let deleted = 0;
    for (const delivery of page.page) {
      const unhandled = !handledWebhookEvents.has(delivery.event);
      const ignoredAndOld = delivery.disposition !== "processed" && delivery.receivedAt < now - ignoredWebhookDeliveryRetentionMs;
      if (unhandled || ignoredAndOld) { await ctx.db.delete(delivery._id); deleted += 1; }
    }
    return { deleted, cursor: page.continueCursor, isDone: page.isDone };
  },
});

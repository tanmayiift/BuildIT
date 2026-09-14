import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { localEmailCaptureConfig } from "../packages/operations/src/emailCaptureConfig";
import { decisionDigestEmail, decisionEmail, type DecisionEmail } from "../packages/operations/src/email";
import { emailDecision } from "./lib/queueNotification";
import { resolveNotificationRecipient } from "./lib/notificationRecipient";

const worker = makeFunctionReference<"action">("notificationWorker:captureBatch");
const startRef = makeFunctionReference<"mutation">("notificationOutbox:start");
const fanoutRef = makeFunctionReference<"mutation">("notificationOutbox:fanout");
const batchLimit = 25, leaseMs = 60_000, attemptLimit = 3;
const nextUtcDay = (now: number) => (Math.floor(now / 86_400_000) + 1) * 86_400_000;
const critical = new Set(["platform_failed", "budget_exhausted", "failed_after_three_rounds", "autofix_stopped"]);

export const fanout = internalMutation({
  args: { fanoutId: v.id("notificationFanouts"), now: v.number() },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.fanoutId);
    if (!event || event.complete) return;
    const review = await ctx.db.get(event.reviewId);
    if (!localEmailCaptureConfig(process.env) || !review || review.organizationId !== event.organizationId || review.isStale || review.executionGeneration !== event.generation || emailDecision(review) !== event.decisionStatus) {
      await ctx.db.patch(event._id, { complete: true }); return;
    }
    const page = await ctx.db.query("memberships").withIndex("by_org_status", q => q.eq("organizationId", event.organizationId).eq("status", "active")).paginate({ cursor: event.cursor ?? null, numItems: 50 });
    for (const member of page.page) {
      const recipient = await resolveNotificationRecipient(ctx.db, { organizationId: event.organizationId, repositoryId: review.repositoryId, userId: member.userId, now: args.now });
      if (!recipient) continue;
      const prefs = await ctx.db.query("notificationPreferences").withIndex("by_org_user", q => q.eq("organizationId", event.organizationId).eq("userId", member.userId)).unique();
      const dedupeKey = `${event.dedupeKey}:${member.userId}`;
      if (await ctx.db.query("notifications").withIndex("by_dedupe_key", q => q.eq("dedupeKey", dedupeKey)).unique()) continue;
      const digestMode = critical.has(event.decisionStatus) ? "immediate" : prefs!.digestMode;
      const dueAt = digestMode === "daily" ? nextUtcDay(args.now) : args.now;
      const notificationId = await ctx.db.insert("notifications", { organizationId: event.organizationId, userId: member.userId,
        type: event.decisionStatus === "budget_exhausted" ? "budget_exhausted" : "review_finished", channel: "email", reviewId: review._id,
        repositoryId: review.repositoryId, generation: event.generation, decisionStatus: event.decisionStatus, digestMode,
        deliveryStatus: "pending", dedupeKey, dueAt, createdAt: args.now });
      await ctx.scheduler.runAfter(Math.max(0, dueAt - args.now), startRef, { notificationId });
    }
    await ctx.db.patch(event._id, { complete: page.isDone, cursor: page.isDone ? undefined : page.continueCursor });
    if (!page.isDone) await ctx.scheduler.runAfter(0, fanoutRef, args);
  },
});

export const start = internalMutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const now = Date.now(), seed = await ctx.db.get(args.notificationId);
    if (!seed || seed.channel !== "email" || seed.deliveryStatus !== "pending" || seed.batchId || seed.dueAt === undefined) return;
    if (seed.dueAt > now) { await ctx.scheduler.runAfter(seed.dueAt - now, startRef, args); return; }
    if (!localEmailCaptureConfig(process.env)) { await ctx.db.patch(seed._id, { deliveryStatus: "suppressed", dueAt: undefined, failureCode: "capture_disconnected" }); return; }
    // Settled and claimed rows have no dueAt, keeping this range bounded even after years of history.
    const due = seed.digestMode === "daily" ? await ctx.db.query("notifications").withIndex("by_org_user_due", q => q.eq("organizationId", seed.organizationId).eq("userId", seed.userId).gte("dueAt", 0).lte("dueAt", now)).take(batchLimit) : [seed];
    const rows = due.filter(row => row.deliveryStatus === "pending" && !row.batchId && row.digestMode === seed.digestMode);
    const selected = [seed, ...rows.filter(row => row._id !== seed._id)].slice(0, batchLimit);
    const batchId = await ctx.db.insert("emailBatches", { organizationId: seed.organizationId, userId: seed.userId, notificationIds: selected.map(row => row._id), mode: seed.digestMode ?? "immediate", status: "pending", attempts: 0, dueAt: now, createdAt: now, updatedAt: now });
    for (const row of selected) await ctx.db.patch(row._id, { batchId, deliveryStatus: "processing", dueAt: undefined });
    await ctx.scheduler.runAfter(0, worker, { batchId });
  },
});

async function suppress(ctx: MutationCtx, row: Doc<"notifications">, code: string) {
  await ctx.db.patch(row._id, { deliveryStatus: "suppressed", dueAt: undefined, failureCode: code });
}
async function inputFor(ctx: MutationCtx, batch: Doc<"emailBatches">, id: Id<"notifications">, now: number, webOrigin: string): Promise<DecisionEmail | null> {
  const row = await ctx.db.get(id);
  if (!row || row.batchId !== batch._id || row.organizationId !== batch.organizationId || row.userId !== batch.userId || row.deliveryStatus !== "processing") return null;
  const review = row.reviewId ? await ctx.db.get(row.reviewId) : null;
  if (!review || !row.repositoryId || review.repositoryId !== row.repositoryId || review.organizationId !== batch.organizationId || review.executionGeneration !== row.generation || review.isStale || !row.decisionStatus || emailDecision(review) !== row.decisionStatus) { await suppress(ctx, row, "review_superseded"); return null; }
  const recipient = await resolveNotificationRecipient(ctx.db, { organizationId: row.organizationId, repositoryId: row.repositoryId, userId: row.userId, now });
  if (!recipient) { await suppress(ctx, row, "recipient_ineligible"); return null; }
  const repository = (await ctx.db.get(row.repositoryId))!;
  return { localCapture: true, recipient, status: row.decisionStatus, repository: `${repository.owner}/${repository.name}`, prNumber: review.prNumber, commit: review.headSha,
    url: `${webOrigin}/reviews/${review._id}`, githubUrl: `https://github.com/${repository.owner}/${repository.name}/pull/${review.prNumber}`, dedupeKey: `email-capture:${batch._id}` };
}

/** Claims a short lease and resolves the verified recipient only at the transport boundary. */
export const prepare = internalMutation({
  args: { batchId: v.id("emailBatches"), leaseKey: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now(), batch = await ctx.db.get(args.batchId);
    if (!batch || ["captured", "suppressed", "failed"].includes(batch.status) || batch.dueAt > now || (batch.status === "processing" && (batch.leaseExpiresAt ?? 0) > now)) return null;
    const config = localEmailCaptureConfig(process.env);
    if (!config || batch.attempts >= attemptLimit) {
      const failureCode = config ? "capture_attempts_exhausted" : "capture_disconnected";
      await ctx.db.patch(batch._id, { status: config ? "failed" : "suppressed", failureCode, updatedAt: now });
      for (const id of batch.notificationIds) { const row = await ctx.db.get(id); if (row?.batchId === batch._id && row.organizationId === batch.organizationId && row.userId === batch.userId) await ctx.db.patch(row._id, { deliveryStatus: config ? "failed" : "suppressed", failureCode }); }
      return null;
    }
    const inputs: DecisionEmail[] = [], ids: Id<"notifications">[] = [];
    for (const id of batch.notificationIds.slice(0, batchLimit)) { const input = await inputFor(ctx, batch, id, now, config.webOrigin); if (input) { inputs.push(input); ids.push(id); } }
    if (!inputs.length) { await ctx.db.patch(batch._id, { status: "suppressed", notificationIds: [], failureCode: "recipient_or_review_ineligible", updatedAt: now }); return null; }
    const key = `email-capture:${batch._id}`;
    const message = batch.mode === "daily" ? decisionDigestEmail(inputs, key) : decisionEmail(inputs[0]!);
    await ctx.db.patch(batch._id, { status: "processing", notificationIds: ids, attempts: batch.attempts + 1, leaseKey: args.leaseKey, leaseExpiresAt: now + leaseMs, updatedAt: now });
    // Recovery survives an action crash after claiming, including a lost capture receipt.
    await ctx.scheduler.runAfter(leaseMs + 1, worker, { batchId: batch._id });
    return { message, config };
  },
});

export const finish = internalMutation({
  args: { batchId: v.id("emailBatches"), leaseKey: v.string(), captureId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now(), batch = await ctx.db.get(args.batchId);
    if (!batch || batch.status !== "processing" || batch.leaseKey !== args.leaseKey) return;
    if (args.captureId && !/^[a-f0-9]{64}$/.test(args.captureId)) throw new Error("capture_receipt_invalid");
    const captured = Boolean(args.captureId), exhausted = batch.attempts >= attemptLimit;
    const status = captured ? "captured" as const : exhausted ? "failed" as const : "pending" as const;
    const dueAt = now + Math.min(60_000, 1000 * 2 ** batch.attempts);
    await ctx.db.patch(batch._id, { status, dueAt, leaseKey: undefined, leaseExpiresAt: undefined, captureId: args.captureId, capturedAt: captured ? now : undefined, failureCode: captured ? undefined : "capture_unavailable", updatedAt: now });
    for (const id of batch.notificationIds) { const row = await ctx.db.get(id); if (!row || row.batchId !== batch._id || row.organizationId !== batch.organizationId || row.userId !== batch.userId || row.deliveryStatus !== "processing") continue;
      await ctx.db.patch(id, { deliveryStatus: captured ? "captured" : exhausted ? "failed" : "processing", capturedAt: captured ? now : undefined, failureCode: captured ? undefined : "capture_unavailable" }); }
    if (!captured && !exhausted) await ctx.scheduler.runAfter(dueAt - now, worker, { batchId: batch._id });
  },
});

/** Called by organization erasure after the tombstone is committed. Safe to resume/replay. */
export const purgeDeletedOrganization = internalMutation({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const organization = await ctx.db.get(args.organizationId);
    if (organization && !organization.deletedAt) throw new Error("organization_not_deleted");
    const rows = [
      ...await ctx.db.query("notifications").withIndex("by_org_user_created", q => q.eq("organizationId", args.organizationId)).take(100),
      ...await ctx.db.query("notificationFanouts").withIndex("by_org_created", q => q.eq("organizationId", args.organizationId)).take(100),
      ...await ctx.db.query("emailBatches").withIndex("by_user_due", q => q.eq("organizationId", args.organizationId)).take(100),
      ...await ctx.db.query("notificationPreferences").withIndex("by_org_user", q => q.eq("organizationId", args.organizationId)).take(100),
    ];
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length) await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation">("notificationOutbox:purgeDeletedOrganization"), args);
    return { deleted: rows.length };
  },
});

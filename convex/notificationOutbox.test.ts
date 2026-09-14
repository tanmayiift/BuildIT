/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { summaryFixture } from "./testing/summaryFixture";
import { queueReviewNotification } from "./lib/queueNotification";

const modules = import.meta.glob("./**/*.ts");
const fanout = makeFunctionReference<"mutation">("notificationOutbox:fanout"), start = makeFunctionReference<"mutation">("notificationOutbox:start"), prepare = makeFunctionReference<"mutation">("notificationOutbox:prepare"), capture = makeFunctionReference<"action">("notificationWorker:captureBatch"), purge = makeFunctionReference<"mutation">("notificationOutbox:purgeDeletedOrganization");
const now = Date.UTC(2026, 8, 14, 12);
function localMode() { vi.stubEnv("BUILDIT_EMAIL_DELIVERY_MODE", "local_capture"); vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210"); vi.stubEnv("BUILDIT_EMAIL_CAPTURE_URL", "http://127.0.0.1:3219/capture"); vi.stubEnv("BUILDIT_WEB_ORIGIN", "http://127.0.0.1:3000"); vi.stubEnv("VERCEL", ""); vi.stubEnv("VERCEL_ENV", ""); }
async function setup(mode: "immediate" | "daily" = "immediate") {
  const t = convexTest(schema, modules), scope = await summaryFixture(t, "email-test", now);
  const userId = await t.run(async ctx => { const id = await ctx.db.insert("users", { name: "Test member", email: "member@example.com", emailVerificationTime: now - 1000 }); await ctx.db.insert("memberships", { organizationId: scope.organizationId, userId: id, role: "viewer", status: "active", createdAt: now, updatedAt: now }); await ctx.db.patch(scope.reviewId, { status: "analyzing" }); return id; });
  const member = t.withIdentity({ subject: `${userId}|test-session` });
  await member.mutation(api.notifications.updatePreferences, { organizationId: scope.organizationId, emailEnabled: true, digestMode: mode, mutedRepositoryIds: [], requestId: "email-consent-00001" });
  return { t, member, userId, ...scope };
}
async function enqueue(s: Awaited<ReturnType<typeof setup>>, status: "changes_requested" | "platform_failed" = "changes_requested") {
  await s.t.run(ctx => ctx.db.patch(s.reviewId, { status }));
  const fanoutId = await s.t.run(ctx => queueReviewNotification(ctx, s.reviewId, Date.now()));
  await s.t.mutation(fanout, { fanoutId, now: Date.now() });
  return (await s.t.run(ctx => ctx.db.query("notifications").collect()))[0]!;
}
function transport(fail = false) {
  const messages: Array<Record<string, string>> = [], receipts = new Map<string, string>();
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe("http://127.0.0.1:3219/capture"); expect(init?.redirect).toBe("error");
    if (fail) throw new Error("synthetic-secret-that-must-not-be-stored");
    const body = JSON.parse(String(init?.body)) as Record<string, string>, id = body.idempotencyKey!;
    if (!receipts.has(id)) { messages.push(body); receipts.set(id, createHash("sha256").update(id).digest("hex")); }
    return new Response(JSON.stringify({ kind: "captured", captureId: receipts.get(id), idempotencyKey: id }));
  });
  vi.stubGlobal("fetch", fetch); return { fetch, messages };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); localMode(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("local notification outbox", () => {
  it("runs an actual review transition through queue, fanout and capture once", async () => {
    const s = await setup(), mock = transport();
    await s.t.mutation(internal.reviewState.transition, { reviewId: s.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0, to: "platform_failed", statusReasonCode: "sandbox_unavailable", nextActionCode: "retry_review", now });
    const events = await s.t.run(ctx => ctx.db.query("notificationFanouts").collect()); expect(events).toHaveLength(1);
    await s.t.mutation(fanout, { fanoutId: events[0]!._id, now });
    const row = (await s.t.run(ctx => ctx.db.query("notifications").collect()))[0]!;
    await s.t.mutation(start, { notificationId: row._id });
    const batch = (await s.t.run(ctx => ctx.db.query("emailBatches").collect()))[0]!;
    await s.t.action(capture, { batchId: batch._id }); await s.t.action(capture, { batchId: batch._id });
    expect(mock.messages).toHaveLength(1); expect(mock.messages[0]!.html).toContain("No email was sent");
    const stored = (await s.t.run(ctx => ctx.db.get(row._id)))!;
    expect(stored.deliveryStatus).toBe("captured"); expect(stored.sentAt).toBeUndefined();
    expect(JSON.stringify(await s.t.run(async ctx => [...await ctx.db.query("notifications").collect(), ...await ctx.db.query("emailBatches").collect()]))).not.toContain("member@example.com");
  });
  it("runs scheduled work through the real worker into a durable local capture file", async () => {
    const { mkdtemp, readdir, rm } = await import("node:fs/promises"), { tmpdir } = await import("node:os"), { join } = await import("node:path");
    const { storeEmailCapture } = await import("../scripts/lib/email-capture.mjs");
    const directory = await mkdtemp(join(tmpdir(), "buildit-outbox-"));
    try {
      const s = await setup();
      vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => new Response(JSON.stringify(await storeEmailCapture(directory, JSON.parse(String(init.body)))))));
      await s.t.mutation(internal.reviewState.transition, { reviewId: s.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0, to: "platform_failed", statusReasonCode: "sandbox_unavailable", nextActionCode: "retry_review", now });
      // Keep wall time fixed while file IO completes; advancing all timers would expire the lease artificially.
      await s.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
      expect(await readdir(directory)).toHaveLength(1);
      expect((await s.t.run(ctx => ctx.db.query("notifications").collect()))[0]).toMatchObject({ deliveryStatus: "captured" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("deduplicates repeated review events and member fanout", async () => {
    const s = await setup(); await enqueue(s); await enqueue(s);
    expect(await s.t.run(ctx => ctx.db.query("notificationFanouts").collect())).toHaveLength(1);
    expect(await s.t.run(ctx => ctx.db.query("notifications").collect())).toHaveLength(1);
  });
  it.each(["consent", "membership", "address", "verification", "expiry", "mute", "repository", "installation", "organization", "generation"])("rechecks %s after queueing and suppresses the capture", async change => {
    const s = await setup(), row = await enqueue(s), mock = transport();
    await s.t.mutation(start, { notificationId: row._id });
    await s.t.run(async ctx => {
      const prefs = (await ctx.db.query("notificationPreferences").withIndex("by_org_user", q => q.eq("organizationId", s.organizationId).eq("userId", s.userId)).unique())!;
      if (change === "consent") await ctx.db.patch(prefs._id, { emailEnabled: false });
      if (change === "mute") await ctx.db.patch(prefs._id, { mutedRepositoryIds: [s.repositoryId] });
      if (change === "membership") { const membership = (await ctx.db.query("memberships").withIndex("by_org_user", q => q.eq("organizationId", s.organizationId).eq("userId", s.userId)).unique())!; await ctx.db.patch(membership._id, { status: "removed" }); }
      if (change === "address") await ctx.db.patch(s.userId, { email: "changed@example.com" });
      if (change === "verification") await ctx.db.patch(s.userId, { emailVerificationTime: undefined });
      if (change === "expiry") await ctx.db.patch(s.userId, { emailVerificationExpiresAt: now });
      if (change === "repository") await ctx.db.patch(s.repositoryId, { enabled: false });
      if (change === "installation") await ctx.db.patch(s.installationId, { status: "removed" });
      if (change === "organization") await ctx.db.patch(s.organizationId, { deletedAt: now });
      if (change === "generation") await ctx.db.patch(s.reviewId, { executionGeneration: 1 });
    });
    const batch = (await s.t.run(ctx => ctx.db.query("emailBatches").collect()))[0]!;
    await s.t.action(capture, { batchId: batch._id });
    expect(mock.fetch).not.toHaveBeenCalled(); expect(await s.t.run(ctx => ctx.db.get(row._id))).toMatchObject({ deliveryStatus: "suppressed" });
  });
  it("rejects wrong-tenant notification parents without resolving another recipient", async () => {
    const s = await setup(), row = await enqueue(s), foreign = await summaryFixture(s.t, "foreign-email", now), mock = transport();
    await s.t.run(ctx => ctx.db.patch(row._id, { reviewId: foreign.reviewId, repositoryId: foreign.repositoryId }));
    await s.t.mutation(start, { notificationId: row._id });
    const batch = (await s.t.run(ctx => ctx.db.query("emailBatches").collect()))[0]!;
    await s.t.action(capture, { batchId: batch._id }); expect(mock.fetch).not.toHaveBeenCalled();
  });
  it("groups daily updates at the next UTC midnight and keeps critical failures immediate", async () => {
    const s = await setup("daily"), first = await enqueue(s), mock = transport();
    const secondReviewId = await s.t.run(async ctx => { const { _id: _id, _creationTime: _created, ...review } = (await ctx.db.get(s.reviewId))!; return ctx.db.insert("reviews", { ...review, prNumber: 2 }); });
    await enqueue({ ...s, reviewId: secondReviewId });
    expect(first.dueAt).toBe(Date.UTC(2026, 8, 15));
    await s.t.mutation(start, { notificationId: first._id }); expect(await s.t.run(ctx => ctx.db.query("emailBatches").collect())).toHaveLength(0);
    vi.setSystemTime(first.dueAt!); await s.t.mutation(start, { notificationId: first._id });
    const batch = (await s.t.run(ctx => ctx.db.query("emailBatches").collect()))[0]!; expect(batch.notificationIds).toHaveLength(2);
    await s.t.action(capture, { batchId: batch._id }); expect(mock.messages[0]!.subject).toContain("2 updates");
    const criticalRow = await enqueue({ ...s, reviewId: secondReviewId }, "platform_failed");
    const rows = await s.t.run(ctx => ctx.db.query("notifications").collect());
    expect(rows.find(row => row.decisionStatus === "platform_failed")).toMatchObject({ digestMode: "immediate", dueAt: Date.now() });
    expect(criticalRow).toBeDefined();
  });
  it("retries transport failures a bounded number of times without storing error bodies", async () => {
    const s = await setup(), row = await enqueue(s), mock = transport(true);
    await s.t.mutation(start, { notificationId: row._id }); const batch = (await s.t.run(ctx => ctx.db.query("emailBatches").collect()))[0]!;
    for (let attempt = 0; attempt < 4; attempt++) { await s.t.action(capture, { batchId: batch._id }); vi.setSystemTime(Date.now() + 60_001); }
    expect(mock.fetch).toHaveBeenCalledTimes(3);
    const stored = await s.t.run(ctx => ctx.db.get(batch._id)); expect(stored).toMatchObject({ status: "failed", attempts: 3 }); expect(JSON.stringify(stored)).not.toContain("synthetic-secret");
  });
  it("uses a stable capture identity when a worker loses its receipt", async () => {
    const s = await setup(), row = await enqueue(s), mock = transport();
    await s.t.mutation(start, { notificationId: row._id }); const batch = (await s.t.run(ctx => ctx.db.query("emailBatches").collect()))[0]!;
    const first = await s.t.mutation(prepare, { batchId: batch._id, leaseKey: "first-worker" });
    await fetch(first.config.captureUrl, { method: "POST", redirect: "error", body: JSON.stringify(first.message) });
    vi.setSystemTime(now + 60_001); await s.t.action(capture, { batchId: batch._id });
    expect(mock.fetch).toHaveBeenCalledTimes(2); expect(mock.messages).toHaveLength(1);
    expect(await s.t.run(ctx => ctx.db.get(batch._id))).toMatchObject({ status: "captured" });
  });
  it("resumes bounded fanout beyond fifty members and captures every opted-in member", async () => {
    const s = await setup(), mock = transport();
    await s.t.run(async ctx => {
      const { emailConsentHash } = await import("./lib/notificationRecipient");
      for (let index = 0; index < 56; index++) {
        const email = `member${index}@example.com`, userId = await ctx.db.insert("users", { email, emailVerificationTime: now - 1 });
        await ctx.db.insert("memberships", { organizationId: s.organizationId, userId, role: "viewer", status: "active", createdAt: now, updatedAt: now });
        await ctx.db.insert("notificationPreferences", { organizationId: s.organizationId, userId, emailEnabled: true, emailConsentedAt: now, emailConsentedAddressHash: await emailConsentHash(s.organizationId, userId, email), digestMode: "immediate", mutedRepositoryIds: [], updatedAt: now });
      }
      await ctx.db.patch(s.reviewId, { status: "platform_failed" });
      await queueReviewNotification(ctx, s.reviewId, now);
    });
    await s.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
    expect(mock.messages).toHaveLength(57);
    expect((await s.t.run(ctx => ctx.db.query("notificationFanouts").collect()))[0]).toMatchObject({ complete: true });
  });
  it("splits a large daily digest into bounded batches without losing updates", async () => {
    const s = await setup("daily"), mock = transport();
    await s.t.run(async ctx => {
      const { _id: _id, _creationTime: _created, ...review } = (await ctx.db.get(s.reviewId))!;
      for (let index = 0; index < 27; index++) {
        const id = await ctx.db.insert("reviews", { ...review, prNumber: index + 1, status: "changes_requested" });
        await queueReviewNotification(ctx, id, now);
      }
    });
    await s.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
    expect(mock.messages).toHaveLength(0);
    vi.setSystemTime(Date.UTC(2026, 8, 15));
    for (const row of await s.t.run(ctx => ctx.db.query("notifications").collect())) await s.t.mutation(start, { notificationId: row._id });
    await s.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
    const batches = await s.t.run(ctx => ctx.db.query("emailBatches").collect());
    expect(batches.map(batch => batch.notificationIds.length).sort((a, b) => a - b)).toEqual([2, 25]);
    expect(batches.every(batch => batch.status === "captured")).toBe(true); expect(mock.messages).toHaveLength(2);
  });
  it("never activates capture on a hosted backend", async () => {
    const s = await setup(); vi.stubEnv("CONVEX_CLOUD_URL", "https://fixture.convex.cloud");
    expect(await s.t.run(ctx => queueReviewNotification(ctx, s.reviewId, now))).toBeNull();
    expect(await s.member.query(api.notifications.preferences, { organizationId: s.organizationId })).toMatchObject({ deliveryAvailable: false, captureAvailable: false });
  });
  it("purges only deleted-workspace metadata and tolerates queued work after erasure", async () => {
    const s = await setup(), row = await enqueue(s); await s.t.mutation(start, { notificationId: row._id });
    const foreign = await summaryFixture(s.t, "foreign-purge", now);
    await s.t.run(ctx => ctx.db.insert("notificationPreferences", { organizationId: foreign.organizationId, userId: "another-member", emailEnabled: false, digestMode: "immediate", mutedRepositoryIds: [], updatedAt: now }));
    await expect(s.t.mutation(purge, { organizationId: s.organizationId })).rejects.toThrow("organization_not_deleted");
    await s.t.run(ctx => ctx.db.patch(s.organizationId, { deletedAt: now })); await s.t.mutation(purge, { organizationId: s.organizationId });
    expect(await s.t.run(ctx => ctx.db.query("notifications").collect())).toHaveLength(0);
    expect(await s.t.run(ctx => ctx.db.query("emailBatches").collect())).toHaveLength(0);
    expect(await s.t.run(ctx => ctx.db.query("notificationFanouts").collect())).toHaveLength(0);
    expect(await s.t.run(ctx => ctx.db.query("notificationPreferences").collect())).toHaveLength(1);
    await expect(s.t.mutation(start, { notificationId: row._id })).resolves.toBeNull();
  });
});

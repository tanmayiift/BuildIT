import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { webhookDeliveryRetentionMs } from "./lib/lifecycle";

const modules = import.meta.glob("./**/*.ts");

// webhookDeliveries had no expiry and no sweep, so it grew with commit volume rather than review
// volume - every push, comment and label on every connected repository, kept forever. It reached
// 2,249 rows in production in a few days on one small installation.
//
// The floor is not arbitrary. All four reads are point lookups on deliveryId, which is the
// idempotency check that stops GitHub's retry from starting a second review of the same delivery.
// GitHub keeps its own delivery log for 30 days and allows a manual redelivery inside that window,
// so deleting our row sooner would let a replayed delivery read as new.

async function delivery(t: ReturnType<typeof convexTest>, receivedAt: number) {
  return t.run(async ctx => ctx.db.insert("webhookDeliveries", {
    deliveryId: `d-${receivedAt}`, event: "pull_request", action: "opened", signatureValid: true,
    disposition: "processed", status: "completed", receivedAt, expiresAt: receivedAt + webhookDeliveryRetentionMs,
  }));
}

describe("webhook delivery retention", () => {
  it("keeps a delivery inside GitHub's own 30-day redelivery window", async () => {
    const t = convexTest(schema, modules), now = 30 * 86_400_000 + 1_000_000;
    const recent = await delivery(t, now - 29 * 86_400_000);

    await t.mutation(internal.reconcileWorker.sweep, { now });

    expect(await t.run(async ctx => ctx.db.get(recent))).not.toBeNull();
  });

  it("deletes a delivery once GitHub could no longer replay it", async () => {
    const t = convexTest(schema, modules), now = 60 * 86_400_000;
    const old = await delivery(t, now - 31 * 86_400_000);

    await t.mutation(internal.reconcileWorker.sweep, { now });

    expect(await t.run(async ctx => ctx.db.get(old))).toBeNull();
  });

  // Convex orders an absent field before every number, so lt(now) on the by_expiry index matches
  // rows that have no expiresAt at all. Every delivery recorded before this field existed was
  // therefore claimable the moment the sweep shipped, whatever its age - and the sweep deleted
  // them, taking the dedupe backlog that stops a GitHub redelivery starting a second review.
  it("does not delete a legacy row that has no expiry yet", async () => {
    const t = convexTest(schema, modules), now = 60 * 86_400_000;
    const legacy = await t.run(async ctx => ctx.db.insert("webhookDeliveries", {
      deliveryId: "legacy-1", event: "pull_request", action: "opened", signatureValid: true,
      disposition: "processed", status: "completed", receivedAt: now - 60_000,
    }));

    await t.mutation(internal.reconcileWorker.sweep, { now });

    const row = await t.run(async ctx => ctx.db.get(legacy));
    expect(row).not.toBeNull();
    // Stamped from when it arrived, so it ages out on the same 30-day rule as everything else.
    expect(row?.expiresAt).toBe(now - 60_000 + webhookDeliveryRetentionMs);
  });

  it("deletes a legacy row once the stamp it was given has passed", async () => {
    const t = convexTest(schema, modules), now = 60 * 86_400_000;
    const legacy = await t.run(async ctx => ctx.db.insert("webhookDeliveries", {
      deliveryId: "legacy-2", event: "pull_request", action: "opened", signatureValid: true,
      disposition: "processed", status: "completed", receivedAt: now - 31 * 86_400_000,
    }));

    await t.mutation(internal.reconcileWorker.sweep, { now });
    await t.mutation(internal.reconcileWorker.sweep, { now });

    expect(await t.run(async ctx => ctx.db.get(legacy))).toBeNull();
  });

  it("stamps an expiry on every delivery it records, so nothing is unbounded", async () => {
    const t = convexTest(schema, modules);
    const rows = await t.run(async ctx => ctx.db.query("webhookDeliveries").collect());
    expect(rows.every(row => typeof row.expiresAt === "number")).toBe(true);
  });
});

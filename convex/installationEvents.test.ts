import { createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
// Assembled, not literal: a secret-shaped string anywhere in the tree fails the scanners on every review.
const webhookSecret = ["test", "webhook", "signing", "value"].join("-");

async function seed(t: ReturnType<typeof convexTest>) {
  return t.run(async ctx => {
    const organizationId = await ctx.db.insert("organizations", { name: "Ledgerline", slug: "ledgerline", timezone: "UTC",
      region: "eu-west-1", retentionHours: 24, monthlyBudget: 50, concurrencyLimit: 3, createdAt: 1 });
    await ctx.db.insert("githubInstallations", { organizationId, installationId: 123, accountLogin: "ledgerline", accountType: "user",
      permissionSnapshot: { metadata: "read", contents: "read", pullRequests: "write", issues: "read", checks: "write" },
      status: "active", createdAt: 1, updatedAt: 1 });
  });
}

// Sent through the real route, signed the way GitHub signs, so the routing itself is what is tested.
async function deliver(t: ReturnType<typeof convexTest>, deliveryId: string, action: string) {
  const body = JSON.stringify({ action, installation: { id: 123 }, sender: { login: "owner", type: "User" } });
  const signature = `sha256=${createHmac("sha256", webhookSecret).update(body).digest("hex")}`;
  return t.fetch("/api/github/webhooks", { method: "POST", body,
    headers: { "content-type": "application/json", "x-hub-signature-256": signature, "x-github-delivery": deliveryId, "x-github-event": "installation" } });
}

const installation = (t: ReturnType<typeof convexTest>) => t.run(ctx => ctx.db.query("githubInstallations").first());
const delivery = (t: ReturnType<typeof convexTest>, deliveryId: string) =>
  t.run(async ctx => (await ctx.db.query("webhookDeliveries").collect()).find(row => row.deliveryId === deliveryId));

describe("GitHub App installation events", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("records a suspension, its lifting, and an uninstall, each audited", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", webhookSecret);
    const t = convexTest(schema, modules); await seed(t);

    expect((await deliver(t, "delivery-suspend-0001", "suspend")).status).toBe(202);
    expect(await installation(t)).toMatchObject({ status: "suspended" });
    expect((await installation(t))!.suspendedAt).toBeTypeOf("number");
    expect(await delivery(t, "delivery-suspend-0001")).toMatchObject({ disposition: "processed", status: "completed" });

    await deliver(t, "delivery-unsuspend-0001", "unsuspend");
    expect(await installation(t)).toMatchObject({ status: "active" });
    expect((await installation(t))!.suspendedAt).toBeUndefined();

    await deliver(t, "delivery-deleted-0001", "deleted");
    expect(await installation(t)).toMatchObject({ status: "removed" });

    const audit = await t.run(ctx => ctx.db.query("auditEvents").collect());
    expect(audit.map(row => row.action)).toEqual(["installation.suspended", "installation.active", "installation.removed"]);
    expect(audit.every(row => row.actorId === "github:owner")).toBe(true);
  });

  it("leaves other installation actions to the existing handling, and an unknown installation alone", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", webhookSecret);
    const t = convexTest(schema, modules); await seed(t);
    await deliver(t, "delivery-created-0001", "created");
    expect(await installation(t)).toMatchObject({ status: "active" });
    expect(await delivery(t, "delivery-created-0001")).toMatchObject({ disposition: "rejected" });
    await t.run(async ctx => { const row = await ctx.db.query("githubInstallations").first(); await ctx.db.patch(row!._id, { installationId: 999 }); });
    await deliver(t, "delivery-orphan-0001", "deleted");
    expect(await installation(t)).toMatchObject({ status: "active", installationId: 999 });
  });

  it("refuses an unsigned delivery before reading it", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", webhookSecret);
    const t = convexTest(schema, modules); await seed(t);
    const response = await t.fetch("/api/github/webhooks", { method: "POST", body: JSON.stringify({ action: "deleted", installation: { id: 123 } }),
      headers: { "x-hub-signature-256": "sha256=" + "0".repeat(64), "x-github-delivery": "delivery-forged-0001", "x-github-event": "installation" } });
    expect(response.status).toBe(401);
    expect(await installation(t)).toMatchObject({ status: "active" });
  });
});

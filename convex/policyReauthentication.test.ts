import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const hash = "c".repeat(64);

// Every repository setting sat behind a fresh-GitHub-login check, so an admin who had been reading
// the page for ten minutes was bounced through OAuth to flip a select and then had to find their
// place again. Pausing a repository, choosing when reviews run and how loud they are are reversible
// in one click and already require an admin - the re-authentication was buying nothing and teaching
// people not to touch their settings.
//
// Approving a .buildit.yml is genuinely different: it is the only route to trusting a repository's
// own configuration, so it decides what a review believes rather than what it does. It keeps the
// stronger gate, and these tests hold the line in both directions.

async function seed(t: ReturnType<typeof convexTest>, lastAuthenticatedAt: number) {
  return t.run(async ctx => {
    const now = 1_000_000;
    const userId = await ctx.db.insert("users", { name: "Ada" } as never);
    const organizationId = await ctx.db.insert("organizations", { name: "Ledgerline", slug: "ledgerline", timezone: "UTC",
      region: "eu-west-1", retentionHours: 24, monthlyBudget: 50, concurrencyLimit: 3, planId: "trial",
      fingerprintKeyVersion: 1, createdAt: now });
    await ctx.db.insert("memberships", { organizationId, userId, role: "admin", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("userProfiles", { userId, githubLogin: "ada", githubUserId: 1, lastAuthenticatedAt, updatedAt: now } as never);
    const installationId = await ctx.db.insert("githubInstallations", { organizationId, installationId: 123,
      accountLogin: "ledgerline", accountType: "user",
      permissionSnapshot: { metadata: "read", contents: "read", pullRequests: "write", issues: "read", checks: "write" },
      status: "active", createdAt: now, updatedAt: now });
    const repositoryId = await ctx.db.insert("repositories", { organizationId, installationId, githubRepositoryId: 42,
      owner: "ledgerline", name: "api", defaultBranch: "main", enabled: true, autofixMode: "stacked",
      forkPolicy: "manual_review_only", indexState: "ready", concurrencyLimit: 1, createdAt: now, updatedAt: now });
    return { userId, organizationId, repositoryId };
  });
}

// Well outside the ten-minute window: a normal admin who has had the page open a while.
const stale = Date.now() - 60 * 60 * 1000;

const call = async (t: ReturnType<typeof convexTest>, seeded: Awaited<ReturnType<typeof seed>>, extra: Record<string, unknown>) =>
  t.withIdentity({ subject: seeded.userId }).mutation(api.repositoryConnections.setReviewPolicy, {
    organizationId: seeded.organizationId, repositoryId: seeded.repositoryId,
    paused: false, autofixMode: "stacked", requestId: crypto.randomUUID(), ...extra } as never);

describe("changing a repository's settings", () => {
  it("does not send an admin back through GitHub to pause a repository", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t, stale);
    await expect(call(t, seeded, { paused: true })).resolves.not.toThrow();

    const repository = await t.run(async ctx => ctx.db.get(seeded.repositoryId));
    expect(repository!.pausedAt).toBeTruthy();
  });

  it("does not ask again to change when reviews run, or how loud they are", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t, stale);
    await expect(call(t, seeded, { reviewTrigger: "automatic", reviewProfile: "thorough" })).resolves.not.toThrow();

    const repository = await t.run(async ctx => ctx.db.get(seeded.repositoryId));
    expect(repository).toMatchObject({ reviewTrigger: "automatic", reviewProfile: "thorough" });
  });
});

describe("approving a repository's own configuration", () => {
  it("still requires a recent GitHub login", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t, stale);
    await expect(call(t, seeded, { approvedConfigHash: hash })).rejects.toThrow("recent_reauthentication_required");
  });

  it("succeeds when the admin has just authenticated", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t, Date.now() - 30_000);
    await expect(call(t, seeded, { approvedConfigHash: hash })).resolves.not.toThrow();

    const repository = await t.run(async ctx => ctx.db.get(seeded.repositoryId));
    expect(repository!.approvedConfigHash).toBe(hash);
  });

  // The bypass worth guarding: sneaking an approval through alongside a harmless field.
  it("cannot be smuggled in beside a setting that does not need it", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t, stale);
    await expect(call(t, seeded, { paused: true, approvedConfigHash: hash }))
      .rejects.toThrow("recent_reauthentication_required");

    const repository = await t.run(async ctx => ctx.db.get(seeded.repositoryId));
    // Nothing was written at all - the whole mutation is refused, not just the approval.
    expect(repository!.approvedConfigHash).toBeUndefined();
    expect(repository!.pausedAt).toBeFalsy();
  });
});

describe("what did not change", () => {
  it("still requires an admin, recent login or not", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t, Date.now() - 30_000);
    await t.run(async ctx => {
      const membership = await ctx.db.query("memberships")
        .withIndex("by_org_user", q => q.eq("organizationId", seeded.organizationId).eq("userId", seeded.userId)).unique();
      await ctx.db.patch(membership!._id, { role: "developer" });
    });

    await expect(call(t, seeded, { paused: true })).rejects.toThrow();
  });
});

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Adding a repository in GitHub used to change nothing here. The App did not subscribe to
// installation_repositories, and the Repositories page only linked out to GitHub, so the only thing
// that ever re-read the list was the setup flow. A customer could grant access and watch BuildIT
// ignore it - which is how both launch demo repositories sat invisible after being added.
//
// Making the sync routine surfaced a bug that was harmless while it ran once. The reconciliation
// loop patched every known repository with `enabled: true, pausedAt: undefined`, so every sync
// un-paused every paused repository. A sync reflects ACCESS. It must never touch POLICY, and most
// of what follows exists to hold that distinction.

async function seed(t: ReturnType<typeof convexTest>, repositories: Array<Record<string, unknown>> = []) {
  return t.run(async ctx => {
    const now = 1_000;
    const organizationId = await ctx.db.insert("organizations", { name: "Ledgerline", slug: "ledgerline", timezone: "UTC",
      region: "eu-west-1", retentionHours: 24, monthlyBudget: 50, concurrencyLimit: 3, planId: "trial",
      fingerprintKeyVersion: 1, createdAt: now });
    const installationId = await ctx.db.insert("githubInstallations", { organizationId, installationId: 123,
      accountLogin: "ledgerline", accountType: "user",
      permissionSnapshot: { metadata: "read", contents: "read", pullRequests: "write", issues: "read", checks: "write" },
      status: "active", createdAt: now, updatedAt: now });
    for (const over of repositories) {
      await ctx.db.insert("repositories", { organizationId, installationId, githubRepositoryId: 1,
        owner: "ledgerline", name: "api", defaultBranch: "main", enabled: true, autofixMode: "stacked",
        forkPolicy: "manual_review_only", indexState: "ready", concurrencyLimit: 1,
        createdAt: now, updatedAt: now, ...over });
    }
    return { organizationId, installationId };
  });
}

const listRepositories = (t: ReturnType<typeof convexTest>) =>
  t.run(async ctx => ctx.db.query("repositories").collect());

const remote = (over: Record<string, unknown> = {}) => ({
  githubRepositoryId: 1, owner: "ledgerline", name: "api", defaultBranch: "main", visibility: "private" as const, ...over,
});

const sync = (t: ReturnType<typeof convexTest>, repositories: ReturnType<typeof remote>[], now = 5_000) =>
  t.mutation(internal.githubInstallationsData.syncInstallationRepositories, { installationId: 123, repositories, now });

describe("syncing the repositories an installation can see", () => {
  it("adds a repository that was granted in GitHub", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const result = await sync(t, [remote({ githubRepositoryId: 7, name: "web" })]);

    expect(result).toMatchObject({ synced: true, added: 1 });
    const stored = await listRepositories(t);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ githubRepositoryId: 7, name: "web", enabled: true });
  });

  it("disables a repository whose access was withdrawn, rather than deleting it", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [{ githubRepositoryId: 1 }]);
    await sync(t, []);

    const stored = await listRepositories(t);
    // The reviews and their evidence still belong to someone.
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ enabled: false });
  });

  it("updates the facts GitHub owns", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [{ githubRepositoryId: 1, name: "api", defaultBranch: "main" }]);
    await sync(t, [remote({ name: "api-renamed", defaultBranch: "trunk", visibility: "public" })]);

    expect((await listRepositories(t))[0]).toMatchObject({ name: "api-renamed", defaultBranch: "trunk", visibility: "public" });
  });
});

// The half that matters. A sync runs on a webhook nobody asked for, so anything it can overwrite,
// it will eventually overwrite at the worst moment.
describe("what a sync must never touch", () => {
  it("leaves a paused repository paused", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [{ githubRepositoryId: 1, pausedAt: 2_000 }]);
    await sync(t, [remote()]);

    expect((await listRepositories(t))[0]!.pausedAt).toBe(2_000);
  });

  it("leaves an approved configuration approved", async () => {
    const t = convexTest(schema, modules);
    const hash = "a".repeat(64);
    await seed(t, [{ githubRepositoryId: 1, approvedConfigHash: hash, approvedConfigBy: "user-1" }]);
    await sync(t, [remote()]);

    expect((await listRepositories(t))[0]).toMatchObject({ approvedConfigHash: hash, approvedConfigBy: "user-1" });
  });

  it("leaves every policy a team chose exactly as they left it", async () => {
    const t = convexTest(schema, modules);
    const policy = { reviewTrigger: "automatic" as const, autofixMode: "disabled" as const,
      reviewProfile: "thorough" as const, reviewPathFilters: ["!vendor/**"], changelogOnMerge: true };
    await seed(t, [{ githubRepositoryId: 1, ...policy }]);
    await sync(t, [remote()]);

    expect((await listRepositories(t))[0]).toMatchObject(policy);
  });

  it("does not resurrect a workspace for an installation nobody has claimed", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(internal.githubInstallationsData.syncInstallationRepositories,
      { installationId: 999, repositories: [remote()], now: 5_000 });

    // A webhook is not a person and must not be able to bring a workspace into existence.
    expect(result).toEqual({ synced: false });
    expect(await listRepositories(t)).toHaveLength(0);
  });

  it("does nothing for a suspended installation", async () => {
    const t = convexTest(schema, modules);
    const { installationId } = await seed(t);
    await t.run(async ctx => ctx.db.patch(installationId, { status: "suspended" }));

    expect(await sync(t, [remote()])).toEqual({ synced: false });
    expect(await listRepositories(t)).toHaveLength(0);
  });
});

describe("running a sync twice", () => {
  it("changes nothing the second time", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await sync(t, [remote()], 5_000);
    const first = await listRepositories(t);
    await sync(t, [remote()], 9_000);
    const second = await listRepositories(t);

    expect(second).toHaveLength(first.length);
    expect(second[0]!._id).toBe(first[0]!._id);
    expect(second[0]).toMatchObject({ enabled: true, githubRepositoryId: 1 });
  });

  it("re-enables a repository that was granted back, still paused if it was paused", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [{ githubRepositoryId: 1, pausedAt: 2_000 }]);
    await sync(t, []);
    expect((await listRepositories(t))[0]).toMatchObject({ enabled: false });

    await sync(t, [remote()], 9_000);
    const restored = (await listRepositories(t))[0]!;
    // enabled tracks access; paused tracks what a person decided.
    expect(restored.enabled).toBe(true);
    expect(restored.pausedAt).toBe(5_000);
  });
});

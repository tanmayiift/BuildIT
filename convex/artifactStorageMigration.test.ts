import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seed(t: ReturnType<typeof convexTest>, states: Array<Record<string, string>>) {
  return t.run(async ctx => {
    const now = Date.now();
    const organizationId = await ctx.db.insert("organizations", { name: "Ledgerline", slug: "ledgerline", timezone: "UTC",
      region: "eu-west-1", retentionHours: 24, monthlyBudget: 50, concurrencyLimit: 3, planId: "trial",
      fingerprintKeyVersion: 1, createdAt: now });
    const installationId = await ctx.db.insert("githubInstallations", { organizationId, installationId: 123,
      accountLogin: "ledgerline", accountType: "user",
      permissionSnapshot: { metadata: "read", contents: "read", pullRequests: "write", issues: "read", checks: "write" },
      status: "active", createdAt: now, updatedAt: now });
    const repositoryId = await ctx.db.insert("repositories", { organizationId, installationId, githubRepositoryId: 42,
      owner: "ledgerline", name: "api", defaultBranch: "main", enabled: true, autofixMode: "stacked",
      forkPolicy: "manual_review_only", indexState: "ready", concurrencyLimit: 1, createdAt: now, updatedAt: now });
    const ids = [];
    for (const state of states) ids.push(await ctx.db.insert("artifacts", { organizationId, repositoryId, type: "command_output", storageKey: `k/${ids.length}`, encrypted: true, checksum: "h", size: 1, expiresAt: now + 60_000, deletionAttempts: 0, ...state } as never));
    return ids;
  });
}

describe("moving artifacts off redactionStatus", () => {
  it("maps redacted to stored and pending to pending, removing the legacy field", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, [{ redactionStatus: "redacted" }, { redactionStatus: "pending" }, { storageState: "stored" }]);
    const result = await t.mutation(internal.artifactStorageMigration.run, {});
    expect(result).toEqual({ migrated: 2, done: true });
    const rows = await t.run(ctx => Promise.all(ids.map(id => ctx.db.get(id))));
    expect(rows.map(row => [row?.storageState, row?.redactionStatus])).toEqual([["stored", undefined], ["pending", undefined], ["stored", undefined]]);
  });

  it("keeps the newer field when a row was completed mid-deploy and carries both", async () => {
    // Inserted by the old code as pending, completed by the new code: storageState is the truth.
    const t = convexTest(schema, modules);
    const [id] = await seed(t, [{ redactionStatus: "pending", storageState: "stored" }]);
    await t.mutation(internal.artifactStorageMigration.run, {});
    const row = await t.run(ctx => ctx.db.get(id!));
    expect([row?.storageState, row?.redactionStatus]).toEqual(["stored", undefined]);
  });

  it("is a no-op the second time", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [{ redactionStatus: "redacted" }]);
    await t.mutation(internal.artifactStorageMigration.run, {});
    expect(await t.mutation(internal.artifactStorageMigration.run, {})).toEqual({ migrated: 0, done: true });
  });

  it("refuses a legacy rejected row rather than guessing what it became", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [{ redactionStatus: "rejected" }]);
    await expect(t.mutation(internal.artifactStorageMigration.run, {})).rejects.toThrow(/artifact_state_unmappable/);
  });
});

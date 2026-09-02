/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// The connected-state UI, the "connected" accessibility and product journeys, and the committed
// release screenshots were all rendered from connectedDesignFixture - a hardcoded client object.
// Those artefacts prove layout and nothing else: repositoryConnections:current, the query that
// actually decides what a signed-in customer sees, was exercised by none of them.
//
// This is the missing evidence: a signed-in identity against a seeded backend, driving the real
// query through every state the UI branches on.
async function seedWorkspace(t: ReturnType<typeof convexTest>, options: { installationStatus?: "active" | "suspended"; repositories?: number; enabled?: boolean } = {}) {
  return t.run(async ctx => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { githubUserId: 7001, githubLogin: "riya" });
    const organizationId = await ctx.db.insert("organizations", { name: "Ledgerline", slug: "ledgerline", timezone: "Asia/Kolkata",
      region: "eu-west-1", retentionHours: 24, monthlyBudget: 50, concurrencyLimit: 3, planId: "trial", fingerprintKeyVersion: 1, createdAt: now });
    await ctx.db.insert("memberships", { organizationId, userId, role: "owner", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("userPreferences", { userId, activeOrganizationId: organizationId, updatedAt: now });
    await ctx.db.insert("userProfiles", { userId, githubUserId: 7001, githubLogin: "riya", lastAuthenticatedAt: now, updatedAt: now });
    const installationId = await ctx.db.insert("githubInstallations", { organizationId, installationId: 5150, accountLogin: "ledgerline",
      accountType: "organization", permissionSnapshot: { metadata: "read", contents: "write", pullRequests: "write", issues: "read", checks: "write" },
      status: options.installationStatus ?? "active", createdAt: now, updatedAt: now });
    for (let index = 0; index < (options.repositories ?? 2); index += 1) {
      await ctx.db.insert("repositories", { organizationId, installationId, githubRepositoryId: 900 + index, owner: "ledgerline",
        name: index === 0 ? "billing-api" : `service-${index}`, defaultBranch: "main", visibility: "private",
        enabled: options.enabled ?? true, autofixMode: "stacked", forkPolicy: "manual_review_only", indexState: "ready",
        concurrencyLimit: 1, createdAt: now, updatedAt: now });
    }
    return { userId, organizationId };
  });
}

describe("connected workspace, from the backend rather than a fixture", () => {
  it("returns the real workspace to the identity that owns it", async () => {
    const t = convexTest(schema, modules);
    const { userId, organizationId } = await seedWorkspace(t);
    const connection = await t.withIdentity({ subject: `${userId}|session` }).query(api.repositoryConnections.current, {});

    expect(connection.state).toBe("connected");
    expect(connection.organization).toMatchObject({ id: organizationId, name: "Ledgerline", slug: "ledgerline", role: "owner", retentionHours: 24 });
    expect(connection.installations).toHaveLength(1);
    expect(connection.installations[0]).toMatchObject({ installationId: 5150, accountLogin: "ledgerline", status: "active" });
    expect(connection.repositories).toHaveLength(2);
    expect(connection.repositories[0]).toMatchObject({ owner: "ledgerline", name: "billing-api", defaultBranch: "main", autofixMode: "stacked", paused: false });
    // Nothing from the design fixture can appear in a real answer.
    expect(JSON.stringify(connection)).not.toContain("Northstar");
    expect(JSON.stringify(connection)).not.toContain("fixture-");
  });

  // Every state the connected UI branches on, driven by real data rather than a hardcoded object.
  it("reports installation_required when no installation exists", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedWorkspace(t);
    await t.run(async ctx => { for (const row of await ctx.db.query("githubInstallations").collect()) await ctx.db.delete(row._id); });
    await expect(t.withIdentity({ subject: `${userId}|session` }).query(api.repositoryConnections.current, {}))
      .resolves.toMatchObject({ state: "installation_required" });
  });

  it("reports installation_unavailable when the installation is suspended", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedWorkspace(t, { installationStatus: "suspended" });
    await expect(t.withIdentity({ subject: `${userId}|session` }).query(api.repositoryConnections.current, {}))
      .resolves.toMatchObject({ state: "installation_unavailable" });
  });

  it("reports no_repositories_selected when every repository is disabled", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedWorkspace(t, { enabled: false });
    await expect(t.withIdentity({ subject: `${userId}|session` }).query(api.repositoryConnections.current, {}))
      .resolves.toMatchObject({ state: "no_repositories_selected", repositories: [] });
  });

  it("shows a signed-out visitor nothing at all", async () => {
    const t = convexTest(schema, modules);
    await seedWorkspace(t);
    const connection = await t.query(api.repositoryConnections.current, {});
    expect(connection).toMatchObject({ state: "signed_out", organization: null, installations: [], repositories: [] });
  });

  // The step-up window the UI reads to decide whether a policy control is usable.
  it("carries the credential re-authentication deadline the UI depends on", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedWorkspace(t);
    const connection = await t.withIdentity({ subject: `${userId}|session` }).query(api.repositoryConnections.current, {});
    expect(connection.credentialReauthenticationExpiresAt).toBeGreaterThan(Date.now());
  });
});

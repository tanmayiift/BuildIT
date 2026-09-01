/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedMember(options: { verified?: boolean; installationAccount?: string } = {}) {
  const t = convexTest(schema, modules);
  const seeded = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: "Signed-in member",
      email: "member@example.com",
      ...(options.verified ? { emailVerificationTime: now - 1_000 } : {}),
    });
    const organizationId = await ctx.db.insert("organizations", {
      name: "Member workspace",
      slug: `member-workspace-${String(userId)}`,
      timezone: "UTC",
      region: "eu-west-1",
      retentionHours: 24,
      monthlyBudget: 10,
      concurrencyLimit: 1,
      planId: "test",
      fingerprintKeyVersion: 1,
      createdAt: now,
    });
    await ctx.db.insert("memberships", {
      organizationId,
      userId: String(userId),
      role: "developer",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const installationId = await ctx.db.insert("githubInstallations", {
      organizationId,
      installationId: 123,
      accountLogin: options.installationAccount ?? "different-github-owner",
      accountType: "user",
      permissionSnapshot: { metadata: "read", contents: "read", pullRequests: "write", issues: "read", checks: "write" },
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const repositoryId = await ctx.db.insert("repositories", {
      organizationId,
      installationId,
      githubRepositoryId: 456,
      owner: "different-github-owner",
      name: "fixture",
      defaultBranch: "main",
      visibility: "private",
      enabled: true,
      autofixMode: "stacked",
      forkPolicy: "manual_review_only",
      indexState: "ready",
      concurrencyLimit: 1,
      createdAt: now,
      updatedAt: now,
    });
    return { now, userId, organizationId, repositoryId };
  });
  const member = t.withIdentity({ subject: `${seeded.userId}|member-session` });
  return { t, member, ...seeded };
}

describe("tenant-safe notification recipients", () => {
  it("defaults customer email to off while delivery and verification are unavailable", async () => {
    const { member, organizationId } = await seedMember();
    await expect(member.query(api.notifications.preferences, { organizationId })).resolves.toMatchObject({
      emailEnabled: false,
      deliveryAvailable: false,
      recipient: { state: "verification_required" },
    });
  });

  it("does not accept email opt-in from an unverified signed-in user", async () => {
    const { member, organizationId } = await seedMember();
    await expect(member.mutation(api.notifications.updatePreferences, {
      organizationId,
      emailEnabled: true,
      digestMode: "immediate",
      mutedRepositoryIds: [],
      requestId: "notification-unverified-0001",
    })).rejects.toThrow("verified_email_required");
  });

  it("never exposes the GitHub App installation owner as the customer recipient", async () => {
    const { member, organizationId } = await seedMember({ installationAccount: "tanmayiift" });
    const preferences = await member.query(api.notifications.preferences, { organizationId });
    expect(JSON.stringify(preferences)).not.toContain("tanmayiift");
    expect(JSON.stringify(preferences)).not.toContain("different-github-owner");
  });

  it("resolves only the opted-in verified member in the exact organization", async () => {
    const { t, member, now, userId, organizationId, repositoryId } = await seedMember({ verified: true, installationAccount: "tanmayiift" });
    await member.mutation(api.notifications.updatePreferences, {
      organizationId,
      emailEnabled: true,
      digestMode: "immediate",
      mutedRepositoryIds: [],
      requestId: "notification-consent-0001",
    });
    const deliveryTime = Date.now() + 1_000;
    await expect(t.query(internal.notifications.resolveDecisionRecipient, { organizationId, repositoryId, userId: String(userId), now: deliveryTime })).resolves.toMatchObject({
      organizationId,
      repositoryId,
      userId: String(userId),
      email: "member@example.com",
    });
    const stored = await t.run(ctx => ctx.db.query("notificationPreferences").collect());
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain("member@example.com");
    expect(JSON.stringify(stored)).not.toContain("tanmayiift");
  });

  it("fails closed after membership removal, email-verification removal, or repository muting", async () => {
    const { t, member, now, userId, organizationId, repositoryId } = await seedMember({ verified: true });
    await member.mutation(api.notifications.updatePreferences, {
      organizationId,
      emailEnabled: true,
      digestMode: "immediate",
      mutedRepositoryIds: [],
      requestId: "notification-consent-0002",
    });
    const args = { organizationId, repositoryId, userId: String(userId), now: Date.now() + 1_000 };
    const membershipId = await t.run(async ctx => (await ctx.db.query("memberships").withIndex("by_org_user", q => q.eq("organizationId", organizationId).eq("userId", String(userId))).unique())!._id);
    await t.run(ctx => ctx.db.patch(membershipId, { status: "removed", updatedAt: now }));
    await expect(t.query(internal.notifications.resolveDecisionRecipient, args)).resolves.toBeNull();
    await t.run(async ctx => { await ctx.db.patch(membershipId, { status: "active", updatedAt: now }); await ctx.db.patch(userId, { emailVerificationTime: undefined }); });
    await expect(t.query(internal.notifications.resolveDecisionRecipient, args)).resolves.toBeNull();
    await t.run(ctx => ctx.db.patch(userId, { emailVerificationTime: now - 1_000 }));
    await member.mutation(api.notifications.updatePreferences, {
      organizationId,
      emailEnabled: true,
      digestMode: "immediate",
      mutedRepositoryIds: [repositoryId],
      requestId: "notification-mute-0001",
    });
    await expect(t.query(internal.notifications.resolveDecisionRecipient, args)).resolves.toBeNull();
  });

  it("rejects a repository from another organization even for an eligible member", async () => {
    const { t, member, now, userId, organizationId } = await seedMember({ verified: true });
    await member.mutation(api.notifications.updatePreferences, {
      organizationId,
      emailEnabled: true,
      digestMode: "immediate",
      mutedRepositoryIds: [],
      requestId: "notification-consent-0003",
    });
    const foreignRepositoryId = await t.run(async ctx => {
      const foreignOrganizationId = await ctx.db.insert("organizations", { name: "Foreign", slug: "foreign-notification", timezone: "UTC", region: "eu-west-1", retentionHours: 24, monthlyBudget: 10, concurrencyLimit: 1, planId: "test", fingerprintKeyVersion: 1, createdAt: now });
      const installationId = await ctx.db.insert("githubInstallations", { organizationId: foreignOrganizationId, installationId: 999, accountLogin: "foreign-owner", accountType: "user", permissionSnapshot: { metadata: "read", contents: "read", pullRequests: "write", issues: "read", checks: "write" }, status: "active", createdAt: now, updatedAt: now });
      return ctx.db.insert("repositories", { organizationId: foreignOrganizationId, installationId, githubRepositoryId: 999, owner: "foreign-owner", name: "private", defaultBranch: "main", visibility: "private", enabled: true, autofixMode: "stacked", forkPolicy: "manual_review_only", indexState: "ready", concurrencyLimit: 1, createdAt: now, updatedAt: now });
    });
    await expect(t.query(internal.notifications.resolveDecisionRecipient, { organizationId, repositoryId: foreignRepositoryId, userId: String(userId), now: Date.now() + 1_000 })).resolves.toBeNull();
  });
});

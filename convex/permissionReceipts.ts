import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";

export const current = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const [preference, profile] = await Promise.all([
      ctx.db.query("userPreferences").withIndex("by_user", q => q.eq("userId", userId)).unique(),
      ctx.db.query("userProfiles").withIndex("by_user", q => q.eq("userId", userId)).unique(),
    ]);
    if (!preference?.activeOrganizationId) return null;
    const [organization, membership] = await Promise.all([
      ctx.db.get(preference.activeOrganizationId),
      ctx.db.query("memberships").withIndex("by_org_user", q => q.eq("organizationId", preference.activeOrganizationId!).eq("userId", userId)).unique(),
    ]);
    if (!organization || organization.deletedAt || !membership || membership.status !== "active") return null;
    const installations = await ctx.db.query("githubInstallations").withIndex("by_org_status", q => q.eq("organizationId", organization._id)).collect();
    const activeInstallationIds = new Set(installations.filter(item => item.status === "active").map(item => item._id));
    const repositories = (await ctx.db.query("repositories").withIndex("by_org_enabled", q => q.eq("organizationId", organization._id)).collect()).filter(item => item.enabled && activeInstallationIds.has(item.installationId));
    const credentials = membership.role === "owner" || membership.role === "admin" ? await ctx.db.query("providerCredentials").withIndex("by_org_status", q => q.eq("organizationId", organization._id).eq("status", "valid")).collect() : [];
    return {
      identity: { login: profile?.githubLogin ?? "verified GitHub user", lastAuthenticatedAt: profile?.lastAuthenticatedAt },
      organization: { id: organization._id, name: organization.name, role: membership.role, region: organization.region, retentionHours: organization.retentionHours },
      installations: installations.map(item => ({ installationId: item.installationId, accountLogin: item.accountLogin, accountType: item.accountType, status: item.status, permissions: item.permissionSnapshot, lastSynchronizedAt: item.updatedAt })),
      repositories: repositories.map(item => ({ id: item._id, owner: item.owner, name: item.name, visibility: item.visibility ?? "unknown" as const, autofixMode: item.autofixMode })),
      credentials: credentials.map(item => ({ id: item._id, provider: item.provider, repositoryId: item.repositoryId, maskedSuffix: item.maskedSuffix, lastValidatedAt: item.lastValidatedAt, lastUsedAt: item.lastUsedAt })),
      boundaries: { sourceRegion: "eu-west-1" as const, maximumSourceRetentionHours: Math.min(168, organization.retentionHours), mergeAuthority: false, workflowWrite: false, repositoryAdministration: false },
    };
  },
});

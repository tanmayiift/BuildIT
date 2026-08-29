import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";

export const current = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { state: "signed_out" as const, organization: null, installations: [], repositories: [] };
    const preference = await ctx.db.query("userPreferences").withIndex("by_user", q => q.eq("userId", userId)).unique();
    if (!preference?.activeOrganizationId) return { state: "no_workspace" as const, organization: null, installations: [], repositories: [] };
    const membership = await ctx.db.query("memberships").withIndex("by_org_user", q => q.eq("organizationId", preference.activeOrganizationId!).eq("userId", userId)).unique();
    const organization = await ctx.db.get(preference.activeOrganizationId);
    if (!membership || membership.status !== "active" || !organization || organization.deletedAt) return { state: "no_workspace" as const, organization: null, installations: [], repositories: [] };
    const [installationDocs, repositoryDocs] = await Promise.all([
      ctx.db.query("githubInstallations").withIndex("by_org_status", q => q.eq("organizationId", organization._id)).collect(),
      ctx.db.query("repositories").withIndex("by_org_enabled", q => q.eq("organizationId", organization._id)).collect(),
    ]);
    const installations = installationDocs.map(item => ({ id: item._id, installationId: item.installationId, accountLogin: item.accountLogin, accountType: item.accountType, status: item.status, updatedAt: item.updatedAt }));
    const repositories = repositoryDocs.filter(item => item.enabled).map(item => ({ id: item._id, installationId: item.installationId, githubRepositoryId: item.githubRepositoryId, owner: item.owner, name: item.name, defaultBranch: item.defaultBranch, autofixMode: item.autofixMode, indexState: item.indexState, updatedAt: item.updatedAt }));
    const hasActiveInstallation = installationDocs.some(item => item.status === "active");
    const state = !installationDocs.length ? "installation_required" as const : !hasActiveInstallation ? "installation_unavailable" as const : !repositories.length ? "no_repositories_selected" as const : "connected" as const;
    return { state, organization: { id: organization._id, name: organization.name, slug: organization.slug, role: membership.role, region: organization.region, retentionHours: organization.retentionHours }, installations, repositories };
  },
});

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrganizationRole, requireRecentGitHubLogin } from "./lib/authz";
import { appendAuditEvent } from "./lib/audit";

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
    const [installationDocs, repositoryDocs, profile] = await Promise.all([
      ctx.db.query("githubInstallations").withIndex("by_org_status", q => q.eq("organizationId", organization._id)).collect(),
      ctx.db.query("repositories").withIndex("by_org_enabled", q => q.eq("organizationId", organization._id)).collect(),
      ctx.db.query("userProfiles").withIndex("by_user", q => q.eq("userId", userId)).unique(),
    ]);
    const installations = installationDocs.map(item => ({ id: item._id, installationId: item.installationId, accountLogin: item.accountLogin, accountType: item.accountType, status: item.status, updatedAt: item.updatedAt }));
    const activeInstallationIds = new Set(installationDocs.filter(item => item.status === "active").map(item => item._id));
    const repositories = repositoryDocs.filter(item => item.enabled && activeInstallationIds.has(item.installationId)).map(item => ({ id: item._id, installationId: item.installationId, githubRepositoryId: item.githubRepositoryId, owner: item.owner, name: item.name, defaultBranch: item.defaultBranch, visibility: item.visibility ?? "unknown" as const, autofixMode: item.autofixMode, reviewProfile: item.reviewProfile ?? "balanced", paused: Boolean(item.pausedAt), indexState: item.indexState, updatedAt: item.updatedAt }));
    const hasActiveInstallation = installationDocs.some(item => item.status === "active");
    const state = !installationDocs.length ? "installation_required" as const : !hasActiveInstallation ? "installation_unavailable" as const : !repositories.length ? "no_repositories_selected" as const : "connected" as const;
    return { state, organization: { id: organization._id, name: organization.name, slug: organization.slug, role: membership.role, region: organization.region, retentionHours: organization.retentionHours },
      credentialReauthenticationExpiresAt: profile?.lastAuthenticatedAt ? profile.lastAuthenticatedAt + 10 * 60 * 1000 : 0,
      installations, repositories };
  },
});

export const setReviewPolicy = mutation({
  args: { organizationId: v.id("organizations"), repositoryId: v.id("repositories"), paused: v.boolean(), autofixMode: v.union(v.literal("disabled"), v.literal("stacked")), reviewProfile: v.optional(v.union(v.literal("quiet"), v.literal("balanced"), v.literal("thorough"))), requestId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now(), actor = await requireOrganizationRole(ctx, args.organizationId, "admin");
    await requireRecentGitHubLogin(ctx, actor.userId, now);
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.organizationId !== args.organizationId || !repository.enabled) throw new ConvexError("not_found_or_forbidden");
    await ctx.db.patch(repository._id, { pausedAt: args.paused ? now : undefined, autofixMode: args.autofixMode, ...(args.reviewProfile ? { reviewProfile: args.reviewProfile } : {}), updatedAt: now });
    await appendAuditEvent(ctx, { organizationId: args.organizationId, actorId: actor.userId, action: "repository.policy_changed", resourceType: "repository", resourceId: repository._id, requestId: args.requestId, result: "allowed", createdAt: now });
  },
});

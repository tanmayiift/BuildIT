import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrganizationRole } from "./lib/authz";
import { appendAuditEvent } from "./lib/audit";

export const preferences = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const actor = await requireOrganizationRole(ctx, args.organizationId, "viewer");
    const saved = await ctx.db.query("notificationPreferences").withIndex("by_org_user", q => q.eq("organizationId", args.organizationId).eq("userId", actor.userId)).unique();
    return saved ? { emailEnabled: saved.emailEnabled, digestMode: saved.digestMode, mutedRepositoryIds: saved.mutedRepositoryIds, updatedAt: saved.updatedAt } : { emailEnabled: true, digestMode: "immediate" as const, mutedRepositoryIds: [], updatedAt: null };
  },
});

export const updatePreferences = mutation({
  args: { organizationId: v.id("organizations"), emailEnabled: v.boolean(), digestMode: v.union(v.literal("immediate"), v.literal("daily")), mutedRepositoryIds: v.array(v.id("repositories")), requestId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireOrganizationRole(ctx, args.organizationId, "viewer"), now = Date.now(), unique = [...new Set(args.mutedRepositoryIds)];
    for (const repositoryId of unique) { const repository = await ctx.db.get(repositoryId); if (!repository || repository.organizationId !== args.organizationId || !repository.enabled) throw new Error("not_found_or_forbidden"); }
    const saved = await ctx.db.query("notificationPreferences").withIndex("by_org_user", q => q.eq("organizationId", args.organizationId).eq("userId", actor.userId)).unique();
    if (saved) await ctx.db.patch(saved._id, { emailEnabled: args.emailEnabled, digestMode: args.digestMode, mutedRepositoryIds: unique, updatedAt: now });
    else await ctx.db.insert("notificationPreferences", { organizationId: args.organizationId, userId: actor.userId, emailEnabled: args.emailEnabled, digestMode: args.digestMode, mutedRepositoryIds: unique, updatedAt: now });
    await appendAuditEvent(ctx, { organizationId: args.organizationId, actorId: actor.userId, action: "notification.preferences_changed", resourceType: "notification_preferences", resourceId: actor.userId, requestId: args.requestId, result: "allowed", createdAt: now });
  },
});

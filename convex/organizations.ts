import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireOrganizationRole, requireUserId } from "./lib/authz";

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active"))
      .collect();
    const organizations = await Promise.all(memberships.map((membership) => ctx.db.get(membership.organizationId)));
    return organizations.filter((organization) => organization && !organization.deletedAt).map((organization) => ({
      id: organization!._id, name: organization!.name, slug: organization!.slug,
      timezone: organization!.timezone, region: organization!.region,
      role: memberships.find((membership) => membership.organizationId === organization!._id)!.role,
    }));
  },
});

export const active = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const preference = await ctx.db.query("userPreferences").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (!preference?.activeOrganizationId) return null;
    const membership = await ctx.db.query("memberships").withIndex("by_org_user", (q) =>
      q.eq("organizationId", preference.activeOrganizationId!).eq("userId", userId)).unique();
    if (!membership || membership.status !== "active") return null;
    const organization = await ctx.db.get(preference.activeOrganizationId);
    if (!organization || organization.deletedAt) return null;
    return { id: organization._id, name: organization.name, slug: organization.slug, role: membership.role };
  },
});

export const selectActive = mutation({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const { userId } = await requireOrganizationRole(ctx, args.organizationId, "viewer");
    const existing = await ctx.db.query("userPreferences").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (existing) await ctx.db.patch(existing._id, { activeOrganizationId: args.organizationId, updatedAt: Date.now() });
    else await ctx.db.insert("userPreferences", { userId, activeOrganizationId: args.organizationId, updatedAt: Date.now() });
    return args.organizationId;
  },
});

export const clearActive = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db.query("userPreferences").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (existing) await ctx.db.patch(existing._id, { activeOrganizationId: undefined, updatedAt: Date.now() });
  },
});

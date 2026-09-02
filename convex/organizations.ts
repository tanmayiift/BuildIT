import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireOrganizationRole, requireUserId } from "./lib/authz";
import { appendAuditEvent } from "./lib/audit";

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

// monthlyBudget and concurrencyLimit became enforceable this session, and nothing could set them:
// every organization was stuck on whatever it was seeded with, with no operator or owner path to
// change it. A limit that cannot be raised is an outage waiting for the first customer who needs
// more than the default.
export const setCapacityLimits = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    concurrencyLimit: v.optional(v.number()),
    monthlyBudget: v.optional(v.number()),
    actorId: v.string(),
    requestId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const organization = await ctx.db.get(args.organizationId);
    if (!organization || organization.deletedAt) throw new ConvexError("not_found_or_forbidden");
    // 0 means "no limit" for both fields, so it is a legal value; anything negative or
    // non-finite is a mistake that would silently disable the cap.
    const valid = (value: number | undefined) => value === undefined || (Number.isFinite(value) && value >= 0);
    if (!valid(args.concurrencyLimit) || !valid(args.monthlyBudget)) throw new ConvexError("capacity_limit_invalid");
    if (args.concurrencyLimit === undefined && args.monthlyBudget === undefined) throw new ConvexError("capacity_limit_invalid");
    await ctx.db.patch(args.organizationId, {
      ...(args.concurrencyLimit === undefined ? {} : { concurrencyLimit: args.concurrencyLimit }),
      ...(args.monthlyBudget === undefined ? {} : { monthlyBudget: args.monthlyBudget }),
    });
    // Capacity is a spend control, so a change to it belongs in the audit chain.
    await appendAuditEvent(ctx, {
      organizationId: args.organizationId, actorId: args.actorId, action: "organization.capacity_changed",
      resourceType: "organization", resourceId: args.organizationId, requestId: args.requestId,
      result: "allowed", createdAt: args.now,
    });
    const updated = await ctx.db.get(args.organizationId);
    return { concurrencyLimit: updated!.concurrencyLimit, monthlyBudget: updated!.monthlyBudget };
  },
});

import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireOrganizationRole, requireRecentGitHubLogin, requireUserId } from "./lib/authz";
import { appendAuditEvent } from "./lib/audit";
import { platformMonthlySandboxSeconds, sandboxCeilingSeconds } from "./lib/sandboxCeiling";

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
export const updateCapacity = mutation({
  args: {
    organizationId: v.id("organizations"),
    concurrencyLimit: v.optional(v.number()),
    monthlyBudget: v.optional(v.number()),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requireOrganizationRole(ctx, args.organizationId, "owner");
    await requireRecentGitHubLogin(ctx, access.userId);
    const now = Date.now();
    const valid = (value: number | undefined) => value === undefined || (Number.isFinite(value) && value >= 0);
    if (!valid(args.concurrencyLimit) || !valid(args.monthlyBudget)) throw new ConvexError("capacity_limit_invalid");
    if (args.concurrencyLimit === undefined && args.monthlyBudget === undefined) throw new ConvexError("capacity_limit_invalid");
    // A ceiling nobody can raise is an outage; one anybody can raise without limit is a bill.
    if ((args.concurrencyLimit ?? 0) > 50 || (args.monthlyBudget ?? 0) > 5_000) throw new ConvexError("capacity_limit_invalid");
    await ctx.db.patch(args.organizationId, {
      ...(args.concurrencyLimit === undefined ? {} : { concurrencyLimit: args.concurrencyLimit }),
      ...(args.monthlyBudget === undefined ? {} : { monthlyBudget: args.monthlyBudget }),
    });
    await appendAuditEvent(ctx, {
      organizationId: args.organizationId, actorId: access.userId, action: "organization.capacity_changed",
      resourceType: "organization", resourceId: args.organizationId, requestId: args.requestId,
      result: "allowed", createdAt: now,
    });
    const updated = await ctx.db.get(args.organizationId);
    return { concurrencyLimit: updated!.concurrencyLimit, monthlyBudget: updated!.monthlyBudget };
  },
});

// monthlySandboxSeconds is settable here and deliberately not on updateCapacity above. The other
// two limits bound what a tenant spends on its own provider key and how much of its own capacity
// it holds, so an owner raising them costs nobody else anything. The sandbox allowance is a slice
// of a provider quota BuildIT buys once and every tenant draws on, so a tenant that could raise
// its own slice could take the whole thing - the cap would be decorative. Raising it is an
// operator decision, and the audit row records who made it.
export const setCapacityLimits = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    concurrencyLimit: v.optional(v.number()),
    monthlyBudget: v.optional(v.number()),
    monthlySandboxSeconds: v.optional(v.number()),
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
    if (!valid(args.concurrencyLimit) || !valid(args.monthlyBudget) || !valid(args.monthlySandboxSeconds)) throw new ConvexError("capacity_limit_invalid");
    if (args.concurrencyLimit === undefined && args.monthlyBudget === undefined && args.monthlySandboxSeconds === undefined) throw new ConvexError("capacity_limit_invalid");
    // The platform's whole monthly sandbox allowance (platformMonthlySandboxSeconds). An operator
    // may hand one tenant the lot, but not more than exists - a ceiling above the platform's is not a
    // ceiling, and the request is far more likely to be a units mistake than an intent.
    if ((args.monthlySandboxSeconds ?? 0) > platformMonthlySandboxSeconds) throw new ConvexError("capacity_limit_invalid");
    await ctx.db.patch(args.organizationId, {
      ...(args.concurrencyLimit === undefined ? {} : { concurrencyLimit: args.concurrencyLimit }),
      ...(args.monthlyBudget === undefined ? {} : { monthlyBudget: args.monthlyBudget }),
      ...(args.monthlySandboxSeconds === undefined ? {} : { monthlySandboxSeconds: args.monthlySandboxSeconds }),
    });
    // Capacity is a spend control, so a change to it belongs in the audit chain.
    await appendAuditEvent(ctx, {
      organizationId: args.organizationId, actorId: args.actorId, action: "organization.capacity_changed",
      resourceType: "organization", resourceId: args.organizationId, requestId: args.requestId,
      result: "allowed", createdAt: args.now,
    });
    const updated = await ctx.db.get(args.organizationId);
    return { concurrencyLimit: updated!.concurrencyLimit, monthlyBudget: updated!.monthlyBudget,
      monthlySandboxSeconds: sandboxCeilingSeconds(updated!) };
  },
});

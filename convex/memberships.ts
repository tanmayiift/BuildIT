import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrganizationRole, requireRecentGitHubLogin, requireUserId, type AppRole } from "./lib/authz";
import { appendAuditEvent } from "./lib/audit";
import { role } from "./validators";
import type { Id } from "./_generated/dataModel";

const rank: Record<AppRole, number> = { viewer: 0, developer: 1, admin: 2, owner: 3 };

async function assertCanManage(actorRole: AppRole, targetRole: AppRole) {
  if (actorRole === "owner") return;
  if (actorRole !== "admin" || rank[targetRole] >= rank.admin) throw new ConvexError("not_found_or_forbidden");
}

async function assertOwnerRemains(ctx: Parameters<typeof requireUserId>[0], organizationId: Parameters<typeof requireOrganizationRole>[1], membershipId: string) {
  const owners = (await ctx.db.query("memberships").withIndex("by_org_status", q => q.eq("organizationId", organizationId).eq("status", "active")).collect())
    .filter(item => item.role === "owner" && item._id !== membershipId);
  if (owners.length === 0) throw new ConvexError("last_owner_required");
}

export const list = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireOrganizationRole(ctx, args.organizationId, "viewer");
    const active = await ctx.db.query("memberships").withIndex("by_org_status", q => q.eq("organizationId", args.organizationId).eq("status", "active")).collect();
    const invited = await ctx.db.query("memberships").withIndex("by_org_status", q => q.eq("organizationId", args.organizationId).eq("status", "invited")).collect();
    return [...active, ...invited].map(item => ({ id: item._id, userId: item.userId, role: item.role, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt }));
  },
});

export const invite = mutation({
  args: { organizationId: v.id("organizations"), targetUserId: v.id("users"), role, requestId: v.string() },
  handler: async (ctx, args) => {
    if (args.role === "owner") throw new ConvexError("owner_invitation_forbidden");
    const now = Date.now();
    const actor = await requireOrganizationRole(ctx, args.organizationId, "admin");
    await requireRecentGitHubLogin(ctx, actor.userId, now);
    await assertCanManage(actor.role, args.role);
    const target = await ctx.db.get(args.targetUserId);
    if (!target) throw new ConvexError("member_not_found");
    const existing = await ctx.db.query("memberships").withIndex("by_org_user", q => q.eq("organizationId", args.organizationId).eq("userId", args.targetUserId)).unique();
    if (existing?.status === "active") throw new ConvexError("membership_already_active");
    const membershipId = existing?._id ?? await ctx.db.insert("memberships", { organizationId: args.organizationId, userId: args.targetUserId, role: args.role, status: "invited", createdAt: now, updatedAt: now });
    if (existing) await ctx.db.patch(existing._id, { role: args.role, status: "invited", updatedAt: now });
    await appendAuditEvent(ctx, { organizationId: args.organizationId, actorId: actor.userId, action: "membership.invited", resourceType: "membership", resourceId: membershipId, requestId: args.requestId, result: "allowed", createdAt: now });
    return membershipId;
  },
});

export const accept = mutation({
  args: { organizationId: v.id("organizations"), requestId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx); const now = Date.now();
    const membership = await ctx.db.query("memberships").withIndex("by_org_user", q => q.eq("organizationId", args.organizationId).eq("userId", userId)).unique();
    if (!membership || membership.status !== "invited") throw new ConvexError("invitation_not_found");
    await ctx.db.patch(membership._id, { status: "active", updatedAt: now });
    await appendAuditEvent(ctx, { organizationId: args.organizationId, actorId: userId, action: "membership.accepted", resourceType: "membership", resourceId: membership._id, requestId: args.requestId, result: "allowed", createdAt: now });
    return membership._id;
  },
});

export const changeRole = mutation({
  args: { organizationId: v.id("organizations"), membershipId: v.id("memberships"), role, requestId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now(); const actor = await requireOrganizationRole(ctx, args.organizationId, "admin");
    await requireRecentGitHubLogin(ctx, actor.userId, now);
    const member = await ctx.db.get(args.membershipId);
    if (!member || member.organizationId !== args.organizationId || member.status !== "active") throw new ConvexError("not_found_or_forbidden");
    await assertCanManage(actor.role, member.role); await assertCanManage(actor.role, args.role);
    if (member.role === "owner" && args.role !== "owner") await assertOwnerRemains(ctx, args.organizationId, member._id);
    await ctx.db.patch(member._id, { role: args.role, updatedAt: now });
    await appendAuditEvent(ctx, { organizationId: args.organizationId, actorId: actor.userId, action: "membership.role_changed", resourceType: "membership", resourceId: member._id, requestId: args.requestId, result: "allowed", createdAt: now });
  },
});

export const remove = mutation({
  args: { organizationId: v.id("organizations"), membershipId: v.id("memberships"), requestId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now(); const actor = await requireOrganizationRole(ctx, args.organizationId, "admin");
    await requireRecentGitHubLogin(ctx, actor.userId, now);
    const member = await ctx.db.get(args.membershipId);
    if (!member || member.organizationId !== args.organizationId || member.status === "removed") throw new ConvexError("not_found_or_forbidden");
    await assertCanManage(actor.role, member.role);
    if (member.role === "owner" && member.status === "active") await assertOwnerRemains(ctx, args.organizationId, member._id);
    await ctx.db.patch(member._id, { status: "removed", updatedAt: now });
    await appendAuditEvent(ctx, { organizationId: args.organizationId, actorId: actor.userId, action: "membership.removed", resourceType: "membership", resourceId: member._id, requestId: args.requestId, result: "allowed", createdAt: now });
  },
});

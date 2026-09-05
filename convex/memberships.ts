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
    return Promise.all([...active, ...invited].map(async item => {
      const user = await ctx.db.get(item.userId as Id<"users">), profile = user ? await ctx.db.query("userProfiles").withIndex("by_user", q => q.eq("userId", user._id)).unique() : null;
      return { id: item._id, userId: item.userId, name: user?.name ?? null, githubLogin: profile?.githubLogin ?? null, role: item.role, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt };
    }));
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
    // Also check the role already on the invite, not only the requested one: an admin must not
    // be able to rewrite an invite an owner issued.
    if (existing) await assertCanManage(actor.role, existing.role);
    if (existing) await ctx.db.patch(existing._id, { role: args.role, status: "invited", updatedAt: now });
    await appendAuditEvent(ctx, { organizationId: args.organizationId, actorId: actor.userId, action: "membership.invited", resourceType: "membership", resourceId: membershipId, requestId: args.requestId, result: "allowed", createdAt: now });
    return membershipId;
  },
});

export const inviteByGitHubLogin = mutation({
  args: { organizationId: v.id("organizations"), githubLogin: v.string(), role, requestId: v.string() },
  handler: async (ctx, args) => {
    const githubLogin = args.githubLogin.trim();
    if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(githubLogin)) throw new ConvexError("github_login_invalid");
    if (args.role === "owner") throw new ConvexError("owner_invitation_forbidden");
    const now = Date.now(), actor = await requireOrganizationRole(ctx, args.organizationId, "admin");
    await requireRecentGitHubLogin(ctx, actor.userId, now);
    await assertCanManage(actor.role, args.role);
    const profile = await ctx.db.query("userProfiles").withIndex("by_github_login", q => q.eq("githubLogin", githubLogin)).unique();
    if (!profile) throw new ConvexError("member_must_sign_in_first");
    const existing = await ctx.db.query("memberships").withIndex("by_org_user", q => q.eq("organizationId", args.organizationId).eq("userId", profile.userId)).unique();
    if (existing?.status === "active") throw new ConvexError("membership_already_active");
    const membershipId = existing?._id ?? await ctx.db.insert("memberships", { organizationId: args.organizationId, userId: profile.userId, role: args.role, status: "invited", createdAt: now, updatedAt: now });
    // Also check the role already on the invite, not only the requested one: an admin must not
    // be able to rewrite an invite an owner issued.
    if (existing) await assertCanManage(actor.role, existing.role);
    if (existing) await ctx.db.patch(existing._id, { role: args.role, status: "invited", updatedAt: now });
    await appendAuditEvent(ctx, { organizationId: args.organizationId, actorId: actor.userId, action: "membership.invited", resourceType: "membership", resourceId: membershipId, requestId: args.requestId, result: "allowed", createdAt: now });
    return membershipId;
  },
});

// An admin could send an invitation and nobody could ever open it. `accept` was written,
// authorized, policy-declared and unit-tested; organizations:listMine filters to status "active",
// so an invited user signed in and saw no trace of the invitation anywhere in the product, and
// customer email delivery is switched off, so nothing told them either. Every invitation BuildIT
// has ever sent was a dead end while the admin's screen said it had worked.
//
// Deliberately not gated on organization membership: an invited user is by definition not yet a
// member of the organization they need to read here, which is the shape that made this invisible
// to the reachability guard as well - the mutation had a caller in tests and none in the product.
export const listInvitations = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const invitations = await ctx.db.query("memberships")
      .withIndex("by_user_status", q => q.eq("userId", userId).eq("status", "invited")).collect();
    const rows = await Promise.all(invitations.map(async membership => {
      const organization = await ctx.db.get(membership.organizationId);
      return organization && !organization.deletedAt
        ? { organizationId: organization._id, name: organization.name, slug: organization.slug, role: membership.role, invitedAt: membership.createdAt ?? membership.updatedAt }
        : null;
    }));
    return rows.filter((row): row is NonNullable<typeof row> => row !== null);
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

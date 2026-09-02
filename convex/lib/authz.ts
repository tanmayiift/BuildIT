import { ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export type AppRole = "owner" | "admin" | "developer" | "viewer";
type Ctx = QueryCtx | MutationCtx;
const rank: Record<AppRole, number> = { viewer: 0, developer: 1, admin: 2, owner: 3 };
const recentWindowMs = 10 * 60 * 1000;

export async function requireUserId(ctx: Ctx): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("authentication_required");
  return userId;
}

export async function requireOrganizationRole(
  ctx: Ctx,
  organizationId: Id<"organizations">,
  minimum: AppRole,
): Promise<{ userId: string; role: AppRole }> {
  const userId = await requireUserId(ctx);
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_org_user", (q) => q.eq("organizationId", organizationId).eq("userId", userId))
    .unique();
  if (!membership || membership.status !== "active" || rank[membership.role] < rank[minimum]) {
    throw new ConvexError("not_found_or_forbidden");
  }
  // A deleted organization authorizes nothing. Five of eleven callers re-checked this themselves
  // and six did not, which is how an invariant ends up half-enforced.
  const organization = await ctx.db.get(organizationId);
  if (!organization || organization.deletedAt) throw new ConvexError("not_found_or_forbidden");
  return { userId, role: membership.role };
}

export async function requireRepositoryRole(
  ctx: Ctx,
  repositoryId: Id<"repositories">,
  minimum: AppRole,
  expectedOrganizationId?: Id<"organizations">,
) {
  const repository = await ctx.db.get(repositoryId);
  if (!repository || (expectedOrganizationId && repository.organizationId !== expectedOrganizationId)) {
    throw new ConvexError("not_found_or_forbidden");
  }
  const installation = await ctx.db.get(repository.installationId);
  if (!installation || installation.organizationId !== repository.organizationId || installation.status !== "active") {
    throw new ConvexError("not_found_or_forbidden");
  }
  const access = await requireOrganizationRole(ctx, repository.organizationId, minimum);
  return { ...access, repository, installation };
}

export async function requireRecentGitHubLogin(ctx: Ctx, userId: string, now = Date.now()) {
  const profile = await ctx.db.query("userProfiles").withIndex("by_user", q => q.eq("userId", userId as Id<"users">)).unique();
  if (!profile?.lastAuthenticatedAt || profile.lastAuthenticatedAt > now + 5_000 || now - profile.lastAuthenticatedAt > recentWindowMs) {
    throw new ConvexError("recent_reauthentication_required");
  }
}

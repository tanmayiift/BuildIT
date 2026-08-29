import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export type AppRole = "owner" | "admin" | "developer" | "viewer";
type Ctx = QueryCtx | MutationCtx;
const rank: Record<AppRole, number> = { viewer: 0, developer: 1, admin: 2, owner: 3 };

export async function requireUserId(ctx: Ctx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("authentication_required");
  return identity.subject;
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
  return { userId, role: membership.role };
}

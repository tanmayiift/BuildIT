import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

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
    }));
  },
});

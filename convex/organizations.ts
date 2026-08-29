import { query } from "./_generated/server";

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user_status", (q) => q.eq("userId", identity.subject).eq("status", "active"))
      .collect();
    const organizations = await Promise.all(memberships.map((membership) => ctx.db.get(membership.organizationId)));
    return organizations.filter((organization) => organization && !organization.deletedAt).map((organization) => ({
      id: organization!._id, name: organization!.name, slug: organization!.slug,
      timezone: organization!.timezone, region: organization!.region,
    }));
  },
});

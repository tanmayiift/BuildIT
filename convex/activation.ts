import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrganizationRole } from "./lib/authz";

export const funnel = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireOrganizationRole(ctx, args.organizationId, "viewer");
    const [repositories, credentials, reviews, audits, reviewEvents] = await Promise.all([
      ctx.db.query("repositories").withIndex("by_org_enabled", q => q.eq("organizationId", args.organizationId).eq("enabled", true)).collect(),
      ctx.db.query("providerCredentials").withIndex("by_org_status", q => q.eq("organizationId", args.organizationId).eq("status", "valid")).collect(),
      ctx.db.query("reviews").withIndex("by_org_status", q => q.eq("organizationId", args.organizationId)).collect(),
      ctx.db.query("auditEvents").withIndex("by_org_created", q => q.eq("organizationId", args.organizationId)).collect(),
      ctx.db.query("reviewEvents").withIndex("by_org_created", q => q.eq("organizationId", args.organizationId)).collect(),
    ]);
    const reviewIds = new Set(reviews.map(item => item._id));
    return { repositoryConnected: repositories.length > 0, modelKeyReady: credentials.length > 0,
      pullRequestPreviewed: audits.some(item => item.action === "review.previewed" && item.result === "allowed"), reviewStarted: reviews.length > 0,
      firstEvidenceReady: reviewEvents.some(item => reviewIds.has(item.reviewId) && (item.publicMessageArtifactId !== undefined || !["queue", "context"].includes(item.stage))) };
  },
});

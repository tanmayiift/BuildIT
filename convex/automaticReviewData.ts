import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// Automatic review spends the customer's own model key, so three things must all be true before
// one starts: the repository asked for it, this pull request is not paused, and nothing is already
// queued for the same head. The third is what stops a burst of pushes becoming a burst of reviews.
export const automaticEligibility = internalQuery({
  args: { installationId: v.number(), githubRepositoryId: v.number(), prNumber: v.number(), headSha: v.string() },
  handler: async (ctx, args) => {
    const repository = await ctx.db.query("repositories")
      .withIndex("by_github_id", q => q.eq("githubRepositoryId", args.githubRepositoryId)).first();
    if (!repository || !repository.enabled || repository.pausedAt) return { eligible: false as const, reason: "repository_unavailable" as const };
    if ((repository.reviewTrigger ?? "manual") !== "automatic") return { eligible: false as const, reason: "manual_only" as const };

    const paused = await ctx.db.query("pullRequestPauses")
      .withIndex("by_repository_pr", q => q.eq("repositoryId", repository._id).eq("prNumber", args.prNumber)).unique();
    if (paused) return { eligible: false as const, reason: "pull_request_paused" as const };

    // A review already covering this exact head is the debounce: five commits pushed in a minute
    // settle on one head, and only the last one has no review yet.
    const existing = await ctx.db.query("reviews")
      .withIndex("by_repo_pr_head_mode", q => q.eq("repositoryId", repository._id).eq("prNumber", args.prNumber).eq("headSha", args.headSha))
      .collect();
    if (existing.some(review => !review.isStale)) return { eligible: false as const, reason: "already_reviewing_this_head" as const };

    return { eligible: true as const, organizationId: repository.organizationId, repositoryId: repository._id };
  },
});

export const setPause = internalMutation({
  args: { organizationId: v.id("organizations"), repositoryId: v.id("repositories"), prNumber: v.number(),
    paused: v.boolean(), actor: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("pullRequestPauses")
      .withIndex("by_repository_pr", q => q.eq("repositoryId", args.repositoryId).eq("prNumber", args.prNumber)).unique();
    if (!args.paused) { if (existing) await ctx.db.delete(existing._id); return { paused: false }; }
    if (existing) return { paused: true };
    await ctx.db.insert("pullRequestPauses", { organizationId: args.organizationId, repositoryId: args.repositoryId,
      prNumber: args.prNumber, pausedBy: args.actor, pausedAt: args.now });
    return { paused: true };
  },
});

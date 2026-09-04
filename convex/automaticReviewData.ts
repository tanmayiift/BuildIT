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

// Automatic review spends a customer's key, so support needs to be able to turn it off for one
// repository without waiting for an owner to log in - a key exhausted at 3am is not a ticket that
// waits. Internal only: the owner-facing path is repositoryConnections.setReviewPolicy, which
// checks the caller's role.
export const setReviewTrigger = internalMutation({
  args: { githubRepositoryId: v.number(), trigger: v.union(v.literal("manual"), v.literal("automatic")) },
  handler: async (ctx, args) => {
    const repository = await ctx.db.query("repositories")
      .withIndex("by_github_id", q => q.eq("githubRepositoryId", args.githubRepositoryId)).first();
    if (!repository) return { updated: false as const };
    await ctx.db.patch(repository._id, { reviewTrigger: args.trigger, updatedAt: Date.now() });
    return { updated: true as const, repository: `${repository.owner}/${repository.name}`, trigger: args.trigger };
  },
});

// Support path for the same reason setReviewTrigger has one: approving or revoking a repository's
// configuration should not wait for an owner to log in. The owner-facing path is
// repositoryConnections.setReviewPolicy, which checks the caller's role.
export const setApprovedConfigHash = internalMutation({
  args: { githubRepositoryId: v.number(), contentHash: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const repository = await ctx.db.query("repositories")
      .withIndex("by_github_id", q => q.eq("githubRepositoryId", args.githubRepositoryId)).first();
    if (!repository) return { updated: false as const };
    await ctx.db.patch(repository._id, { approvedConfigHash: args.contentHash, approvedConfigBy: "operations", updatedAt: Date.now() });
    return { updated: true as const, repository: `${repository.owner}/${repository.name}`, approved: args.contentHash ?? null };
  },
});

// A review that read a .buildit.yml and could not trust it records the hash here, so the dashboard
// can offer an admin the exact version the receipt named. Nothing about trust is decided here: this
// is a note of what was seen, and approving it stays an explicit admin action with recent auth.
export const recordPendingConfig = internalMutation({
  args: { repositoryId: v.id("repositories"), contentHash: v.optional(v.string()), now: v.number() },
  handler: async (ctx, args) => {
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository) return;
    if (args.contentHash === undefined) {
      if (repository.pendingConfigHash === undefined) return;
      await ctx.db.patch(args.repositoryId, { pendingConfigHash: undefined, pendingConfigSeenAt: undefined });
      return;
    }
    if (!/^[0-9a-f]{64}$/.test(args.contentHash)) return;
    if (repository.pendingConfigHash === args.contentHash) return;
    await ctx.db.patch(args.repositoryId, { pendingConfigHash: args.contentHash, pendingConfigSeenAt: args.now });
  },
});

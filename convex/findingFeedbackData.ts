import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// One record of what a person did with a finding, read by two places: learning, to decide what to
// stop putting on the diff, and the history page, to answer whether BuildIT is useful here.
export const record = internalMutation({
  args: { repositoryId: v.id("repositories"), prNumber: v.number(), markerFindingId: v.string(),
    verdict: v.union(v.literal("accepted"), v.literal("dismissed")), actorHash: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository) return { recorded: false as const };

    // The comment marker carries the finding's id, so the feedback attaches to the finding a person
    // was actually looking at rather than to whichever review happens to be newest.
    const reviews = await ctx.db.query("reviews")
      .withIndex("by_repo_pr_head_mode", q => q.eq("repositoryId", args.repositoryId).eq("prNumber", args.prNumber))
      .order("desc").take(20);
    for (const review of reviews) {
      const findings = await ctx.db.query("findings").withIndex("by_review_severity", q => q.eq("reviewId", review._id)).collect();
      const finding = findings.find(item => item._id === args.markerFindingId || item.fingerprintHmac === args.markerFindingId);
      if (!finding) continue;

      const existing = await ctx.db.query("findingFeedback").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
      // A person changing their mind replaces their earlier verdict rather than adding a second.
      const prior = existing.find(item => item.findingId === finding._id && item.actorHash === args.actorHash);
      if (prior) { await ctx.db.patch(prior._id, { verdict: args.verdict, occurredAt: args.now }); return { recorded: true as const }; }

      await ctx.db.insert("findingFeedback", {
        organizationId: repository.organizationId, repositoryId: args.repositoryId, reviewId: review._id,
        findingId: finding._id, fingerprintHmac: finding.fingerprintHmac,
        ruleKey: finding.ruleId ?? finding.category, pathPrefixHmac: finding.pathHmac,
        verdict: args.verdict, actorHash: args.actorHash, occurredAt: args.now,
      });
      return { recorded: true as const };
    }
    return { recorded: false as const };
  },
});

// Learning is per repository, never per organization and never global: one team's dismissals must
// not change another team's reviews.
export const feedbackForRepository = internalQuery({
  args: { repositoryId: v.id("repositories") },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("findingFeedback")
      .withIndex("by_repository_time", q => q.eq("repositoryId", args.repositoryId)).order("desc").take(2_000);
    return rows.map(row => ({ ruleKey: row.ruleKey, pathPrefixHmac: row.pathPrefixHmac, verdict: row.verdict }));
  },
});

export const repositoryByGithubId = internalQuery({
  args: { githubRepositoryId: v.number() },
  handler: async (ctx, args) => {
    const repository = await ctx.db.query("repositories")
      .withIndex("by_github_id", q => q.eq("githubRepositoryId", args.githubRepositoryId)).first();
    return repository && repository.enabled ? { repositoryId: repository._id } : null;
  },
});

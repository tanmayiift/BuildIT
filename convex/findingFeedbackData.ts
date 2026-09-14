import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { recordFindingOpinion } from "./lib/findingOpinions";

// One record of what a person did with a finding, read by two places: learning, to decide what to
// stop putting on the diff, and the history page, to answer whether BuildIT is useful here.
export const record = internalMutation({
  args: { repositoryId: v.id("repositories"), prNumber: v.number(), markerFindingId: v.string(),
    verdict: v.union(v.literal("accepted"), v.literal("dismissed")), actorHash: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository) return { recorded: false as const };

    const findingId = ctx.db.normalizeId("findings", args.markerFindingId);
    const exact = findingId ? await ctx.db.get(findingId) : null;
    const candidates = exact ? [exact] : /^[0-9a-f]{64}$/i.test(args.markerFindingId)
      ? await ctx.db.query("findings").withIndex("by_fingerprint", q => q.eq("fingerprintHmac", args.markerFindingId)).take(101)
      : [];
    // Legacy fingerprint markers can match several runs. Refuse ambiguity rather than silently
    // assigning a person's feedback to whichever review happens to sort first.
    if (candidates.length > 100) return { recorded: false as const };
    const scoped = [];
    for (const finding of candidates) {
      const review = await ctx.db.get(finding.reviewId);
      if (review && review.organizationId === repository.organizationId && finding.organizationId === repository.organizationId && review.repositoryId === args.repositoryId && review.prNumber === args.prNumber) scoped.push({ finding, review });
    }
    if (scoped.length === 1) {
      await recordFindingOpinion(ctx, scoped[0]!.finding, scoped[0]!.review, args);
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

// Numbered the way the summary comment numbers them: visible findings, worst first, which is the
// order a reader sees. A number that does not exist records nothing rather than guessing.
export const recordByIndex = internalMutation({
  args: { repositoryId: v.id("repositories"), prNumber: v.number(), findingIndex: v.number(),
    actorHash: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository) return { recorded: false as const };
    if (!Number.isInteger(args.findingIndex) || args.findingIndex < 1 || args.findingIndex > 500) return { recorded: false as const };
    const review = await ctx.db.query("reviews")
      .withIndex("by_repo_pr_completed", q => q.eq("repositoryId", args.repositoryId).eq("prNumber", args.prNumber).gt("completedAt", undefined))
      .order("desc").first();
    if (!review || review.organizationId !== repository.organizationId) return { recorded: false as const };

    const severityOrder = { critical: 0, high: 1, warning: 2, info: 3 } as const;
    const findings = await ctx.db.query("findings").withIndex("by_review_severity", q => q.eq("reviewId", review._id)).take(501);
    if (findings.length > 500) return { recorded: false as const };
    const visible = findings.filter(item => item.resolution !== "dismissed")
      .sort((left, right) => (severityOrder[left.severity] ?? 9) - (severityOrder[right.severity] ?? 9));
    const finding = visible[args.findingIndex - 1];
    if (!finding) return { recorded: false as const };

    if (visible.length > 500) return { recorded: false as const };
    await recordFindingOpinion(ctx, finding, review, { verdict: "dismissed", actorHash: args.actorHash, now: args.now });
    return { recorded: true as const };
  },
});

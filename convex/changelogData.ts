import { v } from "convex/values";
import { isConcluded } from "./lib/reviewOutcome";
import { recordReviewMetric } from "./lib/recordMetric";
import { internalMutation, internalQuery } from "./_generated/server";

// Only what a changelog entry may be built from: the repository asked for one, and the findings
// BuildIT actually fixed on this pull request.
export const changelogScope = internalQuery({
  args: { githubRepositoryId: v.number(), prNumber: v.number() },
  handler: async (ctx, args) => {
    const repository = await ctx.db.query("repositories")
      .withIndex("by_github_id", q => q.eq("githubRepositoryId", args.githubRepositoryId)).first();
    if (!repository || !repository.enabled || !repository.changelogOnMerge) return null;
    const installation = await ctx.db.get(repository.installationId);
    if (!installation || installation.status !== "active") return null;

    const reviews = await ctx.db.query("reviews")
      .withIndex("by_repo_pr_head_mode", q => q.eq("repositoryId", repository._id).eq("prNumber", args.prNumber))
      .order("desc").take(10);
    const fixedFindings: string[] = [];
    for (const review of reviews) {
      const findings = await ctx.db.query("findings").withIndex("by_review_severity", q => q.eq("reviewId", review._id)).collect();
      // "fixed" is set when a delivered autofix resolved it - the only finding BuildIT can honestly
      // claim to have fixed on the way.
      for (const finding of findings.filter(item => item.resolution === "fixed")) {
        const content = finding.contentArtifactId ? await ctx.db.get(finding.contentArtifactId) : null;
        if (content && !fixedFindings.includes(finding.ruleId ?? finding.category)) fixedFindings.push(finding.ruleId ?? finding.category);
      }
    }
    return { installationId: installation.installationId, defaultBranch: repository.defaultBranch, fixedFindings: fixedFindings.slice(0, 5) };
  },
});

// BuildIT watched every merge go past and kept none of it. The pull_request closed+merged webhook
// reached changelogWorker and stopped there, and only when the repository had changelogOnMerge on -
// so for most workspaces the single strongest signal about whether a review mattered was observed
// and dropped. A review that found nothing and a review whose findings were fixed before merge
// looked identical afterwards.
//
// This records the outcome for every merge regardless of the changelog setting, and emits
// human_time_to_merge_ms, which has been in the metric vocabulary since it was written and has
// never once been produced.
export const recordMergeOutcome = internalMutation({
  args: { githubRepositoryId: v.number(), prNumber: v.number(), mergedAt: v.number() },
  handler: async (ctx, args) => {
    const repository = await ctx.db.query("repositories")
      .withIndex("by_github_id", q => q.eq("githubRepositoryId", args.githubRepositoryId)).first();
    if (!repository || !repository.enabled) return { recorded: false as const, reason: "repository_unavailable" as const };
    const reviews = await ctx.db.query("reviews")
      .withIndex("by_repo_pr_head_mode", q => q.eq("repositoryId", repository._id).eq("prNumber", args.prNumber))
      .collect();
    // The review that reached a verdict on the commit that merged. Attempts that never concluded
    // say nothing about the merge, and stamping them would inflate the count of reviews a human
    // acted on with ones nobody could have read.
    const concluded = reviews.filter(review => review.completedAt !== undefined && isConcluded(review.status));
    if (!concluded.length) return { recorded: false as const, reason: "no_concluded_review" as const };
    const latest = concluded.reduce((best, review) => (review.completedAt ?? 0) > (best.completedAt ?? 0) ? review : best);
    if (latest.mergedAt !== undefined) return { recorded: false as const, reason: "already_recorded" as const };
    await ctx.db.patch(latest._id, { mergedAt: args.mergedAt, updatedAt: args.mergedAt });
    // Clamp rather than record a negative interval: a clock skew between GitHub's merge timestamp
    // and ours must not produce a duration that says the merge preceded the review.
    const elapsed = Math.max(0, args.mergedAt - (latest.completedAt ?? args.mergedAt));
    await recordReviewMetric(ctx, latest, "human_time_to_merge_ms", args.mergedAt, "merge", elapsed);
    return { recorded: true as const, reviewId: latest._id, elapsed };
  },
});

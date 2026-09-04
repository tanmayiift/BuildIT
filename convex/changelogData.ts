import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

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

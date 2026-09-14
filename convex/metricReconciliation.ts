import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { recordReviewMetric } from "./lib/recordMetric";
import type { Doc } from "./_generated/dataModel";

// Retained evidence can establish some historic counts, never that all past failures were
// recorded. Keep the coverage warning after this backfill. Dry-run is the default.
export const backfill = internalMutation({
  args: { organizationId: v.id("organizations"), cursor: v.optional(v.string()), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const organization = await ctx.db.get(args.organizationId);
    if (!organization || organization.deletedAt) throw new Error("not_found_or_forbidden");
    const page = await ctx.db.query("reviews").withIndex("by_org_created", q => q.eq("organizationId", args.organizationId)).paginate({ cursor: args.cursor ?? null, numItems: 10 });
    let proposed = 0, inserted = 0, incompleteReviews = 0;
    for (const review of page.page) {
      const repository = await ctx.db.get(review.repositoryId);
      if (!repository || repository.organizationId !== args.organizationId) throw new Error("not_found_or_forbidden");
      const candidates: Array<{ name: Doc<"metricEvents">["name"]; at: number; value: number; key?: string }> = [];
      if (review.isStale && review.staleSince !== undefined) candidates.push({ name: "stale_review", at: review.staleSince, value: 1 });
      if (review.status === "platform_failed" && review.statusReasonCode === "sandbox_unavailable" && review.completedAt !== undefined) candidates.push({ name: "runner_failure", at: review.completedAt, value: 1 });
      const checks = await ctx.db.query("checkRuns").withIndex("by_review", q => q.eq("reviewId", review._id)).take(501);
      if (checks.some(row => row.organizationId !== args.organizationId)) throw new Error("not_found_or_forbidden");
      const regression = checks.find(head => head.commitSha === review.headSha && head.conclusion === "failed" && head.regressionClassification === "introduced"
        && checks.some(base => base.commitSha === review.baseSha && base.conclusion === "passed" && base.nameHash === head.nameHash && base.commandFingerprint === head.commandFingerprint));
      if (regression?.completedAt !== undefined) candidates.push({ name: "ci_regression_caught", at: regression.completedAt, value: 1 });
      const stages = await ctx.db.query("modelStageRuns").withIndex("by_review", q => q.eq("reviewId", review._id)).take(501);
      if (stages.some(row => row.organizationId !== args.organizationId || row.repositoryId !== review.repositoryId)) throw new Error("not_found_or_forbidden");
      const failures = stages.filter(stage => stage.outcome === "provider_error");
      for (const failure of failures) candidates.push({ name: "provider_failure", at: failure.createdAt, value: 1, key: failure._id });
      if (checks.length > 500 || stages.length > 500) incompleteReviews++;
      const existingNames = new Set<string>();
      for (const name of new Set(candidates.map(candidate => candidate.name))) {
        // A live writer may already have recorded this review. Never duplicate it by guessing
        // how an old attempt maps onto a new invocation identity.
        const existing = await ctx.db.query("metricEvents").withIndex("by_review_name", q => q.eq("reviewId", review._id).eq("name", name)).first();
        if (existing) existingNames.add(name);
      }
      for (const candidate of candidates) {
        if (existingNames.has(candidate.name)) continue;
        proposed++;
        if (args.dryRun === false) {
          await recordReviewMetric(ctx, review, candidate.name, candidate.at, `retained-evidence${candidate.key ? `-${candidate.key}` : ""}`, candidate.value);
          inserted++;
        }
      }
    }
    return { proposed, inserted, incompleteReviews, complete: page.isDone, nextCursor: page.isDone ? null : page.continueCursor, historyRemainsIncomplete: true };
  },
});

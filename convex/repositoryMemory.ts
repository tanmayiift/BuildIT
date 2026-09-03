import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

// Context survived within a review and nowhere else: the second review of a repository started as
// cold as the first, so a finding a person had already dismissed came back, and a defect reported
// last week was reported again as if new.
//
// Memory here is deliberately narrow. It carries fingerprints and counts, never repository content
// or model prose, because this is fed back into a prompt: anything richer would be a channel for
// one review's output to steer the next.

export const memoryLimit = 200;

export type RepositoryMemory = {
  dismissedFingerprints: string[];
  recurringFingerprints: string[];
  reviewsSeen: number;
};

export async function repositoryMemoryFor(ctx: QueryCtx, repositoryId: Id<"repositories">): Promise<RepositoryMemory> {
  const suppressions = await ctx.db
    .query("findingSuppressions")
    .withIndex("by_repo_fingerprint", q => q.eq("repositoryId", repositoryId))
    .take(memoryLimit);

  const reviews = await ctx.db
    .query("reviews")
    .withIndex("by_repo_pr_head_mode", q => q.eq("repositoryId", repositoryId))
    .take(memoryLimit);

  // A fingerprint seen in more than one review of this repository is a standing problem rather
  // than a fresh one, which is worth telling the findings stage so it can say so.
  const counts = new Map<string, number>();
  for (const review of reviews) {
    const findings = await ctx.db
      .query("findings")
      .withIndex("by_review_severity", q => q.eq("reviewId", review._id))
      .take(memoryLimit);
    const inThisReview = new Set(findings.map(finding => finding.fingerprintHmac));
    for (const print of inThisReview) counts.set(print, (counts.get(print) ?? 0) + 1);
  }

  return {
    dismissedFingerprints: suppressions.map(item => item.fingerprintHmac),
    recurringFingerprints: [...counts.entries()].filter(([, seen]) => seen > 1).map(([print]) => print),
    reviewsSeen: reviews.length,
  };
}

export const forRepository = internalQuery({
  args: { repositoryId: v.id("repositories") },
  handler: async (ctx, args) => repositoryMemoryFor(ctx, args.repositoryId),
});

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { assertReviewParent } from "./lib/parentConsistency";

// The eval set only ever grew by hand, so the runs most worth learning from were the ones nothing
// captured: a review that reached no verdict, and a finding a person read and dismissed as wrong.
// Both are recorded here the moment they happen, source-free - fingerprints and codes, never
// repository content - so the corpus grows from production instead of from memory.

export const recordMissedVerdict = internalMutation({
  args: { organizationId: v.id("organizations"), reviewId: v.id("reviews"), reasonCode: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
    // One candidate per review: a review that is finalized twice is still one thing to learn from.
    const existing = await ctx.db.query("evalCandidates").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
    if (existing.some(item => item.kind === "missed")) return existing.find(item => item.kind === "missed")!._id;
    return ctx.db.insert("evalCandidates", {
      organizationId: review.organizationId, repositoryId: review.repositoryId, reviewId: review._id,
      kind: "missed", reasonCode: args.reasonCode, promptVersion: review.promptVersion,
      model: review.model, headSha: review.headSha, createdAt: args.now,
    });
  },
});

export const recordDismissedFinding = internalMutation({
  args: {
    organizationId: v.id("organizations"), reviewId: v.id("reviews"), fingerprintHmac: v.string(),
    reasonCode: v.string(), now: v.number(),
  },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
    const existing = await ctx.db.query("evalCandidates").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
    // A person dismissing the same finding twice is one signal, not two.
    if (existing.some(item => item.kind === "false_positive" && item.fingerprintHmac === args.fingerprintHmac)) return null;
    return ctx.db.insert("evalCandidates", {
      organizationId: review.organizationId, repositoryId: review.repositoryId, reviewId: review._id,
      kind: "false_positive", reasonCode: args.reasonCode, fingerprintHmac: args.fingerprintHmac,
      promptVersion: review.promptVersion, model: review.model, headSha: review.headSha, createdAt: args.now,
    });
  },
});

// What a human curates next. Ordered oldest first, because a candidate that has waited longest is
// the one the corpus has been missing longest.
export const pendingCandidates = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 200) throw new Error("eval_candidate_limit_invalid");
    const rows = await ctx.db.query("evalCandidates")
      .withIndex("by_pending", q => q.eq("reviewedIntoEvalSet", undefined))
      .take(args.limit);
    return rows.map(row => ({
      id: row._id, kind: row.kind, reasonCode: row.reasonCode, promptVersion: row.promptVersion,
      model: row.model, createdAt: row.createdAt,
    }));
  },
});

export const markCurated = internalMutation({
  args: { candidateId: v.id("evalCandidates"), now: v.number() },
  handler: async (ctx, args) => {
    const candidate = await ctx.db.get(args.candidateId);
    if (!candidate) throw new Error("not_found_or_forbidden");
    await ctx.db.patch(candidate._id, { reviewedIntoEvalSet: true });
    return { id: candidate._id, curatedAt: args.now };
  },
});

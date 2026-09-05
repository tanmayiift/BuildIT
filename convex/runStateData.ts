import { v, ConvexError } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { assertReviewParent } from "./lib/parentConsistency";
import { runIdFor } from "./lib/runIdentity";
import * as value from "./validators";

// Each stage handed the next one an inference. The analysis stage recomputed the review plan the
// chain had already computed and discarded the reasons; the memory injected into the findings
// prompt left no record it had been used; the coverage the context stage measured reached the
// verdict but never the operator. So "how does context move between stages" had no answer that was
// not "read the code and trust me".
//
// This records the handoff. Counts, fingerprint totals, artifact ids and decisions - never
// repository content or model prose, on the same reasoning repositoryMemory documents for itself:
// this data is read back into a prompt's neighbourhood, and anything richer would be a channel for
// one stage's output to steer the next.

const executionArgs = {
  organizationId: v.id("organizations"),
  reviewId: v.id("reviews"),
  expectedHeadSha: v.string(),
  expectedGeneration: v.number(),
};

export const record = internalMutation({
  args: {
    ...executionArgs,
    stage: value.runStateStage,
    filesSelected: v.optional(v.number()),
    filesChanged: v.optional(v.number()),
    coverage: v.optional(v.string()),
    coverageGap: v.optional(v.string()),
    plannedStages: v.optional(v.array(v.string())),
    findingsSpecialists: v.optional(v.number()),
    skippedStages: v.optional(v.array(v.object({ stage: v.string(), because: v.string() }))),
    memoryDismissed: v.optional(v.number()),
    memoryRecurring: v.optional(v.number()),
    memoryReviewsSeen: v.optional(v.number()),
    decisions: v.optional(v.array(v.object({ kind: v.string(), reason: v.string(), detail: v.optional(v.string()) }))),
    artifactIds: v.optional(v.array(v.id("artifacts"))),
    durationMs: v.optional(v.number()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
    // Same fence as every other worker write. A stage finishing after its run was replaced must not
    // leave state behind describing a run nobody is watching.
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale) {
      throw new ConvexError("run_state_stale_or_replaced");
    }
    const runId = runIdFor(review._id, review.executionGeneration);
    const existing = await ctx.db
      .query("runState")
      .withIndex("by_run_stage", q => q.eq("runId", runId).eq("stage", args.stage))
      .unique();
    // A stage can be retried inside one generation - the provider retry loop does exactly that - so
    // the row is replaced rather than duplicated, and stateVersion counts how many attempts it took.
    if (existing) {
      await ctx.db.patch(existing._id, {
        stateVersion: existing.stateVersion + 1,
        ...(args.filesSelected === undefined ? {} : { filesSelected: args.filesSelected }),
        ...(args.filesChanged === undefined ? {} : { filesChanged: args.filesChanged }),
        ...(args.coverage === undefined ? {} : { coverage: args.coverage }),
        ...(args.coverageGap === undefined ? {} : { coverageGap: args.coverageGap }),
        ...(args.plannedStages === undefined ? {} : { plannedStages: args.plannedStages }),
        ...(args.findingsSpecialists === undefined ? {} : { findingsSpecialists: args.findingsSpecialists }),
        ...(args.skippedStages === undefined ? {} : { skippedStages: args.skippedStages }),
        ...(args.memoryDismissed === undefined ? {} : { memoryDismissed: args.memoryDismissed }),
        ...(args.memoryRecurring === undefined ? {} : { memoryRecurring: args.memoryRecurring }),
        ...(args.memoryReviewsSeen === undefined ? {} : { memoryReviewsSeen: args.memoryReviewsSeen }),
        // Decisions accumulate across attempts: "the second critic ran" and "it was still uncertain"
        // are two facts about one run, and keeping only the last would hide the ladder.
        ...(args.decisions === undefined ? {} : { decisions: [...(existing.decisions ?? []), ...args.decisions].slice(0, 50) }),
        ...(args.artifactIds === undefined ? {} : { artifactIds: args.artifactIds }),
        ...(args.durationMs === undefined ? {} : { durationMs: args.durationMs }),
      });
      return existing._id;
    }
    return ctx.db.insert("runState", {
      organizationId: args.organizationId,
      repositoryId: review.repositoryId,
      reviewId: review._id,
      runId,
      stage: args.stage,
      stateVersion: 1,
      ...(args.filesSelected === undefined ? {} : { filesSelected: args.filesSelected }),
      ...(args.filesChanged === undefined ? {} : { filesChanged: args.filesChanged }),
      ...(args.coverage === undefined ? {} : { coverage: args.coverage }),
      ...(args.coverageGap === undefined ? {} : { coverageGap: args.coverageGap }),
      ...(args.plannedStages === undefined ? {} : { plannedStages: args.plannedStages }),
      ...(args.findingsSpecialists === undefined ? {} : { findingsSpecialists: args.findingsSpecialists }),
      ...(args.skippedStages === undefined ? {} : { skippedStages: args.skippedStages }),
      ...(args.memoryDismissed === undefined ? {} : { memoryDismissed: args.memoryDismissed }),
      ...(args.memoryRecurring === undefined ? {} : { memoryRecurring: args.memoryRecurring }),
      ...(args.memoryReviewsSeen === undefined ? {} : { memoryReviewsSeen: args.memoryReviewsSeen }),
      ...(args.decisions === undefined ? {} : { decisions: args.decisions.slice(0, 50) }),
      ...(args.artifactIds === undefined ? {} : { artifactIds: args.artifactIds }),
      ...(args.durationMs === undefined ? {} : { durationMs: args.durationMs }),
      createdAt: args.now,
    });
  },
});

// The successor stage reads its predecessor's state by identifier instead of re-deriving it.
export const forRun = internalQuery({
  args: { reviewId: v.id("reviews"), stage: v.optional(value.runStateStage) },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("runState").withIndex("by_review", q => q.eq("reviewId", args.reviewId)).take(50);
    return args.stage ? rows.filter(row => row.stage === args.stage) : rows;
  },
});

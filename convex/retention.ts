import { v } from "convex/values";
import type { WorkflowId } from "@convex-dev/workflow";
import { internal } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { ignoredWebhookDeliveryRetentionMs, terminalStatuses } from "./lib/lifecycle";
import { handledWebhookEvents } from "./lib/webhookEvents";
import { reviewWorkflowManager } from "./workflowManager";

// What the database keeps only as long as something needs it. Everything here was write-only or
// spent - read by nothing after the moment it mattered - and grew with traffic: on 7 Oct 2026 the
// deployment held 1,488 refresh tokens for two users, 267 lock rows nothing read, and 5,564 webhook
// deliveries, most of them check events no handler looks at. Functionality, billing and analytics
// rows (reviews and their evidence, usage, invocations, audit) are not touched here.
//
// Every pass is bounded, so the sweep cannot itself become the expensive query it exists to avoid.
const sweepBatch = 500;

// A refresh token is single-use. Once used it is kept only so a replay inside Convex Auth's 10-second
// reuse window can be told apart from theft; a day later a replay of a deleted token is simply
// refused, which signs that client out rather than letting it in.
export const usedRefreshTokenRetentionMs = 86_400_000;
// A sign-in verifier lives for one OAuth round trip.
export const verifierRetentionMs = 86_400_000;

export const sweep = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const deleted = { sessions: 0, refreshTokens: 0, verifiers: 0, reviewLocks: 0 };

    for (const session of await ctx.db.query("authSessions").take(sweepBatch)) {
      if (session.expirationTime >= now) continue;
      const tokens = await ctx.db.query("authRefreshTokens").withIndex("sessionIdAndParentRefreshTokenId", q => q.eq("sessionId", session._id)).take(sweepBatch);
      for (const token of tokens) { await ctx.db.delete(token._id); deleted.refreshTokens += 1; }
      if (tokens.length < sweepBatch) { await ctx.db.delete(session._id); deleted.sessions += 1; }
    }

    for (const token of await ctx.db.query("authRefreshTokens").take(sweepBatch * 2)) {
      const spent = token.firstUsedTime !== undefined && token.firstUsedTime < now - usedRefreshTokenRetentionMs;
      if (token.expirationTime < now || spent) { await ctx.db.delete(token._id); deleted.refreshTokens += 1; }
    }

    for (const verifier of await ctx.db.query("authVerifiers").take(sweepBatch)) {
      if (verifier._creationTime < now - verifierRetentionMs) { await ctx.db.delete(verifier._id); deleted.verifiers += 1; }
    }

    // No longer written; emptied here, then the table is dropped from the schema.
    for (const lock of await ctx.db.query("reviewLocks").take(sweepBatch)) { await ctx.db.delete(lock._id); deleted.reviewLocks += 1; }

    return deleted;
  },
});

// Deliveries recorded before the webhook handler stopped storing what it ignores (7 Oct 2026) still
// carry the 30-day expiry every row used to get. This pages through them once and deletes the ones
// nothing will read: events no handler acts on, and deliveries ignored on arrival that are past the
// one-day window. Run it until isDone; new rows never need it.
export const purgeUnreadDeliveries = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const page = await ctx.db.query("webhookDeliveries").paginate({ cursor: args.cursor, numItems: sweepBatch });
    let deleted = 0;
    for (const delivery of page.page) {
      const unhandled = !handledWebhookEvents.has(delivery.event);
      const ignoredAndOld = delivery.disposition !== "processed" && delivery.receivedAt < now - ignoredWebhookDeliveryRetentionMs;
      if (unhandled || ignoredAndOld) { await ctx.db.delete(delivery._id); deleted += 1; }
    }
    return { deleted, cursor: page.continueCursor, isDone: page.isDone };
  },
});

// Review history is kept for 30 days - the owner's decision on 7 Oct 2026, when the deployment ran
// over the Convex Free plan - and then everything that belongs to a review goes with it: its events,
// stages, findings, checks, autofix rounds, per-call charges and the workflow's journal. What a
// review leaves behind is deliberately small: the month's billing totals (usageMonths), the audit
// log, and the repository's learned suppressions, none of which name the review.
export const reviewRetentionMs = 30 * 86_400_000;
const reviewsPerPass = 5;
const passesPerRun = 200;

type ReviewRow = { _id: Id<TableNames> };
const byReview = <T extends TableNames>(table: T, index: string) =>
  (ctx: MutationCtx, reviewId: Id<"reviews">) =>
    // Every index named here leads with reviewId; the cast is only because the index name is data.
    (ctx.db.query(table) as any).withIndex(index, (q: any) => q.eq("reviewId", reviewId)).collect() as Promise<ReviewRow[]>;
// Fan-outs and notifications are keyed "<reviewId>:<generation>:<status>[:<user>]", so a review's rows
// are one range of the dedupe index rather than a scan.
const byKeyPrefix = <T extends "notificationFanouts" | "notifications">(table: T) =>
  (ctx: MutationCtx, reviewId: Id<"reviews">) =>
    (ctx.db.query(table) as any).withIndex("by_dedupe_key", (q: any) => q.gte("dedupeKey", `${reviewId}:`).lt("dedupeKey", `${reviewId};`)).collect() as Promise<ReviewRow[]>;

// Every table whose rows name a review (tablePolicy.ts, parents include reviewId), and how to find
// them. retention.test.ts requires this list and outlivesReview to cover tablePolicy between them,
// so a table added later cannot be forgotten here.
export const reviewCascade = {
  reviewEvents: byReview("reviewEvents", "by_review"),
  runState: byReview("runState", "by_review"),
  modelStageRuns: byReview("modelStageRuns", "by_review"),
  modelInvocations: byReview("modelInvocations", "by_review_status"),
  requirements: byReview("requirements", "by_review"),
  findings: byReview("findings", "by_review_severity"),
  findingFeedback: byReview("findingFeedback", "by_review"),
  evalCandidates: byReview("evalCandidates", "by_review"),
  checkRuns: byReview("checkRuns", "by_review"),
  autofixAttempts: byReview("autofixAttempts", "by_review_attempt"),
  autofixRounds: byReview("autofixRounds", "by_review_round"),
  usageLedger: byReview("usageLedger", "by_review"),
  githubSideEffects: byReview("githubSideEffects", "by_review"),
  deliveries: byReview("deliveries", "by_review"),
  metricEvents: byReview("metricEvents", "by_review_name"),
  reviewLocks: byReview("reviewLocks", "by_review"),
  notificationFanouts: byKeyPrefix("notificationFanouts"),
  notifications: byKeyPrefix("notifications"),
  // Handled first and separately in deleteReview: their stored objects and sandboxes must be gone.
  artifacts: byReview("artifacts", "by_review"),
  executionJobs: byReview("executionJobs", "by_review"),
} satisfies Partial<Record<TableNames, (ctx: MutationCtx, reviewId: Id<"reviews">) => Promise<ReviewRow[]>>>;

// Rows that name a review and are not deleted with it, and why.
export const outlivesReview = {
  webhookDeliveries: "an ingress record with its own one- and thirty-day expiry (lib/lifecycle.ts)",
} as const;

// Deletes one review and everything it owns, or says why it must wait. An artifact whose object the
// cleanup worker has not proven gone keeps the review: deleting the row would forget the object. It
// is expired here so the worker takes it next. A sandbox not yet released keeps it the same way.
async function deleteReview(ctx: MutationCtx, review: Doc<"reviews">, now: number): Promise<"deleted" | "artifact_pending" | "sandbox_pending" | "descendant_active"> {
  const artifacts = await ctx.db.query("artifacts").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
  const undeleted = artifacts.filter(artifact => !artifact.deletedAt);
  if (undeleted.length) {
    for (const artifact of undeleted) if (artifact.expiresAt >= now) await ctx.db.patch(artifact._id, { expiresAt: now - 1 });
    return "artifact_pending";
  }
  const jobs = await ctx.db.query("executionJobs").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
  if (jobs.some(job => job.sandboxReclaimAt !== undefined && job.sandboxReclaimedAt === undefined)) return "sandbox_pending";
  // A provider fallback is a child review sharing the parent's allowance; keep the parent while any
  // child is still inside the window, so a budget family is never half there.
  const children = await ctx.db.query("reviews").withIndex("by_parent", q => q.eq("parentReviewId", review._id)).collect();
  if (children.some(child => !removable(child.status) || child.createdAt >= now - reviewRetentionMs)) return "descendant_active";

  for (const find of Object.values(reviewCascade)) {
    for (const row of await find(ctx, review._id)) await ctx.db.delete(row._id);
  }
  if (review.workflowId) {
    // The journal is the workflow component's own storage (its steps table). A journal that is
    // already gone, or a component that refuses, must not keep the review forever.
    try { await reviewWorkflowManager.cleanup(ctx, review.workflowId as WorkflowId); } catch { /* journal already gone */ }
  }
  await ctx.db.delete(review._id);
  return "deleted";
}

// A blocked review never started - it holds no sandbox, artifact or charge - and one that is still
// blocked a month later is dead: on 7 Oct one from 1 Sep was still there, because blocked is not a
// terminal status and nothing else would ever remove it.
const removable = (status: string) => terminalStatuses.has(status) || status === "blocked";

// Thirty days from when the review was created. The first version went by updatedAt, and marking a
// review stale when a newer commit arrives touches it - so two reviews created on 5 Sep would have
// been kept until November. Read one workspace at a time on by_org_created, oldest first, five
// reviews per pass; each pass schedules the next until every workspace is done or the run's pass
// budget is spent, and the daily cron starts the next run.
export const expireReviews = internalMutation({
  // A function may paginate once, and that is the reviews; workspaces are stepped through by creation
  // time instead (afterOrganization is the last one's _creationTime).
  args: { now: v.optional(v.number()), organizationId: v.optional(v.id("organizations")), afterOrganization: v.optional(v.number()),
    reviewCursor: v.optional(v.union(v.string(), v.null())), pass: v.optional(v.number()),
    totals: v.optional(v.object({ deleted: v.number(), waiting: v.number() })) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now(), pass = args.pass ?? 0, cutoff = now - reviewRetentionMs;
    const totals = { ...(args.totals ?? { deleted: 0, waiting: 0 }) };
    const finish = (complete: boolean) => {
      console.info("buildit_review_retention", { ...totals, passes: pass, complete });
      return { ...totals, done: true };
    };
    if (pass >= passesPerRun) return finish(false);

    const nextOrganization = args.organizationId ? undefined
      : await ctx.db.query("organizations").withIndex("by_creation_time", q => q.gt("_creationTime", args.afterOrganization ?? -1)).first();
    if (!args.organizationId && !nextOrganization) return finish(true);
    const organizationId = args.organizationId ?? nextOrganization!._id;
    const afterOrganization = nextOrganization ? nextOrganization._creationTime : args.afterOrganization ?? -1;
    const reviews = await ctx.db.query("reviews").withIndex("by_org_created", q => q.eq("organizationId", organizationId).lt("createdAt", cutoff))
      .paginate({ cursor: args.reviewCursor ?? null, numItems: reviewsPerPass });
    for (const review of reviews.page) {
      if (!removable(review.status)) { totals.waiting += 1; continue; }
      const outcome = await deleteReview(ctx, review, now);
      if (outcome === "deleted") totals.deleted += 1; else totals.waiting += 1;
    }
    const next = reviews.isDone
      ? { afterOrganization, reviewCursor: null }
      : { organizationId, afterOrganization, reviewCursor: reviews.continueCursor };
    await ctx.scheduler.runAfter(0, internal.retention.expireReviews, { now, ...next, pass: pass + 1, totals });
    return { ...totals, done: false };
  },
});

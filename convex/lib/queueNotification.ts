import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { localEmailCaptureConfig } from "../../packages/operations/src/emailCaptureConfig";
import type { DecisionEmailStatus } from "../../packages/operations/src/email";

export function emailDecision(review: Pick<Doc<"reviews">, "status" | "completedRoundCount">): DecisionEmailStatus | null {
  if (["checks_passed", "delivered"].includes(review.status)) return "awaiting_human_approval";
  if (review.status === "failed_after_bounds") return review.completedRoundCount >= 3 ? "failed_after_three_rounds" : "autofix_stopped";
  if (["changes_requested", "inconclusive", "platform_failed", "budget_exhausted", "cancelled"].includes(review.status)) return review.status as DecisionEmailStatus;
  return null;
}
export async function queueReviewNotification(ctx: MutationCtx, reviewId: Id<"reviews">, now: number) {
  if (!localEmailCaptureConfig(process.env)) return null;
  const review = await ctx.db.get(reviewId);
  if (!review || review.isStale) return null;
  const decisionStatus = emailDecision(review);
  if (!decisionStatus) return null;
  const organization = await ctx.db.get(review.organizationId);
  if (!organization || organization.deletedAt) return null;
  const dedupeKey = `${review._id}:${review.executionGeneration}:${decisionStatus}`;
  const prior = await ctx.db.query("notificationFanouts").withIndex("by_dedupe_key", q => q.eq("dedupeKey", dedupeKey)).unique();
  if (prior) return prior._id;
  const id = await ctx.db.insert("notificationFanouts", { organizationId: review.organizationId, reviewId, generation: review.executionGeneration, decisionStatus, dedupeKey, complete: false, createdAt: now });
  await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation">("notificationOutbox:fanout"), { fanoutId: id, now });
  return id;
}

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// A replayed workflow transition is the same event; a new execution generation is not.
export async function recordReviewMetric(ctx: MutationCtx, review: Doc<"reviews">, name: Doc<"metricEvents">["name"], occurredAt: number, suffix = "outcome", value = 1) {
  const organization = await ctx.db.get(review.organizationId);
  if (!organization || organization.deletedAt) throw new Error("organization_unavailable");
  const eventKey = `${review._id}:${name === "stale_review" ? "review" : review.executionGeneration}:${name}:${name === "stale_review" ? "outcome" : suffix}`;
  const prior = await ctx.db.query("metricEvents").withIndex("by_org_event_key", q => q.eq("organizationId", review.organizationId).eq("eventKey", eventKey)).unique();
  if (prior) return prior._id;
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(occurredAt)) throw new Error("invalid_metric");
  if (organization.metricTrackingStartedAt === undefined) await ctx.db.patch(organization._id, { metricTrackingStartedAt: Date.now() });
  return ctx.db.insert("metricEvents", { organizationId: review.organizationId, repositoryId: review.repositoryId, reviewId: review._id, name, value, organizationTimezone: organization.timezone, occurredAt, eventKey });
}

export async function recordRunnerFailure(ctx: MutationCtx, review: Doc<"reviews">, code: string, occurredAt: number) {
  // Provider, repository and configuration failures must not be reclassified as runner failures.
  if (/sandbox|runner|command_(?:execution|timeout)|validation_(?:timeout|execution)/i.test(code)) {
    await recordReviewMetric(ctx, review, "runner_failure", occurredAt);
  }
}

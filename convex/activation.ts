import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrganizationRole } from "./lib/authz";
import { concludedStatuses, isAbandoned, isConcluded, isDecisive } from "./lib/reviewOutcome";

type StageTimes = { identityAt?: number | undefined; repositoryAt?: number | undefined; modelKeyAt?: number | undefined; previewAt?: number | undefined; reviewAt?: number | undefined; evidenceAt?: number | undefined; humanDecisionAt?: number | undefined };
// The same ceiling telemetrySnapshotData uses. Activation is a funnel, not an export: past a
// few thousand rows the answer stops changing, and an unbounded read on a live subscription
// re-reads the tenant's whole history on every write.
const rowCeiling = 1_000;
// Was a hand-written set here and a differently-spelled one below, which is how this file came to
// disagree with itself about whether failed_after_bounds counts.
const completedEvidenceStatuses = concludedStatuses;
const duration = (from?: number | undefined, to?: number | undefined) => from !== undefined && to !== undefined && to >= from ? to - from : undefined;
export function summarizeActivation(times: StageTimes, outcomes: string[]) {
  const ordered = [times.identityAt, times.repositoryAt, times.previewAt, times.reviewAt, times.evidenceAt, times.humanDecisionAt].filter((value): value is number => value !== undefined);
  const chronologyValid = ordered.every((value, index) => index === 0 || value >= ordered[index - 1]!);
  // Three counts rather than two, because "completed" was doing two jobs. concluded answers the
  // funnel's question - did a result ever come back - and decisive answers the north star's, which
  // is whether BuildIT actually judged the code. An inconclusive review is the first and not the
  // second, and reporting only one of them hid that gap.
  const concluded = outcomes.filter(value => isConcluded(value)).length;
  const decisive = outcomes.filter(value => isDecisive(value)).length;
  const failed = outcomes.filter(value => isAbandoned(value)).length;
  const completed = concluded;
  return { times, chronologyValid, durationMs: { identityToRepository: duration(times.identityAt, times.repositoryAt), repositoryToPreview: duration(times.repositoryAt, times.previewAt), previewToReview: duration(times.previewAt, times.reviewAt), reviewToFirstEvidence: duration(times.reviewAt, times.evidenceAt), identityToFirstEvidence: duration(times.identityAt, times.evidenceAt), firstEvidenceToHumanDecision: duration(times.evidenceAt, times.humanDecisionAt) }, outcomes: { started: outcomes.length, completed, concluded, decisive, failed, active: Math.max(0, outcomes.length - concluded - failed) } };
}

export const funnel = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await requireOrganizationRole(ctx, args.organizationId, "viewer");
    const membership = await ctx.db.query("memberships").withIndex("by_org_user", q => q.eq("organizationId", args.organizationId).eq("userId", access.userId)).unique();
    if (!membership || membership.status !== "active") throw new Error("not_found_or_forbidden");
    // Existence checks use indexes before limiting. Unrelated audit events and model attempts
    // cannot hide the first preview or a published report. Outcome totals remain bounded and say so.
    const [repository, credential, firstReview, preview, reviewRows, reportRows] = await Promise.all([
      ctx.db.query("repositories").withIndex("by_org_enabled", q => q.eq("organizationId", args.organizationId).eq("enabled", true)).first(),
      ctx.db.query("providerCredentials").withIndex("by_org_status", q => q.eq("organizationId", args.organizationId).eq("status", "valid")).first(),
      ctx.db.query("reviews").withIndex("by_org_created", q => q.eq("organizationId", args.organizationId)).first(),
      ctx.db.query("auditEvents").withIndex("by_org_action_result_created", q => q.eq("organizationId", args.organizationId).eq("action", "review.previewed").eq("result", "allowed")).first(),
      ctx.db.query("reviews").withIndex("by_org_created", q => q.eq("organizationId", args.organizationId)).order("desc").take(rowCeiling + 1),
      ctx.db.query("reviewEvents").withIndex("by_org_public_message", q => q.eq("organizationId", args.organizationId).gt("publicMessageArtifactId", undefined)).take(101),
    ]);
    const previewAt = preview?.createdAt;
    const reviewAfterPreview = previewAt === undefined ? firstReview : await ctx.db.query("reviews").withIndex("by_org_created", q => q.eq("organizationId", args.organizationId).gte("createdAt", previewAt)).first();
    const reviewAt = reviewAfterPreview?.createdAt;
    const evidenceFloor = reviewAt ?? previewAt ?? membership.createdAt;
    const evidenceTimes: number[] = [];
    for (const event of reportRows.slice(0, 100)) {
      const review = await ctx.db.get(event.reviewId);
      const artifact = event.publicMessageArtifactId ? await ctx.db.get(event.publicMessageArtifactId) : null;
      if (review?.organizationId === args.organizationId && completedEvidenceStatuses.has(review.status) && event.createdAt >= evidenceFloor && artifact?.organizationId === args.organizationId && artifact.reviewId === review._id && artifact.redactionStatus === "redacted" && !artifact.deletedAt && artifact.expiresAt > Date.now()) evidenceTimes.push(event.createdAt);
    }
    const evidencePartial = reportRows.length > 100;
    const evidenceAt = !evidencePartial && evidenceTimes.length ? Math.min(...evidenceTimes) : undefined;
    // The funnel used to end at "evidence rendered", which answers whether BuildIT produced
    // something and not whether it mattered to anyone. humanDecisionAt was declared in StageTimes
    // from the start and never populated, so firstEvidenceToHumanDecision was permanently
    // undefined - the one duration that says a person read a finding and acted on it.
    //
    // Every human verdict lands in findingFeedback, whichever way it was given: the dashboard
    // dismiss control, resolving a review thread on GitHub, or an @buildit dismiss comment. The
    // first one at or after evidence is the moment the loop closed.
    const decision = evidenceAt === undefined ? null : await ctx.db.query("findingFeedback")
      .withIndex("by_org_time", q => q.eq("organizationId", args.organizationId).gte("occurredAt", evidenceAt))
      .first();
    const times = { identityAt: membership.createdAt, repositoryAt: repository?.createdAt, modelKeyAt: credential?.lastValidatedAt ?? credential?.createdAt,
      previewAt, reviewAt, evidenceAt, humanDecisionAt: decision?.occurredAt };
    return { repositoryConnected: Boolean(repository), modelKeyReady: Boolean(credential),
      pullRequestPreviewed: Boolean(preview), reviewStarted: Boolean(firstReview),
      firstEvidenceReady: evidenceTimes.length > 0 ? true : evidencePartial ? null : false,
      partial: { outcomes: reviewRows.length > rowCeiling, evidence: evidencePartial },
      ...summarizeActivation(times, reviewRows.slice(0, rowCeiling).map(item => item.status)) };
  },
});

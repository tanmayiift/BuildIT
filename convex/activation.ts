import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrganizationRole } from "./lib/authz";

type StageTimes = { identityAt?: number | undefined; repositoryAt?: number | undefined; modelKeyAt?: number | undefined; previewAt?: number | undefined; reviewAt?: number | undefined; evidenceAt?: number | undefined; humanDecisionAt?: number | undefined };
// The same ceiling telemetrySnapshotData uses. Activation is a funnel, not an export: past a
// few thousand rows the answer stops changing, and an unbounded read on a live subscription
// re-reads the tenant's whole history on every write.
const rowCeiling = 1_000;
const completedEvidenceStatuses = new Set(["checks_passed", "changes_requested", "inconclusive", "delivered", "failed_after_bounds"]);
const duration = (from?: number | undefined, to?: number | undefined) => from !== undefined && to !== undefined && to >= from ? to - from : undefined;
export function summarizeActivation(times: StageTimes, outcomes: string[]) {
  const ordered = [times.identityAt, times.repositoryAt, times.previewAt, times.reviewAt, times.evidenceAt, times.humanDecisionAt].filter((value): value is number => value !== undefined);
  const chronologyValid = ordered.every((value, index) => index === 0 || value >= ordered[index - 1]!);
  const completed = outcomes.filter(value => ["checks_passed", "changes_requested", "inconclusive", "delivered"].includes(value)).length;
  const failed = outcomes.filter(value => ["failed_after_bounds", "budget_exhausted", "platform_failed", "cancelled"].includes(value)).length;
  return { times, chronologyValid, durationMs: { identityToRepository: duration(times.identityAt, times.repositoryAt), repositoryToPreview: duration(times.repositoryAt, times.previewAt), previewToReview: duration(times.previewAt, times.reviewAt), reviewToFirstEvidence: duration(times.reviewAt, times.evidenceAt), identityToFirstEvidence: duration(times.identityAt, times.evidenceAt), firstEvidenceToHumanDecision: duration(times.evidenceAt, times.humanDecisionAt) }, outcomes: { started: outcomes.length, completed, failed, active: Math.max(0, outcomes.length - completed - failed) } };
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
    const times = { identityAt: membership.createdAt, repositoryAt: repository?.createdAt, modelKeyAt: credential?.lastValidatedAt ?? credential?.createdAt,
      previewAt, reviewAt, evidenceAt: !evidencePartial && evidenceTimes.length ? Math.min(...evidenceTimes) : undefined };
    return { repositoryConnected: Boolean(repository), modelKeyReady: Boolean(credential),
      pullRequestPreviewed: Boolean(preview), reviewStarted: Boolean(firstReview),
      firstEvidenceReady: evidenceTimes.length > 0 ? true : evidencePartial ? null : false,
      partial: { outcomes: reviewRows.length > rowCeiling, evidence: evidencePartial },
      ...summarizeActivation(times, reviewRows.slice(0, rowCeiling).map(item => item.status)) };
  },
});

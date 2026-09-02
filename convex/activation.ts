import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrganizationRole } from "./lib/authz";

type StageTimes = { identityAt?: number; repositoryAt?: number; modelKeyAt?: number; previewAt?: number; reviewAt?: number; evidenceAt?: number; humanDecisionAt?: number };
// The same ceiling telemetrySnapshotData uses. Activation is a funnel, not an export: past a
// few thousand rows the answer stops changing, and an unbounded read on a live subscription
// re-reads the tenant's whole history on every write.
const rowCeiling = 1_000;
const completedEvidenceStatuses = new Set(["checks_passed", "changes_requested", "inconclusive", "delivered", "failed_after_bounds"]);
const duration = (from?: number, to?: number) => from !== undefined && to !== undefined && to >= from ? to - from : undefined;
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
    // Bounded. These run on a live dashboard subscription and re-execute on every write, so an
    // organization with a long history would re-read its whole history each time.
    const [repositories, credentials, reviews, audits, reviewEvents, findings] = await Promise.all([
      ctx.db.query("repositories").withIndex("by_org_enabled", q => q.eq("organizationId", args.organizationId).eq("enabled", true)).take(rowCeiling),
      ctx.db.query("providerCredentials").withIndex("by_org_status", q => q.eq("organizationId", args.organizationId).eq("status", "valid")).take(rowCeiling),
      ctx.db.query("reviews").withIndex("by_org_status", q => q.eq("organizationId", args.organizationId)).take(rowCeiling),
      ctx.db.query("auditEvents").withIndex("by_org_created", q => q.eq("organizationId", args.organizationId)).take(rowCeiling),
      ctx.db.query("reviewEvents").withIndex("by_org_created", q => q.eq("organizationId", args.organizationId)).take(rowCeiling),
      // findings had no organizationId index, so this was a full table scan across every tenant.
      ctx.db.query("findings").withIndex("by_organization", q => q.eq("organizationId", args.organizationId)).take(rowCeiling),
    ]);
    const reviewIds = new Set(reviews.map(item => item._id));
    // An internal stage event means only that work was attempted. First value is an
    // inspectable report attached to a completed review, never a failed attempt.
    const completedEvidenceReviewIds = new Set(reviews.filter(item => completedEvidenceStatuses.has(item.status)).map(item => item._id));
    const minimum = (values: Array<number | undefined>) => { const present = values.filter((value): value is number => value !== undefined); return present.length ? Math.min(...present) : undefined; };
    const previewAt = minimum(audits.filter(item => item.action === "review.previewed" && item.result === "allowed").map(item => item.createdAt));
    const reviewAt = minimum(reviews.filter(item => previewAt === undefined || item.createdAt >= previewAt).map(item => item.createdAt));
    const evidenceFloor = reviewAt ?? previewAt ?? membership.createdAt;
    const times = { identityAt: membership.createdAt, repositoryAt: minimum(repositories.map(item => item.createdAt)), modelKeyAt: minimum(credentials.map(item => item.lastValidatedAt ?? item.createdAt)), previewAt, reviewAt, evidenceAt: minimum(reviewEvents.filter(item => item.createdAt >= evidenceFloor && completedEvidenceReviewIds.has(item.reviewId) && item.publicMessageArtifactId !== undefined).map(item => item.createdAt)), humanDecisionAt: minimum(findings.filter(item => reviewIds.has(item.reviewId) && ["accepted", "dismissed", "fixed"].includes(item.resolution)).map(item => item.updatedAt)) };
    return { repositoryConnected: repositories.length > 0, modelKeyReady: credentials.length > 0,
      pullRequestPreviewed: audits.some(item => item.action === "review.previewed" && item.result === "allowed"), reviewStarted: reviews.length > 0,
      firstEvidenceReady: times.evidenceAt !== undefined, ...summarizeActivation(times, reviews.map(item => item.status)) };
  },
});

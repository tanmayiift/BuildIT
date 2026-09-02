import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrganizationRole, requireRepositoryRole } from "./lib/authz";

// These feed live subscriptions that re-execute on every matching write, so an unbounded read
// re-reads a tenant's whole history each time and eventually crosses Convex's per-query read
// limit, where the query does not degrade but hard-fails. completeAnalysis already refuses more
// than 500 findings or requirements per review, so the evidence ceiling is well clear of any
// real review.
const listCeiling = 500;
const evidenceCeiling = 1_000;

const publicReview = (review: {
  _id: unknown; repositoryId: unknown; prNumber: number; headSha: string; status: string; statusReasonCode?: string;
  isStale: boolean; coverageLevel: string; currentStage: string; nextActionCode: string;
  githubCheckConclusion?: string; createdAt: number; updatedAt: number;
}) => ({
  id: review._id, repositoryId: review.repositoryId, prNumber: review.prNumber,
  headSha: review.headSha, status: review.status, statusReasonCode: review.statusReasonCode, isStale: review.isStale,
  coverageLevel: review.coverageLevel, currentStage: review.currentStage,
  nextActionCode: review.nextActionCode, githubCheckConclusion: review.githubCheckConclusion,
  createdAt: review.createdAt, updatedAt: review.updatedAt,
});

export const list = query({
  args: { organizationId: v.id("organizations"), repositoryId: v.optional(v.id("repositories")) },
  handler: async (ctx, args) => {
    await requireOrganizationRole(ctx, args.organizationId, "viewer");
    if (args.repositoryId) await requireRepositoryRole(ctx, args.repositoryId, "viewer", args.organizationId);
    const reviews = args.repositoryId
      ? await ctx.db.query("reviews").withIndex("by_repo_pr_head_mode", (q) => q.eq("repositoryId", args.repositoryId!)).order("desc").take(listCeiling)
      : await ctx.db.query("reviews").withIndex("by_org_status", (q) => q.eq("organizationId", args.organizationId)).order("desc").take(listCeiling);
    return reviews.map(publicReview);
  },
});

export const get = query({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new Error("not_found_or_forbidden");
    await requireRepositoryRole(ctx, review.repositoryId, "viewer", review.organizationId);
    return publicReview(review);
  },
});

export const getEvidence = query({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new Error("not_found_or_forbidden");
    const access = await requireRepositoryRole(ctx, review.repositoryId, "viewer", review.organizationId);
    const [requirements, findings, checks, rounds, events] = await Promise.all([
      ctx.db.query("requirements").withIndex("by_review", q => q.eq("reviewId", review._id)).take(evidenceCeiling),
      ctx.db.query("findings").withIndex("by_review_severity", q => q.eq("reviewId", review._id)).take(evidenceCeiling),
      ctx.db.query("checkRuns").withIndex("by_review", q => q.eq("reviewId", review._id)).take(evidenceCeiling),
      ctx.db.query("autofixRounds").withIndex("by_review_round", q => q.eq("reviewId", review._id)).take(evidenceCeiling),
      ctx.db.query("reviewEvents").withIndex("by_review", q => q.eq("reviewId", review._id)).take(evidenceCeiling),
    ]);
    return { review: { ...publicReview(review), baseSha: review.baseSha, baseRef: review.baseRef, mode: review.mode,
      statusReasonCode: review.statusReasonCode, trigger: review.trigger, provider: review.provider, model: review.model,
      budgetLimit: review.budgetLimit, budgetConsumed: review.budgetConsumed, completedAt: review.completedAt },
      repository: { owner: access.repository.owner, name: access.repository.name },
      requirements: requirements.map(item => ({ id: item._id, sourceType: item.sourceType, status: item.status, confidence: item.confidence,
        hasSource: Boolean(item.contentArtifactId), fetchedAt: item.fetchedAt })),
      findings: findings.map(item => ({ id: item._id, category: item.category, severity: item.severity, confidence: item.confidence,
        blocking: item.blocking, pathFingerprint: item.pathHmac.slice(0, 12), startLine: item.startLine, endLine: item.endLine,
        evidenceCount: item.evidenceIds.length, resolution: item.resolution, ruleId: item.ruleId })),
      checks: checks.map(item => ({ id: item._id, kind: item.kind, required: item.required, status: item.status,
        conclusion: item.conclusion, commitSha: item.commitSha, exitCode: item.exitCode, durationMs: item.durationMs,
        evidenceAvailable: Boolean(item.artifactId), failureClass: item.failureClass })),
      rounds: rounds.map(item => ({ id: item._id, roundNumber: item.roundNumber, candidateCommitSha: item.candidateCommitSha,
        validationOutcome: item.validationOutcome, completedValidation: item.completedValidation, startedAt: item.startedAt, completedAt: item.completedAt })),
      events: events.map(item => ({ id: item._id, sequence: item.sequence, type: item.type, stage: item.stage,
        code: item.internalCode, hasPublicMessage: Boolean(item.publicMessageArtifactId), createdAt: item.createdAt })),
    };
  },
});

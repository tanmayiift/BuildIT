import { v } from "convex/values";
import { runIdFor } from "./lib/runIdentity";
import { blockingFindingCount } from "./lib/blockingFindings";
import { query } from "./_generated/server";
import { requireOrganizationRole, requireRepositoryRole } from "./lib/authz";
import { totalCostUsd } from "./lib/usageCost";

// These feed live subscriptions that re-execute on every matching write, so an unbounded read
// re-reads a tenant's whole history each time and eventually crosses Convex's per-query read
// limit, where the query does not degrade but hard-fails. completeAnalysis already refuses more
// than 500 findings or requirements per review, so the evidence ceiling is well clear of any
// real review.
const listCeiling = 500;
const evidenceCeiling = 1_000;
// A pull request reviewed more times than this is being debugged, not read: the newest runs are
// the ones a diff is asked about.
const historyCeiling = 50;

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
    const [requirements, findings, checks, rounds, events, stageRuns, ledger] = await Promise.all([
      ctx.db.query("requirements").withIndex("by_review", q => q.eq("reviewId", review._id)).take(evidenceCeiling),
      ctx.db.query("findings").withIndex("by_review_severity", q => q.eq("reviewId", review._id)).take(evidenceCeiling),
      ctx.db.query("checkRuns").withIndex("by_review", q => q.eq("reviewId", review._id)).take(evidenceCeiling),
      ctx.db.query("autofixRounds").withIndex("by_review_round", q => q.eq("reviewId", review._id)).take(evidenceCeiling),
      ctx.db.query("reviewEvents").withIndex("by_review", q => q.eq("reviewId", review._id)).take(evidenceCeiling),
      ctx.db.query("modelStageRuns").withIndex("by_review", q => q.eq("reviewId", review._id)).take(evidenceCeiling),
      ctx.db.query("usageLedger").withIndex("by_review", q => q.eq("reviewId", review._id)).take(evidenceCeiling),
    ]);
    return { review: { ...publicReview(review), baseSha: review.baseSha, baseRef: review.baseRef, mode: review.mode,
      statusReasonCode: review.statusReasonCode, trigger: review.trigger, provider: review.provider, model: review.model,
      budgetLimit: review.budgetLimit, budgetConsumed: review.budgetConsumed, completedAt: review.completedAt },
      repository: { owner: access.repository.owner, name: access.repository.name },
      requirements: requirements.map(item => ({ id: item._id, sourceType: item.sourceType, status: item.status, confidence: item.confidence,
        hasSource: Boolean(item.contentArtifactId), fetchedAt: item.fetchedAt })),
      // fingerprintHmac is the only handle a person has on a single finding: findings:dismiss
      // identifies what is being dismissed by it, and nothing else this query returns can. It is a
      // keyed HMAC of the finding's identity - dataClassification.ts classifies it hashed_metadata -
      // so it names a finding without carrying a path, a line of code, or anything reversible, and
      // it is already scoped to this review by the same repository check as every field beside it.
      findings: findings.map(item => ({ id: item._id, category: item.category, severity: item.severity, confidence: item.confidence,
        blocking: item.blocking, fingerprintHmac: item.fingerprintHmac, pathFingerprint: item.pathHmac.slice(0, 12),
        startLine: item.startLine, endLine: item.endLine,
        evidenceCount: item.evidenceIds.length, resolution: item.resolution, ruleId: item.ruleId })),
      checks: checks.map(item => ({ id: item._id, kind: item.kind, required: item.required, status: item.status,
        conclusion: item.conclusion, commitSha: item.commitSha, exitCode: item.exitCode, durationMs: item.durationMs,
        evidenceAvailable: Boolean(item.artifactId), failureClass: item.failureClass })),
      rounds: rounds.map(item => ({ id: item._id, roundNumber: item.roundNumber, candidateCommitSha: item.candidateCommitSha,
        validationOutcome: item.validationOutcome, completedValidation: item.completedValidation, startedAt: item.startedAt, completedAt: item.completedAt })),
      events: events.map(item => ({ id: item._id, sequence: item.sequence, type: item.type, stage: item.stage,
        code: item.internalCode, hasPublicMessage: Boolean(item.publicMessageArtifactId), createdAt: item.createdAt })),
      // Every field a reviewer of BuildIT asked for and could not find: what each stage was given,
      // what it returned, how long it took, what it cost, and the provider's own id for the call so
      // the claim can be checked against a bill. durationMs and costMicros were both computable
      // before and stored nowhere - the cost was calculated to charge the budget and discarded, and
      // the duration was never measured at all.
      stages: stageRuns.map(item => ({ id: item._id, stage: item.stage, roundNumber: item.roundNumber,
        provider: item.provider, model: item.model, attempt: item.attempt, outcome: item.outcome,
        finishReason: item.finishReason, inputTokens: item.inputTokens, outputTokens: item.outputTokens,
        promptVersion: item.promptVersion, createdAt: item.createdAt,
        runId: item.runId, durationMs: item.durationMs, costUsd: item.costMicros === undefined ? undefined : item.costMicros / 1_000_000,
        requestId: item.requestId, requestHash: item.requestHash.slice(0, 12) })),
      // The run this page is showing. Older rows predate runId, so the review's current identity is
      // the fallback rather than a guess at which generation an unlabelled row belonged to.
      runId: runIdFor(review._id, review.executionGeneration),
      // Sum of measured provider time. Deliberately not review.completedAt - review.startedAt:
      // startedAt is re-stamped on every execution generation, which is why /proof publishes no
      // duration at all. This number is the part that was actually measured, and it says so.
      modelDurationMs: stageRuns.reduce((sum, item) => sum + (item.durationMs ?? 0), 0),
      stagesMissingDuration: stageRuns.filter(item => item.durationMs === undefined).length,
      spend: { costUsd: totalCostUsd(ledger), inputTokens: stageRuns.reduce((sum, item) => sum + item.inputTokens, 0),
        outputTokens: stageRuns.reduce((sum, item) => sum + item.outputTokens, 0) },
    };
  },
});

// L5 observability asks whether two runs can be compared. Until now each run could only be read on
// its own, so "it found this last time and not this time" - the exact failure that motivated the
// detection suite - could not be seen in the product at all.
export const runHistory = query({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new Error("not_found_or_forbidden");
    await requireRepositoryRole(ctx, review.repositoryId, "viewer", review.organizationId);
    // Every run of the same pull request, newest first, whatever commit it pinned - comparing runs
    // across commits is the point, since that is how a regression in the reviewer shows up.
    const runs = await ctx.db.query("reviews")
      .withIndex("by_repo_pr_head_mode", q => q.eq("repositoryId", review.repositoryId).eq("prNumber", review.prNumber))
      .take(historyCeiling);
    const summaries = await Promise.all(runs.map(async run => {
      const [stages, ledger, findings] = await Promise.all([
        ctx.db.query("modelStageRuns").withIndex("by_review", q => q.eq("reviewId", run._id)).take(evidenceCeiling),
        ctx.db.query("usageLedger").withIndex("by_review", q => q.eq("reviewId", run._id)).take(evidenceCeiling),
        ctx.db.query("findings").withIndex("by_review_severity", q => q.eq("reviewId", run._id)).take(evidenceCeiling),
      ]);
      return {
        id: run._id, headSha: run.headSha, status: run.status, mode: run.mode,
        statusReasonCode: run.statusReasonCode, createdAt: run.createdAt, completedAt: run.completedAt,
        promptVersion: run.promptVersion, model: run.model, provider: run.provider,
        stageCount: stages.length,
        repairedStages: stages.filter(item => item.outcome !== "valid").length,
        inputTokens: stages.reduce((sum, item) => sum + item.inputTokens, 0),
        outputTokens: stages.reduce((sum, item) => sum + item.outputTokens, 0),
        costUsd: totalCostUsd(ledger),
        blockingFindings: blockingFindingCount(findings),
        totalFindings: findings.length,
        isCurrent: run._id === review._id,
      };
    }));
    return summaries.sort((left, right) => right.createdAt - left.createdAt);
  },
});

// The comparison itself. Findings are matched on their fingerprint, which is what makes "the same
// defect" a fact rather than a guess about two titles that read alike.
export const compareRuns = query({
  args: { leftReviewId: v.id("reviews"), rightReviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const [left, right] = await Promise.all([ctx.db.get(args.leftReviewId), ctx.db.get(args.rightReviewId)]);
    if (!left || !right) throw new Error("not_found_or_forbidden");
    // Both sides are authorized separately, so a comparison can never be a way to read across a
    // repository boundary.
    await requireRepositoryRole(ctx, left.repositoryId, "viewer", left.organizationId);
    await requireRepositoryRole(ctx, right.repositoryId, "viewer", right.organizationId);
    if (left.repositoryId !== right.repositoryId || left.prNumber !== right.prNumber) throw new Error("not_found_or_forbidden");

    const side = async (run: typeof left) => {
      const [stages, ledger, findings] = await Promise.all([
        ctx.db.query("modelStageRuns").withIndex("by_review", q => q.eq("reviewId", run._id)).take(evidenceCeiling),
        ctx.db.query("usageLedger").withIndex("by_review", q => q.eq("reviewId", run._id)).take(evidenceCeiling),
        ctx.db.query("findings").withIndex("by_review_severity", q => q.eq("reviewId", run._id)).take(evidenceCeiling),
      ]);
      return { run, stages, costUsd: totalCostUsd(ledger), findings };
    };
    const [a, b] = await Promise.all([side(left), side(right)]);

    const stageNames = [...new Set([...a.stages, ...b.stages].map(item => item.stage))];
    const stageRows = stageNames.map(stage => {
      const leftStage = a.stages.filter(item => item.stage === stage);
      const rightStage = b.stages.filter(item => item.stage === stage);
      const tokens = (items: typeof leftStage) => items.reduce((sum, item) => sum + item.inputTokens + item.outputTokens, 0);
      return {
        stage,
        left: leftStage.length ? { ran: true, attempts: leftStage.length, tokens: tokens(leftStage), repaired: leftStage.some(item => item.outcome !== "valid") } : { ran: false, attempts: 0, tokens: 0, repaired: false },
        right: rightStage.length ? { ran: true, attempts: rightStage.length, tokens: tokens(rightStage), repaired: rightStage.some(item => item.outcome !== "valid") } : { ran: false, attempts: 0, tokens: 0, repaired: false },
      };
    });

    const leftPrints = new Set(a.findings.map(item => item.fingerprintHmac));
    const rightPrints = new Set(b.findings.map(item => item.fingerprintHmac));
    const describe = (item: (typeof a.findings)[number]) => ({
      severity: item.severity, category: item.category, blocking: item.blocking, resolution: item.resolution,
      startLine: item.startLine, endLine: item.endLine,
    });
    return {
      left: { id: left._id, headSha: left.headSha, status: left.status, costUsd: a.costUsd, promptVersion: left.promptVersion, model: left.model },
      right: { id: right._id, headSha: right.headSha, status: right.status, costUsd: b.costUsd, promptVersion: right.promptVersion, model: right.model },
      statusChanged: left.status !== right.status,
      costDeltaUsd: b.costUsd - a.costUsd,
      stages: stageRows,
      // "Lost" is the column that matters: a defect reported by the earlier run and not the later
      // one is either fixed in the diff or a regression in the reviewer, and only a person can say
      // which.
      onlyInLeft: a.findings.filter(item => !rightPrints.has(item.fingerprintHmac)).map(describe),
      onlyInRight: b.findings.filter(item => !leftPrints.has(item.fingerprintHmac)).map(describe),
      inBoth: a.findings.filter(item => rightPrints.has(item.fingerprintHmac)).length,
    };
  },
});

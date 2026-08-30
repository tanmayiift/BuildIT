import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { assertReviewParent } from "./lib/parentConsistency";
import { checkConclusion, checkKind } from "./validators";

const executionArgs = { organizationId: v.id("organizations"), reviewId: v.id("reviews"), expectedHeadSha: v.string(), expectedGeneration: v.number() };
const hash = v.string();

export const scope = internalQuery({
  args: executionArgs,
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId), repository = await ctx.db.get((await assertReviewParent(ctx.db, args.organizationId, args.reviewId)).repositoryId);
    const installation = repository ? await ctx.db.get(repository.installationId) : null;
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale || review.mode !== "autofix" || review.status !== "validating" || review.currentStage !== "analysis") throw new ConvexError("autofix_not_ready");
    if (!repository || !repository.enabled || repository.organizationId !== args.organizationId || review.isFork || repository.autofixMode !== "stacked" || !installation || installation.organizationId !== args.organizationId || installation.status !== "active") throw new ConvexError("autofix_delivery_unavailable");
    const artifacts = await ctx.db.query("artifacts").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
    const analysis = artifacts.find(item => item.type === "prompt_trace" && item.redactionStatus === "redacted" && !item.deletedAt && item.storageKey.endsWith("/analysis.json"));
    const contexts = artifacts.filter(item => item.type === "repository_snapshot" && item.redactionStatus === "redacted" && !item.deletedAt && /\/context-(?:base|head)-\d+\.json$/.test(item.storageKey));
    if (!analysis || !contexts.length || contexts.some(item => item.organizationId !== args.organizationId || item.repositoryId !== repository._id)) throw new ConvexError("autofix_evidence_unavailable");
    const rounds = await ctx.db.query("autofixRounds").withIndex("by_review_round", q => q.eq("reviewId", review._id)).collect();
    return { organizationId: review.organizationId, repositoryId: repository._id, reviewId: review._id, installationId: installation.installationId, githubRepositoryId: repository.githubRepositoryId, prNumber: review.prNumber,
      headSha: review.headSha, baseSha: review.baseSha, createdAt: review.createdAt, configRevisionId: review.configRevisionId, runnerImageVersion: review.runnerImageVersion,
      analysis: { id: analysis._id, storageKey: analysis.storageKey, checksum: analysis.checksum, size: analysis.size },
      contexts: contexts.map(item => ({ id: item._id, storageKey: item.storageKey, checksum: item.checksum, size: item.size })), rounds: rounds.map(item => ({ roundNumber: item.roundNumber, candidateCommitSha: item.candidateCommitSha, outcome: item.validationOutcome })) };
  },
});

export const reserveArtifact = internalMutation({
  args: { ...executionArgs, roundNumber: v.number(), slot: v.string(), type: v.union(v.literal("patch"), v.literal("command_output"), v.literal("review_message")), checksum: hash, size: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale || review.mode !== "autofix" || !Number.isInteger(args.roundNumber) || args.roundNumber < 1 || args.roundNumber > 3 || !/^[a-z0-9-]{1,40}$/.test(args.slot) || !/^[0-9a-f]{64}$/.test(args.checksum) || !Number.isInteger(args.size) || args.size < 1 || args.size > 4_000_000) throw new ConvexError("invalid_autofix_artifact");
    const suffix = `/autofix-${args.roundNumber}-${args.slot}.${args.type === "review_message" ? "md" : "json"}`;
    const prior = (await ctx.db.query("artifacts").withIndex("by_review", q => q.eq("reviewId", review._id)).collect()).find(item => item.storageKey.endsWith(suffix));
    if (prior) { if (prior.type !== args.type || prior.checksum !== args.checksum || prior.size !== args.size) throw new ConvexError("autofix_artifact_conflict"); return { artifactId: prior._id, storageKey: prior.storageKey }; }
    const artifactId = await ctx.db.insert("artifacts", { organizationId: args.organizationId, repositoryId: review.repositoryId, reviewId: review._id, type: args.type, storageKey: "pending", encrypted: true, checksum: args.checksum, size: args.size, redactionStatus: "pending", expiresAt: Math.min(review.expiresAt, args.now + 7 * 86_400_000), deletionAttempts: 0 });
    const storageKey = `artifacts/${args.organizationId}/${review.repositoryId}/${review._id}/${artifactId}${suffix}`;
    await ctx.db.patch(artifactId, { storageKey }); return { artifactId, storageKey };
  },
});

export const completeArtifact = internalMutation({
  args: { ...executionArgs, artifactId: v.id("artifacts"), checksum: hash, size: v.number() },
  handler: async (ctx, args) => { const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId), artifact = await ctx.db.get(args.artifactId); if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale || !artifact || artifact.organizationId !== args.organizationId || artifact.repositoryId !== review.repositoryId || artifact.reviewId !== review._id || artifact.checksum !== args.checksum || artifact.size !== args.size || artifact.deletedAt) throw new ConvexError("autofix_artifact_mismatch"); if (artifact.redactionStatus === "redacted") return artifact._id; if (artifact.redactionStatus !== "pending") throw new ConvexError("autofix_artifact_mismatch"); await ctx.db.patch(artifact._id, { redactionStatus: "redacted" }); return artifact._id; },
});

const summary = v.object({ commitSha: v.string(), planId: v.string(), kind: checkKind, required: v.boolean(), conclusion: checkConclusion, exitCode: v.optional(v.number()), durationMs: v.number(), commandFingerprint: hash, nameHash: hash });
export const completeRound = internalMutation({
  args: { ...executionArgs, roundNumber: v.number(), candidateCommitSha: v.string(), patchFingerprint: hash, patchArtifactId: v.id("artifacts"), validationArtifactId: v.id("artifacts"), summaries: v.array(summary), outcome: v.union(v.literal("passed"), v.literal("failed"), v.literal("incomplete")), now: v.number() },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId), patch = await ctx.db.get(args.patchArtifactId), validation = await ctx.db.get(args.validationArtifactId);
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale || review.mode !== "autofix" || !/^[0-9a-f]{40}$/.test(args.candidateCommitSha) || !/^[0-9a-f]{64}$/.test(args.patchFingerprint) || !patch || !validation || patch.organizationId !== args.organizationId || validation.organizationId !== args.organizationId || patch.repositoryId !== review.repositoryId || validation.repositoryId !== review.repositoryId || patch.reviewId !== review._id || validation.reviewId !== review._id || patch.type !== "patch" || validation.type !== "command_output" || patch.redactionStatus !== "redacted" || validation.redactionStatus !== "redacted") throw new ConvexError("autofix_round_mismatch");
    const existing = await ctx.db.query("autofixRounds").withIndex("by_review_round", q => q.eq("reviewId", review._id).eq("roundNumber", args.roundNumber)).unique();
    if (existing) { if (existing.candidateCommitSha !== args.candidateCommitSha || existing.validationOutcome !== args.outcome) throw new ConvexError("autofix_round_conflict"); return existing._id; }
    const attemptId = await ctx.db.insert("autofixAttempts", { organizationId: args.organizationId, reviewId: review._id, attemptNumber: args.roundNumber, patchFingerprint: args.patchFingerprint, patchArtifactId: patch._id, outcome: "applied", promptVersion: "patch-v1", startedAt: args.now, completedAt: args.now });
    const roundId = await ctx.db.insert("autofixRounds", { organizationId: args.organizationId, reviewId: review._id, roundNumber: args.roundNumber, attemptId, candidateCommitSha: args.candidateCommitSha, validationScope: "final_validation", validationOutcome: args.outcome, completedValidation: true, startedAt: args.now, completedAt: args.now });
    for (const item of args.summaries) { if (item.commitSha !== args.candidateCommitSha || !/^[0-9a-f]{64}$/.test(item.commandFingerprint) || !/^[0-9a-f]{64}$/.test(item.nameHash)) throw new ConvexError("autofix_summary_invalid"); await ctx.db.insert("checkRuns", { organizationId: args.organizationId, reviewId: review._id, roundId, kind: item.kind, nameHash: item.nameHash, required: item.required, status: "completed", conclusion: item.conclusion, commandFingerprint: item.commandFingerprint, commitSha: item.commitSha, ...(item.exitCode === undefined ? {} : { exitCode: item.exitCode }), durationMs: item.durationMs, artifactId: validation._id, ...(item.conclusion === "failed" ? { failureClass: "code" as const } : {}), startedAt: Math.max(0, args.now - item.durationMs), completedAt: args.now }); }
    await ctx.db.patch(review._id, { status: "autofixing", currentStage: "autofix", patchAttemptCount: args.roundNumber, completedRoundCount: args.roundNumber, updatedAt: args.now }); return roundId;
  },
});

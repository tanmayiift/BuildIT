import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { checkConclusion, checkKind } from "./validators";
import { assertReviewParent } from "./lib/parentConsistency";

const executionArgs = { organizationId: v.id("organizations"), reviewId: v.id("reviews"), expectedHeadSha: v.string(), expectedGeneration: v.number() };
const hash = v.string();

export const validationScope = internalQuery({
  args: executionArgs,
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId), organization = await ctx.db.get(args.organizationId);
    if (!organization || organization.deletedAt) throw new ConvexError("organization_unavailable");
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale) throw new ConvexError("stale_or_replaced_review");
    const artifacts = (await ctx.db.query("artifacts").withIndex("by_review", q => q.eq("reviewId", review._id)).collect());
    const contexts = artifacts.filter(item => item.type === "repository_snapshot" && item.redactionStatus === "redacted" && !item.deletedAt).sort((a, b) => a.storageKey.localeCompare(b.storageKey));
    if (!contexts.length || contexts.some(item => item.organizationId !== args.organizationId || item.repositoryId !== review.repositoryId)) throw new ConvexError("review_context_unavailable");
    const completed = artifacts.find(item => item.type === "command_output" && item.redactionStatus === "redacted" && item.storageKey.endsWith("/validation.json"));
    return { organizationId: review.organizationId, repositoryId: review.repositoryId, reviewId: review._id, headSha: review.headSha, baseSha: review.baseSha,
      configRevisionId: review.configRevisionId, runnerImageVersion: review.runnerImageVersion, expiresAt: review.expiresAt,
      ...(completed ? { completedArtifactId: completed._id } : {}), contexts: contexts.map(item => ({ id: item._id, storageKey: item.storageKey, checksum: item.checksum, size: item.size })) };
  },
});

export const reserveOutput = internalMutation({
  args: { ...executionArgs, checksum: hash, size: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale) throw new ConvexError("stale_or_replaced_review");
    if (!/^[0-9a-f]{64}$/.test(args.checksum) || !Number.isInteger(args.size) || args.size < 1 || args.size > 4_000_000) throw new ConvexError("invalid_validation_artifact");
    const prior = (await ctx.db.query("artifacts").withIndex("by_review", q => q.eq("reviewId", review._id)).collect()).find(item => item.type === "command_output" && item.storageKey.endsWith("/validation.json"));
    if (prior) { if (prior.checksum !== args.checksum || prior.size !== args.size) throw new ConvexError("validation_artifact_conflict"); return { artifactId: prior._id, storageKey: prior.storageKey }; }
    const artifactId = await ctx.db.insert("artifacts", { organizationId: args.organizationId, repositoryId: review.repositoryId, reviewId: review._id,
      type: "command_output", storageKey: "pending", encrypted: true, checksum: args.checksum, size: args.size, redactionStatus: "pending",
      expiresAt: Math.min(review.expiresAt, args.now + 7 * 86_400_000), deletionAttempts: 0 });
    const storageKey = `artifacts/${args.organizationId}/${review.repositoryId}/${review._id}/${artifactId}/validation.json`;
    await ctx.db.patch(artifactId, { storageKey });
    return { artifactId, storageKey };
  },
});

const summary = v.object({ revision: v.union(v.literal("base"), v.literal("head")), commitSha: v.string(), planId: v.string(), kind: checkKind,
  required: v.boolean(), conclusion: checkConclusion, exitCode: v.optional(v.number()), durationMs: v.number(), commandFingerprint: hash, nameHash: hash });
export const completeValidation = internalMutation({
  args: { ...executionArgs, artifactId: v.id("artifacts"), checksum: hash, size: v.number(), summaries: v.array(summary), manager: v.union(v.literal("npm"), v.literal("pnpm"), v.literal("yarn")), now: v.number() },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId), artifact = await ctx.db.get(args.artifactId), config = await ctx.db.get(review.configRevisionId);
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale) throw new ConvexError("stale_or_replaced_review");
    if (!config || config.organizationId !== args.organizationId || config.repositoryId !== review.repositoryId) throw new ConvexError("configuration_scope_mismatch");
    if (!artifact || artifact.organizationId !== args.organizationId || artifact.repositoryId !== review.repositoryId || artifact.reviewId !== review._id || artifact.type !== "command_output" || artifact.checksum !== args.checksum || artifact.size !== args.size) throw new ConvexError("validation_artifact_mismatch");
    if (!args.summaries.length || args.summaries.length > 12) throw new ConvexError("validation_summary_invalid");
    for (const item of args.summaries) if (!/^[0-9a-f]{40}$/.test(item.commitSha) || !/^[0-9a-f]{64}$/.test(item.commandFingerprint) || !/^[0-9a-f]{64}$/.test(item.nameHash) || !Number.isInteger(item.durationMs) || item.durationMs < 0 || item.durationMs > 240_000 || (item.revision === "base" ? review.baseSha : review.headSha) !== item.commitSha) throw new ConvexError("validation_summary_invalid");
    const existing = await ctx.db.query("checkRuns").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
    if (artifact.redactionStatus === "redacted" && existing.length) return artifact._id;
    if (artifact.redactionStatus !== "pending") throw new ConvexError("validation_artifact_mismatch");
    await ctx.db.patch(artifact._id, { redactionStatus: "redacted" });
    for (const item of args.summaries) {
      await ctx.db.insert("checkRuns", { organizationId: args.organizationId, reviewId: review._id, kind: item.kind, nameHash: item.nameHash,
        required: item.required, status: "completed", conclusion: item.conclusion, commandFingerprint: item.commandFingerprint, commitSha: item.commitSha,
        ...(item.exitCode === undefined ? {} : { exitCode: item.exitCode }), durationMs: item.durationMs, artifactId: artifact._id,
        ...(item.conclusion === "failed" ? { failureClass: "code" as const } : {}), startedAt: Math.max(0, args.now - item.durationMs), completedAt: args.now });
      if (item.revision === "base") {
        const cached = await ctx.db.query("baseResults").withIndex("by_full_cache_key", q => q.eq("repositoryId", review.repositoryId).eq("baseSha", review.baseSha).eq("commandFingerprint", item.commandFingerprint).eq("configRevisionId", review.configRevisionId).eq("runnerImageVersion", review.runnerImageVersion).eq("architecture", "linux-x64").eq("networkPolicyVersion", "deny-all-v1")).unique();
        if (!cached) await ctx.db.insert("baseResults", { organizationId: args.organizationId, repositoryId: review.repositoryId, baseSha: review.baseSha,
          commandFingerprint: item.commandFingerprint, configRevisionId: review.configRevisionId, runnerImageVersion: review.runnerImageVersion,
          toolVersions: [{ name: "node", version: "24" }, { name: "package-manager", version: args.manager }], architecture: "linux-x64", networkPolicyVersion: "deny-all-v1",
          conclusion: item.conclusion, artifactId: artifact._id, computedAt: args.now, expiresAt: Math.min(review.expiresAt, args.now + 7 * 86_400_000) });
      }
    }
    const durationMs = args.summaries.reduce((sum, item) => sum + item.durationMs, 0);
    await ctx.db.insert("usageLedger", { organizationId: args.organizationId, repositoryId: review.repositoryId, reviewId: review._id, kind: "sandbox_seconds", quantity: Math.ceil(durationMs / 1000), unitCost: 0, currency: "platform", occurredAt: args.now });
    await ctx.db.patch(review._id, { status: "validating", currentStage: "validation", updatedAt: args.now });
    return artifact._id;
  },
});

export const finalizeDecision = internalMutation({
  args: { ...executionArgs, now: v.number() },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId), organization = await ctx.db.get(args.organizationId);
    if (!organization || organization.deletedAt) throw new ConvexError("organization_unavailable");
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale) throw new ConvexError("stale_or_replaced_review");
    if (["checks_passed", "changes_requested", "inconclusive"].includes(review.status) && review.statusReasonCode && review.completedAt) return { status: review.status, statusReasonCode: review.statusReasonCode, nextActionCode: review.nextActionCode };
    if (review.status !== "validating" || review.currentStage !== "analysis") throw new ConvexError("review_not_ready_for_decision");
    const checks = (await ctx.db.query("checkRuns").withIndex("by_review", q => q.eq("reviewId", review._id)).collect()).filter(item => item.commitSha === review.headSha);
    const findings = await ctx.db.query("findings").withIndex("by_review_severity", q => q.eq("reviewId", review._id)).collect();
    let incomplete = review.coverageLevel !== "full" || !checks.some(item => item.required);
    let failed = false;
    for (const check of checks.filter(item => item.required)) {
      const artifact = check.artifactId ? await ctx.db.get(check.artifactId) : null;
      if (!artifact || artifact.organizationId !== args.organizationId || artifact.reviewId !== review._id || artifact.redactionStatus !== "redacted" || artifact.deletedAt || !["passed", "failed"].includes(check.conclusion)) incomplete = true;
      if (check.conclusion === "failed") failed = true;
    }
    const blocking = findings.some(item => item.resolution === "open" && item.blocking);
    const status = incomplete ? "inconclusive" as const : failed || blocking ? "changes_requested" as const : "checks_passed" as const;
    const statusReasonCode = incomplete ? "required_check_missing" as const : failed ? "required_check_failed" as const : blocking ? "blocking_findings" as const : "checks_complete" as const;
    const nextActionCode = incomplete ? "retry_review" as const : failed || blocking ? "inspect_findings" as const : "none" as const;
    const githubCheckConclusion = status === "checks_passed" ? "success" as const : status === "changes_requested" ? "failure" as const : "neutral" as const;
    await ctx.db.patch(review._id, { status, statusReasonCode, nextActionCode, githubCheckConclusion, currentStage: "complete", completedAt: args.now, updatedAt: args.now });
    await ctx.db.insert("reviewEvents", { organizationId: args.organizationId, reviewId: review._id, sequence: 5, type: "status_changed", stage: "complete", internalCode: `decision_${statusReasonCode}`, metadata: { count: findings.length }, createdAt: args.now });
    await ctx.db.insert("metricEvents", { organizationId: args.organizationId, repositoryId: review.repositoryId, reviewId: review._id, name: "review_completed", value: 1, organizationTimezone: organization.timezone, occurredAt: args.now });
    return { status, statusReasonCode, nextActionCode };
  },
});

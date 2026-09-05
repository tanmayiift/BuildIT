import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { checkConclusion, checkKind } from "./validators";
import { blocksVerdict } from "./lib/coverageGate";
import { computeReviewDecision } from "@buildit/contracts";
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
  required: v.boolean(), conclusion: checkConclusion, exitCode: v.optional(v.number()), durationMs: v.number(), commandFingerprint: hash, nameHash: hash,
  credentialTeardownProved: v.literal(true), sandboxStopped: v.literal(true), executionFingerprint:v.optional(hash),outputHash:v.optional(hash),outputTruncated:v.optional(v.boolean()),
  scannerName:v.optional(v.string()),scannerVersion:v.optional(v.string()),regressionClassification:v.optional(v.union(v.literal("introduced"),v.literal("pre_existing"),v.literal("resolved"),v.literal("unchanged_pass"),v.literal("flaky"),v.literal("unknown"))) });
export const completeValidation = internalMutation({
  args: { ...executionArgs, artifactId: v.id("artifacts"), checksum: hash, size: v.number(), summaries: v.array(summary), manager: v.union(v.literal("npm"), v.literal("pnpm"), v.literal("yarn"), v.literal("none")), now: v.number() },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId), artifact = await ctx.db.get(args.artifactId), config = await ctx.db.get(review.configRevisionId);
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale) throw new ConvexError("stale_or_replaced_review");
    if (!config || config.organizationId !== args.organizationId || config.repositoryId !== review.repositoryId) throw new ConvexError("configuration_scope_mismatch");
    if (!artifact || artifact.organizationId !== args.organizationId || artifact.repositoryId !== review.repositoryId || artifact.reviewId !== review._id || artifact.type !== "command_output" || artifact.checksum !== args.checksum || artifact.size !== args.size) throw new ConvexError("validation_artifact_mismatch");
    // The bounded default plan has install, test, lint, and typecheck plus three
    // scanners for both base and head commits: fourteen records. Repositories
    // may add one trusted check, so sixteen is the explicit maximum.
    if (!args.summaries.length || args.summaries.length > 16) throw new ConvexError("validation_summary_invalid");
    for (const item of args.summaries) if (!/^[0-9a-f]{40}$/.test(item.commitSha) || !/^[0-9a-f]{64}$/.test(item.commandFingerprint) || !/^[0-9a-f]{64}$/.test(item.nameHash) || (item.executionFingerprint&&!/^[0-9a-f]{64}$/.test(item.executionFingerprint)) || (item.outputHash&&!/^[0-9a-f]{64}$/.test(item.outputHash)) || !Number.isInteger(item.durationMs) || item.durationMs < 0 || item.durationMs > 240_000 || (item.revision === "base" ? review.baseSha : review.headSha) !== item.commitSha) throw new ConvexError("validation_summary_invalid");
    const existing = await ctx.db.query("checkRuns").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
    if (artifact.redactionStatus === "redacted" && existing.length) return artifact._id;
    if (artifact.redactionStatus !== "pending") throw new ConvexError("validation_artifact_mismatch");
    await ctx.db.patch(artifact._id, { redactionStatus: "redacted" });
    for (const item of args.summaries) {
      await ctx.db.insert("checkRuns", { organizationId: args.organizationId, reviewId: review._id, kind: item.kind, nameHash: item.nameHash,
        required: item.required, status: "completed", conclusion: item.conclusion, commandFingerprint: item.commandFingerprint, commitSha: item.commitSha,
        ...(item.exitCode === undefined ? {} : { exitCode: item.exitCode }), durationMs: item.durationMs, artifactId: artifact._id,
        credentialTeardownProved: item.credentialTeardownProved, sandboxStopped: item.sandboxStopped,
        ...(item.executionFingerprint?{executionFingerprint:item.executionFingerprint}:{}),...(item.outputHash?{outputHash:item.outputHash}:{}),...(item.outputTruncated===undefined?{}:{outputTruncated:item.outputTruncated}),
        ...(item.scannerName?{scannerName:item.scannerName}:{}),...(item.scannerVersion?{scannerVersion:item.scannerVersion}:{}),...(item.regressionClassification?{regressionClassification:item.regressionClassification}:{}),
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

// Mirrors uncertainEscalationLimit in @buildit/orchestrator, which cannot be imported into the
// default Convex runtime. tests/architecture pins them to the same value.
const uncertainEscalationLimit = 2;

export const finalizeDecision = internalMutation({
  args: { ...executionArgs, reportArtifactId: v.id("artifacts"), now: v.number() },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId), organization = await ctx.db.get(args.organizationId), report = await ctx.db.get(args.reportArtifactId);
    if (!organization || organization.deletedAt) throw new ConvexError("organization_unavailable");
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale) throw new ConvexError("stale_or_replaced_review");
    if (!report || report.organizationId !== args.organizationId || report.repositoryId !== review.repositoryId || report.reviewId !== review._id || report.type !== "review_message" || report.redactionStatus !== "redacted" || report.deletedAt || !report.storageKey.endsWith("/report.md")) throw new ConvexError("report_artifact_mismatch");
    if (["checks_passed", "changes_requested", "inconclusive"].includes(review.status) && review.statusReasonCode && review.completedAt) return { status: review.status, statusReasonCode: review.statusReasonCode, nextActionCode: review.nextActionCode };
    if (review.status !== "validating" || review.currentStage !== "analysis") throw new ConvexError("review_not_ready_for_decision");
    const runs = await ctx.db.query("checkRuns").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
    const checks = runs.filter(item => item.commitSha === review.headSha);
    // The report refuses to blame a pull request for a check that fails identically on the base
    // commit, and says so in the comment. This decision did not, so the two contradicted each other
    // in public: zod#1 posted "Ready for human review" with a red "Changes need review" check run
    // sitting next to it, one second apart, from the same review. Two derivations of one verdict is
    // the defect; this applies reportChecks' rule against the same key, so there is nothing to drift.
    const preExisting = new Set(runs
      .filter(item => item.commitSha === review.baseSha && ["failed", "timed_out"].includes(item.conclusion))
      .map(item => item.nameHash));
    const findings = await ctx.db.query("findings").withIndex("by_review_severity", q => q.eq("reviewId", review._id)).collect();
    // Record which condition made the evidence incomplete. Without this the review ends as a
    // flat "required check missing" and the real cause — partial context, a missing artifact,
    // a flaky rerun — is unrecoverable afterwards.
    let incompleteReason: "injection_unscoped" | "uncertain_escalated" | "coverage_partial" | "no_required_check" | "evidence_missing" | "conclusion_unusable" | undefined;
    // An injection signal that could not be attributed to a changed file downgraded every critic
    // decision to uncertain, which made blocking false, which landed the review on checks_passed
    // with a green check. The verdict has to fail closed: an unscoped signal means BuildIT does
    // not know whether it reviewed the code or the attacker's instructions.
    const escalatedFinding = findings.some(item => (item.uncertainPasses ?? 0) >= uncertainEscalationLimit && item.resolution === "uncertain");
    if (review.promptInjectionUnscopedAt) incompleteReason = "injection_unscoped";
    else if (escalatedFinding) incompleteReason = "uncertain_escalated";
    else if (blocksVerdict(review.coverageLevel, review.coverageGap)) incompleteReason = "coverage_partial";
    else if (!checks.some(item => item.required)) incompleteReason = "no_required_check";
    // Evidence completeness is this function's job - it is the only side that can see the artifact
    // rows - so it is decided here, per check, and then handed over.
    const decisionChecks = [];
    for (const check of checks) {
      const artifact = check.artifactId ? await ctx.db.get(check.artifactId) : null;
      // outputTruncated is written on every row by pairExecutionEvidence and, until now, read by
      // nothing. The report has always treated a truncated output as missing evidence - a check
      // whose stdout passes 250,000 bytes, which any large test suite does routinely. This function
      // never looked, so one review could land on checks_passed with a green check while its own
      // comment said complete evidence was not available.
      const evidenceComplete = Boolean(artifact) && artifact!.organizationId === args.organizationId && artifact!.reviewId === review._id
        && artifact!.redactionStatus === "redacted" && !artifact!.deletedAt
        && Boolean(check.credentialTeardownProved) && Boolean(check.sandboxStopped) && check.outputTruncated !== true;
      if (check.required) {
        if (!evidenceComplete) incompleteReason ??= "evidence_missing";
        else if (!["passed", "failed"].includes(check.conclusion)) incompleteReason ??= "conclusion_unusable";
      }
      // name only feeds computeReviewDecision's missingChecks list, which this caller does not use;
      // the hash is the only identifier a checkRuns row carries.
      decisionChecks.push({ name: check.nameHash, required: check.required, conclusion: check.conclusion,
        evidenceComplete, ...(preExisting.has(check.nameHash) ? { preExisting: true } : {}) });
    }
    // One derivation, at last. This function used to restate the entire ladder - injection,
    // escalation, coverage, missing, failed, blocking - in its own vocabulary while
    // computeReviewDecision restated it in another, and the two disagreed on three ordinary
    // inputs: a flaky rerun, a truncated output, and a finding the critic could not resolve twice.
    // Each disagreement published a GitHub check run that contradicted the comment printed beside
    // it. Teaching one side a rule the other already knew is what produced this, twice; the fix is
    // to have one function decide and this one supply the evidence it decides on.
    //
    // Stored resolution "open" is what arbitration writes for an accepted finding, which is the
    // vocabulary computeReviewDecision expects.
    const decision = computeReviewDecision({
      isStale: review.isStale,
      environmentAvailable: true,
      coverageComplete: !blocksVerdict(review.coverageLevel, review.coverageGap),
      ...(review.promptInjectionUnscopedAt ? { injectionUnscoped: true } : {}),
      ...(escalatedFinding ? { uncertainEscalated: true } : {}),
      checks: decisionChecks,
      findings: findings.map(item => ({ resolution: item.resolution === "open" ? "accepted" as const : "rejected" as const, blocking: item.blocking })),
    });
    const status = decision.status;
    const statusReasonCode = decision.reason;
    const nextActionCode = decision.nextAction;
    const incomplete = status === "inconclusive";
    if (incomplete) incompleteReason ??= "conclusion_unusable";
    const githubCheckConclusion = status === "checks_passed" ? "success" as const : status === "changes_requested" ? "failure" as const : "neutral" as const;
    await ctx.db.patch(review._id, { status, statusReasonCode, nextActionCode, githubCheckConclusion, currentStage: "complete", completedAt: args.now, updatedAt: args.now });
    await ctx.db.insert("reviewEvents", { organizationId: args.organizationId, reviewId: review._id, sequence: 5, type: "status_changed", stage: "complete", publicMessageArtifactId: report._id, internalCode: `decision_${statusReasonCode}`, metadata: { count: findings.length, ...(incompleteReason ? { reasonCode: incompleteReason } : {}) }, createdAt: args.now });
    await ctx.db.insert("metricEvents", { organizationId: args.organizationId, repositoryId: review.repositoryId, reviewId: review._id, name: "review_completed", value: 1, organizationTimezone: organization.timezone, occurredAt: args.now });
    if (incomplete) {
      await ctx.scheduler.runAfter(0, internal.evalLoop.recordMissedVerdict, {
        organizationId: args.organizationId, reviewId: review._id,
        reasonCode: incompleteReason ?? "unknown", now: args.now,
      });
    }
    await ctx.scheduler.runAfter(0, internal.telemetryWorker.emit, { operation: "review.decision", stage: "decision", outcome: "succeeded" });
    return { status, statusReasonCode, nextActionCode };
  },
});

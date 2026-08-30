import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { assertReviewParent } from "./lib/parentConsistency";
import { findingCategory, findingResolution, requirementStatus, severity, sourceType } from "./validators";
import type { Id } from "./_generated/dataModel";

const executionArgs = { organizationId: v.id("organizations"), reviewId: v.id("reviews"), expectedHeadSha: v.string(), expectedGeneration: v.number() };

export const analysisScope = internalQuery({
  args: executionArgs,
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale) throw new ConvexError("stale_or_replaced_review");
    const allArtifacts = await ctx.db.query("artifacts").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
    const artifacts = allArtifacts
      .filter(item => item.type === "repository_snapshot" && item.redactionStatus === "redacted" && !item.deletedAt)
      .sort((a, b) => a.storageKey.localeCompare(b.storageKey));
    if (!artifacts.length || artifacts.some(item => item.organizationId !== args.organizationId || item.repositoryId !== review.repositoryId)) throw new ConvexError("review_context_unavailable");
    const validationArtifact = allArtifacts.find(item => item.type === "command_output" && item.redactionStatus === "redacted" && !item.deletedAt && item.storageKey.endsWith("/validation.json"));
    if (!validationArtifact || validationArtifact.organizationId !== args.organizationId || validationArtifact.repositoryId !== review.repositoryId) throw new ConvexError("validation_evidence_unavailable");
    const credentials = await ctx.db.query("providerCredentials").withIndex("by_org_status", q => q.eq("organizationId", args.organizationId).eq("status", "valid")).collect();
    const credential = credentials.find(item => item.repositoryId === review.repositoryId && item.provider === review.provider)
      ?? credentials.find(item => item.repositoryId === undefined && item.provider === review.provider);
    if (!credential || !credential.lastValidatedAt) throw new ConvexError("provider_credential_invalid");
    return { organizationId: review.organizationId, repositoryId: review.repositoryId, reviewId: review._id,
      headSha: review.headSha, baseSha: review.baseSha, configRevision: String(review.configRevisionId), provider: review.provider, model: review.model,
      credential: { id: credential.credentialScopeId, organizationId: String(credential.organizationId), ...(credential.repositoryId ? { repositoryId: String(credential.repositoryId) } : {}),
        provider: credential.provider, ciphertext: credential.encryptedCiphertext, nonce: credential.nonce, tag: credential.authTag,
        wrappedDataKey: credential.wrappedDataKey, kmsKeyId: credential.kmsKeyId, envelopeVersion: credential.envelopeVersion,
        keyVersion: credential.keyVersion, aadDigest: credential.aadDigest, maskedSuffix: credential.maskedSuffix, status: "valid" as const,
        createdBy: credential.createdBy, createdAt: credential.createdAt, lastValidatedAt: credential.lastValidatedAt },
      credentialDocumentId: credential._id,
      artifacts: artifacts.map(item => ({ id: item._id, storageKey: item.storageKey, checksum: item.checksum, size: item.size })),
      validationArtifact: { id: validationArtifact._id, storageKey: validationArtifact.storageKey, checksum: validationArtifact.checksum, size: validationArtifact.size } };
  },
});

export const reserveOutput = internalMutation({
  args: { ...executionArgs, checksum: v.string(), size: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale) throw new ConvexError("stale_or_replaced_review");
    if (!/^[0-9a-f]{64}$/.test(args.checksum) || !Number.isInteger(args.size) || args.size < 1 || args.size > 4_000_000) throw new ConvexError("invalid_analysis_artifact");
    const prior = (await ctx.db.query("artifacts").withIndex("by_review", q => q.eq("reviewId", review._id)).collect()).find(item => item.type === "prompt_trace" && item.storageKey.endsWith("/analysis.json"));
    if (prior) { if (prior.checksum !== args.checksum || prior.size !== args.size) throw new ConvexError("analysis_artifact_conflict"); return { artifactId: prior._id, storageKey: prior.storageKey }; }
    const artifactId = await ctx.db.insert("artifacts", { organizationId: args.organizationId, repositoryId: review.repositoryId, reviewId: review._id,
      type: "prompt_trace", storageKey: "pending", encrypted: true, checksum: args.checksum, size: args.size, redactionStatus: "pending",
      expiresAt: Math.min(review.expiresAt, args.now + 7 * 86_400_000), deletionAttempts: 0 });
    const storageKey = `artifacts/${args.organizationId}/${review.repositoryId}/${review._id}/${artifactId}/analysis.json`;
    await ctx.db.patch(artifactId, { storageKey });
    return { artifactId, storageKey };
  },
});

export const completeAnalysis = internalMutation({
  args: { ...executionArgs, artifactId: v.id("artifacts"), checksum: v.string(), size: v.number(), credentialId: v.id("providerCredentials"), inputTokens: v.number(), outputTokens: v.number(),
    requirements: v.array(v.object({ externalIdHash: v.string(), sourceType, sourceUrlHash: v.string(), fetchedVersion: v.string(), status: requirementStatus, confidence: v.number() })),
    findings: v.array(v.object({ fingerprintHmac: v.string(), pathHmac: v.string(), category: findingCategory, severity, confidence: v.number(), blocking: v.boolean(), evidenceIds: v.array(v.id("artifacts")), startLine: v.number(), endLine: v.number(), ruleId: v.optional(v.string()), requirementExternalIdHash: v.optional(v.string()), resolution: findingResolution })), now: v.number() },
  handler: async (ctx, args) => {
    const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId), artifact = await ctx.db.get(args.artifactId), credential = await ctx.db.get(args.credentialId);
    if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale) throw new ConvexError("stale_or_replaced_review");
    if (!artifact || artifact.organizationId !== args.organizationId || artifact.repositoryId !== review.repositoryId || artifact.reviewId !== review._id || artifact.type !== "prompt_trace" || artifact.checksum !== args.checksum || artifact.size !== args.size) throw new ConvexError("analysis_artifact_mismatch");
    if (!credential || credential.status !== "valid" || credential.organizationId !== args.organizationId || (credential.repositoryId && credential.repositoryId !== review.repositoryId)) throw new ConvexError("provider_credential_invalid");
    if (artifact.redactionStatus === "redacted") return artifact._id;
    if (artifact.redactionStatus === "pending") await ctx.db.patch(artifact._id, { redactionStatus: "redacted" });
    else throw new ConvexError("analysis_artifact_mismatch");
    const quantity = args.inputTokens + args.outputTokens;
    if (!Number.isSafeInteger(quantity) || quantity < 0) throw new ConvexError("invalid_model_usage");
    if (args.requirements.length > 500 || args.findings.length > 500) throw new ConvexError("analysis_result_limit_exceeded");
    const requirementIds = new Map<string, Id<"requirements">>();
    for (const item of args.requirements) {
      if (!/^[0-9a-f]{64}$/.test(item.externalIdHash) || !/^[0-9a-f]{64}$/.test(item.sourceUrlHash) || !item.fetchedVersion || item.fetchedVersion.length > 500 || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) throw new ConvexError("analysis_result_invalid");
      const existing = (await ctx.db.query("requirements").withIndex("by_review", q => q.eq("reviewId", review._id)).collect()).find(value => value.externalIdHash === item.externalIdHash);
      const id = existing?._id ?? await ctx.db.insert("requirements", { organizationId: args.organizationId, reviewId: review._id, sourceType: item.sourceType, sourceUrlHash: item.sourceUrlHash, externalIdHash: item.externalIdHash,
        contentArtifactId: artifact._id, fetchedVersion: item.fetchedVersion, fetchedAt: args.now, status: item.status, confidence: item.confidence, createdAt: args.now, updatedAt: args.now, expiresAt: Math.min(review.expiresAt, args.now + 7 * 86_400_000) });
      requirementIds.set(item.externalIdHash, id);
    }
    for (const item of args.findings) {
      if (!/^[0-9a-f]{64}$/.test(item.fingerprintHmac) || !/^[0-9a-f]{64}$/.test(item.pathHmac) || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1 || !Number.isInteger(item.startLine) || item.startLine < 1 || !Number.isInteger(item.endLine) || item.endLine < item.startLine || !item.evidenceIds.length) throw new ConvexError("analysis_result_invalid");
      for (const evidenceId of item.evidenceIds) { const evidence = await ctx.db.get(evidenceId); if (!evidence || evidence.organizationId !== args.organizationId || evidence.repositoryId !== review.repositoryId || evidence.reviewId !== review._id || evidence.redactionStatus !== "redacted") throw new ConvexError("finding_evidence_scope_mismatch"); }
      const requirementId = item.requirementExternalIdHash ? requirementIds.get(item.requirementExternalIdHash) : undefined;
      if (item.requirementExternalIdHash && !requirementId) throw new ConvexError("finding_requirement_missing");
      const existing = await ctx.db.query("findings").withIndex("by_review_fingerprint", q => q.eq("reviewId", review._id).eq("fingerprintHmac", item.fingerprintHmac)).unique();
      if (!existing) await ctx.db.insert("findings", { organizationId: args.organizationId, reviewId: review._id, fingerprintHmac: item.fingerprintHmac, category: item.category, severity: item.severity,
        confidence: item.confidence, blocking: item.blocking, contentArtifactId: artifact._id, evidenceIds: item.evidenceIds, pathHmac: item.pathHmac, startLine: item.startLine, endLine: item.endLine,
        ...(item.ruleId ? { ruleId: item.ruleId } : {}), ...(requirementId ? { requirementId } : {}), resolution: item.resolution, createdAt: args.now, updatedAt: args.now, expiresAt: Math.min(review.expiresAt, args.now + 7 * 86_400_000) });
    }
    await ctx.db.insert("usageLedger", { organizationId: args.organizationId, repositoryId: review.repositoryId, reviewId: review._id,
      kind: "model_tokens", quantity, unitCost: 0, currency: "provider_billed", occurredAt: args.now });
    await ctx.db.patch(credential._id, { lastUsedAt: args.now });
    await ctx.db.patch(review._id, { status: "analyzing", currentStage: "analysis", updatedAt: args.now });
    return artifact._id;
  },
});

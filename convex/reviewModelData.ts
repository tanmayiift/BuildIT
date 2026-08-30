import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { assertReviewParent } from "./lib/parentConsistency";

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
  args: { ...executionArgs, artifactId: v.id("artifacts"), checksum: v.string(), size: v.number(), credentialId: v.id("providerCredentials"), inputTokens: v.number(), outputTokens: v.number(), now: v.number() },
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
    await ctx.db.insert("usageLedger", { organizationId: args.organizationId, repositoryId: review.repositoryId, reviewId: review._id,
      kind: "model_tokens", quantity, unitCost: 0, currency: "provider_billed", occurredAt: args.now });
    await ctx.db.patch(credential._id, { lastUsedAt: args.now });
    await ctx.db.patch(review._id, { status: "analyzing", currentStage: "analysis", updatedAt: args.now });
    return artifact._id;
  },
});

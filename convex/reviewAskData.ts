import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { provider } from "./validators";
import { toMicros } from "./lib/usageCost";
import { addEstimatedCharge } from "./lib/budgetAccounting";
import { conservativeProviderModelCost } from "@buildit/providers";


// Everything an answer may be grounded in, and nothing more. The report artifact is the whole of
// it: it is already redacted and already published on the pull request, so an answer drawn from it
// cannot say anything the comment did not. When it is gone the caller is told, rather than being
// handed a path that would re-read the repository to cover the gap.
export const askScope = internalQuery({
  args: { organizationId: v.id("organizations"), repositoryId: v.id("repositories"), prNumber: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.organizationId !== args.organizationId || !repository.enabled || repository.pausedAt) return null;
    const installation = await ctx.db.get(repository.installationId);
    if (!installation || installation.organizationId !== args.organizationId || installation.status !== "active") return null;
    const organization = await ctx.db.get(args.organizationId);
    if (!organization || organization.deletedAt) return null;

    const review = await ctx.db.query("reviews")
      .withIndex("by_repo_pr_completed", q => q.eq("repositoryId", args.repositoryId).eq("prNumber", args.prNumber).gt("completedAt", undefined))
      .order("desc").first();
    // Answer only from the most recently completed evidence. Falling back across a newer
    // failure or a changed commit could give a confident answer about obsolete code.
    if (!review || review.organizationId !== args.organizationId || review.isStale
      || !["checks_passed", "changes_requested", "inconclusive", "delivered"].includes(review.status)) return null;

    // The atomic reservation mutation enforces the rate limit before the provider call.
    const credentials = (await ctx.db.query("providerCredentials")
      .withIndex("by_org_status", q => q.eq("organizationId", args.organizationId).eq("status", "valid")).collect());
    const credential = credentials.find(item => item.provider === review.provider && item.repositoryId === args.repositoryId)
      ?? credentials.find(item => item.provider === review.provider && item.repositoryId === undefined);
    if (!credential) return null;

    const artifacts = await ctx.db.query("artifacts").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
    const report = artifacts.find(item => item.type === "review_message" && item.redactionStatus === "redacted" && !item.deletedAt
      && item.organizationId === args.organizationId && item.expiresAt > args.now);

    return {
      organizationId: review.organizationId, repositoryId: repository._id, reviewId: review._id,
      installationId: installation.installationId, githubRepositoryId: repository.githubRepositoryId,
      headSha: review.headSha, executionGeneration: review.executionGeneration, askId: String(review._id),
      provider: review.provider, model: review.model,
      credential: { id: credential.credentialScopeId, organizationId: String(credential.organizationId),
        ...(credential.repositoryId ? { repositoryId: String(credential.repositoryId) } : {}),
        provider: credential.provider, ciphertext: credential.encryptedCiphertext, nonce: credential.nonce,
        tag: credential.authTag, wrappedDataKey: credential.wrappedDataKey, kmsKeyId: credential.kmsKeyId,
        envelopeVersion: credential.envelopeVersion, keyVersion: credential.keyVersion, aadDigest: credential.aadDigest,
        maskedSuffix: credential.maskedSuffix, availableModels: credential.availableModels ?? [],
        status: "valid" as const, createdBy: credential.createdBy, createdAt: credential.createdAt,
        lastValidatedAt: credential.lastValidatedAt },
      ...(report ? { report: { id: report._id, storageKey: report.storageKey, checksum: report.checksum, size: report.size } } : {}),
    };
  },
});

// Compatibility for an already-running legacy Ask action. New actions settle their invocation
// before inspecting the answer or attempting GitHub publication.
export const recordAsk = internalMutation({
  args: { organizationId: v.id("organizations"), reviewId: v.id("reviews"), inputTokens: v.number(), outputTokens: v.number(),
    provider, model: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review || review.organizationId !== args.organizationId) return;
    const cost = conservativeProviderModelCost(args.provider, args.model, args.inputTokens, args.outputTokens);
    await ctx.db.insert("usageLedger", {
      organizationId: args.organizationId, repositoryId: review.repositoryId, reviewId: review._id,
      kind: "ask_tokens", quantity: args.inputTokens + args.outputTokens,
      unitCost: cost / Math.max(1, args.inputTokens + args.outputTokens),
      accountingVersion: 1, costStatus: args.inputTokens + args.outputTokens ? "estimated" : "unknown", totalCostMicros: toMicros(cost), currency: "provider_billed", occurredAt: args.now,
    });
    await addEstimatedCharge(ctx, args.organizationId, toMicros(cost), args.now, args.inputTokens + args.outputTokens > 0);
    await ctx.db.patch(review._id, { budgetConsumed: (toMicros(review.budgetConsumed) + toMicros(cost)) / 1_000_000 });
  },
});

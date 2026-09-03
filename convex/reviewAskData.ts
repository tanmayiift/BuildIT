import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { provider } from "./validators";
import { toMicros } from "./lib/usageCost";
import { addToMonth } from "./lib/monthlySpend";
import { conservativeProviderModelCost } from "@buildit/providers";

const askWindowMs = 10 * 60_000;
const asksPerWindow = 5;

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

    const reviews = await ctx.db.query("reviews")
      .withIndex("by_repo_pr_head_mode", q => q.eq("repositoryId", args.repositoryId).eq("prNumber", args.prNumber))
      .order("desc").take(10);
    const review = reviews.find(item => item.completedAt && ["checks_passed", "changes_requested", "inconclusive", "delivered"].includes(item.status));
    if (!review) return null;

    // A question costs a model call against the organization's own key, on a public comment box.
    // Bounded per pull request so a stuck loop or a bored visitor cannot run up someone's bill.
    const recent = await ctx.db.query("usageLedger")
      .withIndex("by_org_time", q => q.eq("organizationId", args.organizationId).gte("occurredAt", args.now - askWindowMs))
      .collect();
    if (recent.filter(item => item.kind === "ask_tokens" && item.reviewId === review._id).length >= asksPerWindow) return null;

    const credential = (await ctx.db.query("providerCredentials")
      .withIndex("by_org_status", q => q.eq("organizationId", args.organizationId).eq("status", "valid")).collect())
      .find(item => item.provider === review.provider && (item.repositoryId === undefined || item.repositoryId === args.repositoryId));
    if (!credential) return null;

    const artifacts = await ctx.db.query("artifacts").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
    const report = artifacts.find(item => item.type === "review_message" && item.redactionStatus === "redacted" && !item.deletedAt
      && item.organizationId === args.organizationId && item.expiresAt > args.now);

    return {
      organizationId: review.organizationId, repositoryId: repository._id, reviewId: review._id,
      installationId: installation.installationId, githubRepositoryId: repository.githubRepositoryId,
      headSha: review.headSha, askId: String(review._id),
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

// An answer is billed like any other model call, on the organization's own key, so BYOK economics
// stay true and a question shows up in usage rather than being invisibly free.
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
      totalCostMicros: toMicros(cost), currency: "provider_billed", occurredAt: args.now,
    });
    const organization = await ctx.db.get(args.organizationId);
    if (organization) await ctx.db.patch(args.organizationId, addToMonth(organization, toMicros(cost), args.now));
  },
});

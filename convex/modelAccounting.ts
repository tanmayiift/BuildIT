import { queueReviewNotification } from "./lib/queueNotification";
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { approvedProviderModels, conservativeProviderModelCost, conservativeProviderStageCost } from "@buildit/providers";
import { provider } from "./validators";
import { assertReviewParent } from "./lib/parentConsistency";
import { terminalStatuses } from "./lib/lifecycle";
import { getBudgetSnapshot, getReviewBudgetSnapshot, monthRow, reconcileMonthPage, syncLegacyAggregate } from "./lib/budgetAccounting";
import { recordReviewMetric } from "./lib/recordMetric";
import { toMicros } from "./lib/usageCost";

export const reconcile = internalMutation({ args: { organizationId: v.id("organizations"), now: v.number() }, handler: async (ctx, args) => {
  const organization = await ctx.db.get(args.organizationId);
  if (!organization || organization.deletedAt) throw new ConvexError("not_found_or_forbidden");
  const row = await reconcileMonthPage(ctx, args.organizationId, args.now);
  return { complete: row.reconciliationComplete };
} });
export const snapshot = internalQuery({ args: { organizationId: v.id("organizations"), now: v.number() }, handler: (ctx, args) => getBudgetSnapshot(ctx, args.organizationId, args.now) });
// A read-only receipt for the exact allowance enforced at admission. No prompts, model output,
// credentials or provider identifiers: just the related review IDs and recorded amounts.
export const reviewSnapshot = internalQuery({ args: { organizationId: v.id("organizations"), reviewId: v.id("reviews") }, handler: async (ctx, args) => {
  const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
  const family = await getReviewBudgetSnapshot(ctx, review);
  return { rootReviewId: family.rootReviewId, reviewIds: family.members.map(member => member._id),
    budgetLimitUsd: family.limitMicros / 1_000_000, estimatedSpendUsd: family.consumedMicros / 1_000_000,
    reservedUsd: family.reservedMicros / 1_000_000, remainingUsd: Math.max(0, family.limitMicros - family.consumedMicros - family.reservedMicros) / 1_000_000,
    unresolvedInvocationCount: family.unresolvedInvocationCount };
} });

export const reserve = internalMutation({ args: {
  organizationId: v.id("organizations"), reviewId: v.id("reviews"), expectedHeadSha: v.string(), expectedGeneration: v.number(),
  invocationKey: v.string(), requestHash: v.string(), stage: v.string(), provider, model: v.string(), inputBytes: v.number(), maxOutputTokens: v.number(), now: v.number(),
}, handler: async (ctx, args) => {
  const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
  if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale || review.status === "cancelled"
    || review.status === "cancelling" || review.cancellationRequestedAt !== undefined || review.expiresAt <= args.now
    || (args.stage !== "ask" && terminalStatuses.has(review.status)) || args.provider !== review.provider || !approvedProviderModels[args.provider].has(args.model)
    || !["requirements", "review_plan", "findings", "critic", "arbitration", "patch", "report", "ask"].includes(args.stage)
    || !/^[a-zA-Z0-9_-]{16,100}$/.test(args.invocationKey) || !/^[0-9a-f]{64}$/.test(args.requestHash)) throw new ConvexError("model_invocation_invalid");
  const repository = await ctx.db.get(review.repositoryId);
  if (!repository || !repository.enabled || repository.pausedAt) throw new ConvexError("not_found_or_forbidden");
  const installation = await ctx.db.get(repository.installationId);
  if (!installation || installation.status !== "active") throw new ConvexError("not_found_or_forbidden");
  const prior = await ctx.db.query("modelInvocations").withIndex("by_key", q => q.eq("invocationKey", args.invocationKey)).unique();
  if (prior) {
    if (prior.organizationId !== args.organizationId || prior.reviewId !== args.reviewId || prior.requestHash !== args.requestHash || prior.model !== args.model || prior.stage !== args.stage) throw new ConvexError("invocation_key_conflict");
    return { allowed: false as const, reason: "invocation_already_reserved", invocationId: prior._id };
  }
  const family = await getReviewBudgetSnapshot(ctx, review);
  if (family.ancestors.some(parent => parent.isStale || parent.status === "cancelled" || parent.status === "cancelling"
    || parent.cancellationRequestedAt !== undefined || parent.expiresAt <= args.now)) throw new ConvexError("model_invocation_invalid");
  const row = await reconcileMonthPage(ctx, args.organizationId, args.now);
  if (!row.reconciliationComplete) return { allowed: false as const, reason: "accounting_reconciling" };
  const cost = toMicros(conservativeProviderStageCost(args.provider, args.model, args.inputBytes, args.maxOutputTokens));
  const organization = await ctx.db.get(args.organizationId);
  if (!organization || organization.deletedAt) throw new ConvexError("not_found_or_forbidden");
  if (family.consumedMicros + family.reservedMicros + cost > family.limitMicros
    || toMicros(review.budgetConsumed) + family.currentReservedMicros + cost > toMicros(review.budgetLimit)
    || (organization.monthlyBudget > 0 && row.estimatedMicros + row.legacyEstimatedMicros + row.reservedMicros + cost > toMicros(organization.monthlyBudget))) {
    if (args.stage !== "ask" && !terminalStatuses.has(review.status)) {
      await ctx.db.patch(review._id, { status: "budget_exhausted", statusReasonCode: "spend_ceiling_reached", budgetCeilingId: "invocation-reservation", nextActionCode: "increase_budget", currentStage: "complete", completedAt: args.now, updatedAt: args.now });
      const event = await ctx.db.query("reviewEvents").withIndex("by_review", q => q.eq("reviewId", review._id)).order("desc").first();
      await ctx.db.insert("reviewEvents", { organizationId: args.organizationId, reviewId: review._id, sequence: (event?.sequence ?? 0) + 1, type: "status_changed", stage: "complete", internalCode: "model_budget_reservation_denied", metadata: {}, createdAt: args.now });
      await queueReviewNotification(ctx, review._id, args.now);
    }
    return { allowed: false as const, reason: "budget_exhausted" };
  }
  if (args.stage === "ask") {
    const recent = await ctx.db.query("modelInvocations").withIndex("by_repo_pr_stage_time", q => q.eq("repositoryId", review.repositoryId).eq("prNumber", review.prNumber).eq("stage", "ask").gte("createdAt", args.now - 600_000)).take(5);
    if (recent.length >= 5) return { allowed: false as const, reason: "ask_rate_limited" };
  }
  const invocationId = await ctx.db.insert("modelInvocations", { organizationId: args.organizationId, repositoryId: review.repositoryId, reviewId: review._id,
    prNumber: review.prNumber, invocationKey: args.invocationKey, requestHash: args.requestHash, generation: args.expectedGeneration, stage: args.stage, provider: args.provider, model: args.model,
    month: row.month, reservedMicros: cost, status: "reserved", createdAt: args.now, updatedAt: args.now });
  const ledgerId = await ctx.db.insert("usageLedger", { organizationId: args.organizationId, repositoryId: review.repositoryId, reviewId: review._id,
    kind: args.stage === "ask" ? "ask_tokens" : "model_tokens", quantity: 0, unitCost: 0, currency: "provider_billed", costStatus: "unknown", invocationId, accountingVersion: 1, occurredAt: args.now });
  await ctx.db.patch(invocationId, { ledgerId });
  await ctx.db.patch(row._id, { reservedMicros: row.reservedMicros + cost, unknownInvocationCount: row.unknownInvocationCount + 1, updatedAt: args.now });
  return { allowed: true as const, invocationId, reservedUsd: cost / 1_000_000 };
} });

export const settle = internalMutation({ args: {
  organizationId: v.id("organizations"), invocationId: v.id("modelInvocations"), outcome: v.union(v.literal("estimated"), v.literal("unknown"), v.literal("not_charged")),
  inputTokens: v.optional(v.number()), outputTokens: v.optional(v.number()), providerRequestId: v.optional(v.string()), finishReason: v.string(), failed: v.optional(v.boolean()), now: v.number(),
}, handler: async (ctx, args) => {
  const invocation = await ctx.db.get(args.invocationId);
  if (!invocation || invocation.organizationId !== args.organizationId) throw new ConvexError("not_found_or_forbidden");
  const review = await assertReviewParent(ctx.db, args.organizationId, invocation.reviewId);
  if (invocation.repositoryId !== review.repositoryId || args.finishReason.length > 100 || (args.providerRequestId?.length ?? 0) > 200) throw new ConvexError("model_settlement_invalid");
  if (args.outcome === "estimated" && ![args.inputTokens, args.outputTokens].every(value => Number.isSafeInteger(value) && value! >= 0)) throw new ConvexError("model_settlement_invalid");
  const inputTokens = args.outcome === "estimated" ? args.inputTokens! : 0, outputTokens = args.outcome === "estimated" ? args.outputTokens! : 0;
  const costMicros = args.outcome === "estimated" ? toMicros(conservativeProviderModelCost(invocation.provider, invocation.model, inputTokens, outputTokens)) : 0;
  const organization = await ctx.db.get(args.organizationId);
  if (args.failed && organization && !organization.deletedAt) await recordReviewMetric(ctx, { ...review, executionGeneration: invocation.generation }, "provider_failure", args.now, String(invocation._id));
  if (invocation.status === "estimated" || invocation.status === "not_charged") {
    if (invocation.status !== args.outcome || invocation.costMicros !== costMicros || invocation.inputTokens !== inputTokens || invocation.outputTokens !== outputTokens || (invocation.providerRequestId && args.providerRequestId && invocation.providerRequestId !== args.providerRequestId)) throw new ConvexError("model_settlement_conflict");
    return { accounted: true, costUsd: costMicros / 1_000_000 };
  }
  const row = await monthRow(ctx, args.organizationId, invocation.month);
  const ledger = invocation.ledgerId ? await ctx.db.get(invocation.ledgerId) : null;
  if (!row || !ledger || ledger.organizationId !== args.organizationId || ledger.reviewId !== review._id || ledger.invocationId !== invocation._id) throw new ConvexError("model_accounting_missing");
  const details = { finishReason: args.finishReason, ...(args.providerRequestId ? { providerRequestId: args.providerRequestId } : {}), updatedAt: args.now };
  if (args.outcome === "unknown") {
    await ctx.db.patch(invocation._id, { status: "unknown", ...details });
    return { accounted: false, costUsd: null };
  }
  // Accounting survives cancellation, stale heads, output errors and over-limit results. Those
  // fences still protect publishing; they must never erase work a provider already performed.
  await ctx.db.patch(invocation._id, { status: args.outcome, inputTokens, outputTokens, costMicros, ...details });
  await ctx.db.patch(ledger._id, { inputTokens, outputTokens, quantity: inputTokens + outputTokens,
    unitCost: costMicros / 1_000_000 / Math.max(1, inputTokens + outputTokens), totalCostMicros: costMicros, costStatus: "estimated" });
  const updatedMonth = { ...row, estimatedMicros: row.estimatedMicros + costMicros,
    reservedMicros: Math.max(0, row.reservedMicros - invocation.reservedMicros), unknownInvocationCount: Math.max(0, row.unknownInvocationCount - 1) };
  await ctx.db.patch(row._id, { estimatedMicros: updatedMonth.estimatedMicros, reservedMicros: updatedMonth.reservedMicros, unknownInvocationCount: updatedMonth.unknownInvocationCount, updatedAt: args.now });
  await syncLegacyAggregate(ctx, updatedMonth, args.now);
  const consumed = (toMicros(review.budgetConsumed) + costMicros) / 1_000_000;
  const stop = consumed > review.budgetLimit && invocation.stage !== "ask" && review.executionGeneration === invocation.generation
    && !review.isStale && review.status !== "cancelling" && review.cancellationRequestedAt === undefined && !terminalStatuses.has(review.status);
  await ctx.db.patch(review._id, { budgetConsumed: consumed, updatedAt: args.now, ...(stop ? { status: "budget_exhausted" as const, statusReasonCode: "spend_ceiling_reached", budgetCeilingId: "actual-model-usage", nextActionCode: "increase_budget" as const, currentStage: "complete" as const, completedAt: args.now } : {}) });
  if (stop) await queueReviewNotification(ctx, review._id, args.now);
  return { accounted: true, costUsd: costMicros / 1_000_000 };
} });

import { defineTable } from "convex/server";
import { v } from "convex/values";
import { provider } from "./validators";

// Identifiers and usage counters only: never prompts, source, or credentials.
export const accountingTables = {
  usageMonths: defineTable({
    organizationId: v.id("organizations"), month: v.string(), periodStart: v.number(), periodEnd: v.number(),
    estimatedMicros: v.number(), reservedMicros: v.number(), unknownInvocationCount: v.number(),
    legacyEstimatedMicros: v.number(), legacyUnknownCount: v.number(), legacyRows: v.number(),
    reconciliationComplete: v.boolean(), reconciliationCursor: v.optional(v.string()),
    createdAt: v.number(), updatedAt: v.number(),
  }).index("by_org_month", ["organizationId", "month"]),
  modelInvocations: defineTable({
    organizationId: v.id("organizations"), repositoryId: v.id("repositories"), reviewId: v.id("reviews"),
    prNumber: v.number(), invocationKey: v.string(), requestHash: v.string(), generation: v.number(),
    stage: v.string(), provider, model: v.string(), month: v.string(), reservedMicros: v.number(),
    status: v.union(v.literal("reserved"), v.literal("estimated"), v.literal("unknown"), v.literal("not_charged")),
    inputTokens: v.optional(v.number()), outputTokens: v.optional(v.number()), costMicros: v.optional(v.number()),
    providerRequestId: v.optional(v.string()), finishReason: v.optional(v.string()),
    ledgerId: v.optional(v.id("usageLedger")), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_key", ["invocationKey"]).index("by_review_status", ["reviewId", "status"])
    .index("by_repo_pr_stage_time", ["repositoryId", "prNumber", "stage", "createdAt"])
    .index("by_org_month", ["organizationId", "month"]),
};

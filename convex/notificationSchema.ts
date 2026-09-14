import { defineTable } from "convex/server";
import { v } from "convex/values";

export const emailDecisionStatus = v.union(v.literal("changes_requested"), v.literal("awaiting_human_approval"), v.literal("failed_after_three_rounds"),
  v.literal("autofix_stopped"), v.literal("budget_exhausted"), v.literal("inconclusive"), v.literal("platform_failed"), v.literal("cancelled"));
export const notificationTables = {
  notificationFanouts: defineTable({ organizationId: v.id("organizations"), reviewId: v.id("reviews"), generation: v.number(),
    decisionStatus: emailDecisionStatus, dedupeKey: v.string(), cursor: v.optional(v.string()), complete: v.boolean(), createdAt: v.number(),
  }).index("by_dedupe_key", ["dedupeKey"]).index("by_org_created", ["organizationId", "createdAt"]),
  emailBatches: defineTable({ organizationId: v.id("organizations"), userId: v.string(), notificationIds: v.array(v.id("notifications")),
    status: v.union(v.literal("pending"), v.literal("processing"), v.literal("captured"), v.literal("suppressed"), v.literal("failed")),
    mode: v.union(v.literal("immediate"), v.literal("daily")), attempts: v.number(), dueAt: v.number(),
    leaseKey: v.optional(v.string()), leaseExpiresAt: v.optional(v.number()), captureId: v.optional(v.string()), capturedAt: v.optional(v.number()),
    failureCode: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_user_due", ["organizationId", "userId", "dueAt"]).index("by_status_due", ["status", "dueAt"]),
};

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { artifactType, eventType, membershipStatus, reviewMode, reviewStatus, role, triggerSource } from "./validators";

export default defineSchema({
  organizations: defineTable({
    name: v.string(), slug: v.string(), timezone: v.string(), retentionHours: v.number(), createdAt: v.number(),
  }).index("by_slug", ["slug"]),
  memberships: defineTable({
    organizationId: v.id("organizations"), userId: v.string(), role, status: membershipStatus,
  }).index("by_org_user", ["organizationId", "userId"]),
  reviews: defineTable({
    organizationId: v.id("organizations"), repositoryId: v.string(), prNumber: v.number(),
    headSha: v.string(), mode: reviewMode, trigger: triggerSource, status: reviewStatus,
    isStale: v.boolean(), artifactIds: v.array(v.id("artifacts")), createdAt: v.number(),
  }).index("by_repo_pr_head", ["repositoryId", "prNumber", "headSha"])
    .index("by_org_status", ["organizationId", "status"]),
  artifacts: defineTable({
    organizationId: v.id("organizations"), reviewId: v.id("reviews"), type: artifactType,
    storageKey: v.string(), expiresAt: v.number(), deletedAt: v.optional(v.number()),
  }).index("by_expiry", ["expiresAt"]),
  reviewEvents: defineTable({
    reviewId: v.id("reviews"), sequence: v.number(), type: eventType,
    messageArtifactId: v.optional(v.id("artifacts")), createdAt: v.number(),
  }).index("by_review", ["reviewId", "sequence"]),
});

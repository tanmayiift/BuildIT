import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const leaseMs = 5 * 60_000;

export const claimExpired = internalMutation({
  args: { now: v.number(), leaseId: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    if (!/^[0-9a-f-]{36}$/i.test(args.leaseId) || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 25) throw new ConvexError("artifact_cleanup_claim_invalid");
    const candidates = await ctx.db.query("artifacts").withIndex("by_expiry", q => q.lt("expiresAt", args.now)).take(args.limit * 4), claimed = [];
    for (const artifact of candidates) {
      if (claimed.length >= args.limit) break;
      if (artifact.deletedAt || artifact.deletionTerminalAt || (artifact.deletionLeaseExpiresAt ?? 0) > args.now) continue;
      if (artifact.deletionAttempts >= 10 || !artifact.reviewId) {
        await ctx.db.patch(artifact._id, { deletionTerminalAt: args.now, lastDeletionErrorCode: artifact.deletionAttempts >= 10 ? "deletion_attempts_exhausted" : "artifact_review_scope_missing", deletionLeaseId: undefined, deletionLeaseExpiresAt: undefined });
        continue;
      }
      const [repository, review] = await Promise.all([ctx.db.get(artifact.repositoryId), ctx.db.get(artifact.reviewId)]);
      const prefix = `artifacts/${artifact.organizationId}/${artifact.repositoryId}/${artifact.reviewId}/${artifact._id}/`;
      if (!repository || repository.organizationId !== artifact.organizationId || !review || review.organizationId !== artifact.organizationId || review.repositoryId !== artifact.repositoryId || !artifact.storageKey.startsWith(prefix) || artifact.storageKey.includes("..") || artifact.storageKey.includes("\\")) {
        await ctx.db.patch(artifact._id, { deletionTerminalAt: args.now, lastDeletionErrorCode: "artifact_parent_invalid", deletionLeaseId: undefined, deletionLeaseExpiresAt: undefined });
        continue;
      }
      await ctx.db.patch(artifact._id, { deletionLeaseId: args.leaseId, deletionLeaseExpiresAt: args.now + leaseMs, deletionAttempts: artifact.deletionAttempts + 1, lastDeletionErrorCode: undefined });
      claimed.push({ artifactId: artifact._id, organizationId: artifact.organizationId, repositoryId: artifact.repositoryId, reviewId: artifact.reviewId, storageKey: artifact.storageKey });
    }
    return claimed;
  },
});

export const completeDeletion = internalMutation({
  args: { artifactId: v.id("artifacts"), leaseId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.deletionLeaseId !== args.leaseId || (artifact.deletionLeaseExpiresAt ?? 0) < args.now) throw new ConvexError("artifact_cleanup_lease_invalid");
    if (artifact.deletedAt) return artifact._id;
    await ctx.db.patch(artifact._id, { deletedAt: args.now, deletionLeaseId: undefined, deletionLeaseExpiresAt: undefined, lastDeletionErrorCode: undefined, deletionTerminalAt: undefined });
    return artifact._id;
  },
});

export const failDeletion = internalMutation({
  args: { artifactId: v.id("artifacts"), leaseId: v.string(), errorCode: v.literal("broker_delete_failed"), now: v.number() },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.deletedAt || artifact.deletionLeaseId !== args.leaseId) throw new ConvexError("artifact_cleanup_lease_invalid");
    await ctx.db.patch(artifact._id, { deletionLeaseId: undefined, deletionLeaseExpiresAt: undefined, lastDeletionErrorCode: artifact.deletionAttempts >= 10 ? "deletion_attempts_exhausted" : args.errorCode, deletionTerminalAt: artifact.deletionAttempts >= 10 ? args.now : undefined });
    return artifact._id;
  },
});

export const listTerminal = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100) throw new ConvexError("artifact_cleanup_list_invalid");
    const rows = await ctx.db.query("artifacts").withIndex("by_deletion_terminal", q => q.gt("deletionTerminalAt", 0)).take(args.limit);
    return rows.map(row => ({ artifactId: row._id, organizationId: row.organizationId, repositoryId: row.repositoryId, reviewId: row.reviewId, deletionAttempts: row.deletionAttempts, errorCode: row.lastDeletionErrorCode ?? "deletion_terminal_unknown", terminalAt: row.deletionTerminalAt! }));
  },
});

export const retryTerminal = internalMutation({
  args: { artifactId: v.id("artifacts"), now: v.number() },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.deletedAt || !artifact.deletionTerminalAt || !artifact.reviewId || artifact.expiresAt >= args.now) throw new ConvexError("artifact_cleanup_retry_invalid");
    const [repository, review] = await Promise.all([ctx.db.get(artifact.repositoryId), ctx.db.get(artifact.reviewId)]), prefix = `artifacts/${artifact.organizationId}/${artifact.repositoryId}/${artifact.reviewId}/${artifact._id}/`;
    if (!repository || repository.organizationId !== artifact.organizationId || !review || review.organizationId !== artifact.organizationId || review.repositoryId !== artifact.repositoryId || !artifact.storageKey.startsWith(prefix) || artifact.storageKey.includes("..") || artifact.storageKey.includes("\\")) throw new ConvexError("artifact_cleanup_retry_invalid");
    await ctx.db.patch(artifact._id, { deletionAttempts: 0, deletionTerminalAt: undefined, lastDeletionErrorCode: undefined, deletionLeaseId: undefined, deletionLeaseExpiresAt: undefined });
    return artifact._id;
  },
});

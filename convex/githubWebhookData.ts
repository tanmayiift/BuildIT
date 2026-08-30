import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { terminalStatuses } from "./lib/lifecycle";

export const reserve = internalMutation({
  args: {
    deliveryId: v.string(), event: v.string(), action: v.string(), installationId: v.optional(v.number()),
    disposition: v.union(v.literal("processed"), v.literal("ignored_bot"), v.literal("ignored_edit"), v.literal("rejected")),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("webhookDeliveries").withIndex("by_delivery_id", q => q.eq("deliveryId", args.deliveryId)).unique();
    if (existing) return { duplicate: true, id: existing._id };
    const id = await ctx.db.insert("webhookDeliveries", {
      deliveryId: args.deliveryId, event: args.event, action: args.action, installationId: args.installationId,
      signatureValid: true, disposition: args.disposition,
      status: args.disposition === "processed" ? "received" : "completed",
      receivedAt: args.now, completedAt: args.disposition === "processed" ? undefined : args.now,
    });
    return { duplicate: false, id };
  },
});

export const scope = internalQuery({
  args: { installationId: v.number(), githubRepositoryId: v.number() },
  handler: async (ctx, args) => {
    const installation = await ctx.db.query("githubInstallations").withIndex("by_installation", q => q.eq("installationId", args.installationId)).unique();
    if (!installation || installation.status !== "active") throw new Error("installation_unavailable");
    const repository = await ctx.db.query("repositories").withIndex("by_github_id", q => q.eq("githubRepositoryId", args.githubRepositoryId)).unique();
    if (!repository || !repository.enabled || repository.installationId !== installation._id || repository.organizationId !== installation.organizationId) throw new Error("repository_unavailable");
    return { organizationId: installation.organizationId, repositoryId: repository._id, owner: repository.owner, name: repository.name, forkPolicy: repository.forkPolicy };
  },
});

export const recordPinnedSnapshot = internalMutation({
  args: { deliveryId: v.string(), prNumber: v.number(), headSha: v.string(), baseSha: v.string(),
    headRefHash: v.string(), baseRefHash: v.string(), isFork: v.boolean(), triggerVerb: v.union(v.literal("review"), v.literal("autofix")) },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.prNumber) || args.prNumber < 1 || !/^[0-9a-f]{40}$/i.test(args.headSha)
      || !/^[0-9a-f]{40}$/i.test(args.baseSha) || !/^[0-9a-f]{64}$/i.test(args.headRefHash)
      || !/^[0-9a-f]{64}$/i.test(args.baseRefHash)) throw new Error("invalid_pull_request_snapshot");
    const delivery = await ctx.db.query("webhookDeliveries").withIndex("by_delivery_id", q => q.eq("deliveryId", args.deliveryId)).unique();
    if (!delivery || delivery.status !== "received" || delivery.disposition !== "processed") throw new Error("delivery_not_reservable");
    await ctx.db.patch(delivery._id, { ...args, headSha: args.headSha.toLowerCase(), baseSha: args.baseSha.toLowerCase() });
    return delivery._id;
  },
});

export const complete = internalMutation({
  args: {
    deliveryId: v.string(),
    disposition: v.union(v.literal("processed"), v.literal("ignored_bot"), v.literal("ignored_edit"), v.literal("duplicate"), v.literal("rejected")),
    status: v.union(v.literal("enqueued"), v.literal("completed"), v.literal("failed")), now: v.number(),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.query("webhookDeliveries").withIndex("by_delivery_id", q => q.eq("deliveryId", args.deliveryId)).unique();
    if (delivery) await ctx.db.patch(delivery._id, { disposition: args.disposition, status: args.status, completedAt: args.status === "enqueued" ? undefined : args.now });
  },
});

export const reconcilePullRequestHead = internalMutation({
  args: { installationId: v.number(), githubRepositoryId: v.number(), prNumber: v.number(), observedHeadSha: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.prNumber) || args.prNumber < 1 || !/^[0-9a-f]{40}$/i.test(args.observedHeadSha)) throw new Error("invalid_pull_request_snapshot");
    const installation = await ctx.db.query("githubInstallations").withIndex("by_installation", q => q.eq("installationId", args.installationId)).unique();
    const repository = await ctx.db.query("repositories").withIndex("by_github_id", q => q.eq("githubRepositoryId", args.githubRepositoryId)).unique();
    if (!installation || installation.status !== "active" || !repository || !repository.enabled || repository.installationId !== installation._id || repository.organizationId !== installation.organizationId) throw new Error("repository_unavailable");
    const reviews = await ctx.db.query("reviews").withIndex("by_repo_pr_head_mode", q => q.eq("repositoryId", repository._id).eq("prNumber", args.prNumber)).collect();
    let staleCount = 0;
    for (const review of reviews) {
      if (review.headSha === args.observedHeadSha || review.isStale) continue;
      const active = !terminalStatuses.has(review.status);
      await ctx.db.patch(review._id, { isStale: true, staleSince: args.now, observedHeadSha: args.observedHeadSha.toLowerCase(), executionGeneration: active ? review.executionGeneration + 1 : review.executionGeneration, leaseOwner: active ? undefined : review.leaseOwner, leaseExpiresAt: active ? undefined : review.leaseExpiresAt, updatedAt: args.now });
      staleCount++;
    }
    return { staleCount };
  },
});

export const reconcileDefaultBranchPush = internalMutation({
  args: { installationId: v.number(), githubRepositoryId: v.number(), ref: v.string(), afterSha: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (!/^refs\/heads\/[A-Za-z0-9._\/-]+$/.test(args.ref) || !/^[0-9a-f]{40}$/i.test(args.afterSha)) throw new Error("invalid_push_snapshot");
    const installation = await ctx.db.query("githubInstallations").withIndex("by_installation", q => q.eq("installationId", args.installationId)).unique();
    const repository = await ctx.db.query("repositories").withIndex("by_github_id", q => q.eq("githubRepositoryId", args.githubRepositoryId)).unique();
    if (!installation || installation.status !== "active" || !repository || !repository.enabled || repository.installationId !== installation._id || repository.organizationId !== installation.organizationId) throw new Error("repository_unavailable");
    const branch = args.ref.slice("refs/heads/".length);
    if (branch !== repository.defaultBranch) return { staleCount: 0, ignored: true };
    const reviews = await ctx.db.query("reviews").withIndex("by_org_status", q => q.eq("organizationId", repository.organizationId)).collect();
    let staleCount = 0;
    for (const review of reviews) {
      if (review.repositoryId !== repository._id || review.baseRef !== branch || review.baseSha === args.afterSha.toLowerCase() || review.isStale || terminalStatuses.has(review.status)) continue;
      await ctx.db.patch(review._id, { isStale: true, staleSince: args.now, executionGeneration: review.executionGeneration + 1, leaseOwner: undefined, leaseExpiresAt: undefined, updatedAt: args.now });
      staleCount++;
    }
    return { staleCount, ignored: false };
  },
});

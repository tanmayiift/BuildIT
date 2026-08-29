import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

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
    return { organizationId: installation.organizationId, repositoryId: repository._id, owner: repository.owner, name: repository.name };
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

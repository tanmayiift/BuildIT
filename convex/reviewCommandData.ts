import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

export const commandScope = internalQuery({
  args: { organizationId: v.id("organizations"), repositoryId: v.id("repositories") },
  handler: async (ctx, args) => {
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.organizationId !== args.organizationId || !repository.enabled) return null;
    const installation = await ctx.db.get(repository.installationId);
    if (!installation || installation.organizationId !== args.organizationId || installation.status !== "active") return null;
    return { installationId: installation.installationId, githubRepositoryId: repository.githubRepositoryId };
  },
});

"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { authorizeTrigger, GitHubAppClient } from "@buildit/github";

export const processWebhook = internalAction({
  args: { deliveryId: v.string(), installationId: v.number(), githubRepositoryId: v.number(), senderLogin: v.string(), senderType: v.string(), commentAction: v.string(), command: v.string() },
  handler: async (ctx, args) => {
    try {
      const scope = await ctx.runQuery(internal.githubWebhookData.scope, { installationId: args.installationId, githubRepositoryId: args.githubRepositoryId });
      const appId = process.env.GITHUB_APP_ID, privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
      if (!appId || !privateKey) throw new Error("github_app_not_configured");
      const client = new GitHubAppClient({ appId, privateKey });
      const response = await client.withToken({ installationId: args.installationId, repositoryId: args.githubRepositoryId, stage: "review" }, token => fetch(`https://api.github.com/repos/${encodeURIComponent(scope.owner)}/${encodeURIComponent(scope.name)}/collaborators/${encodeURIComponent(args.senderLogin)}/permission`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "BuildIT" } }));
      if (!response.ok) throw new Error(`permission_lookup_${response.status}`);
      const raw = (await response.json() as { permission?: string }).permission;
      const permission = raw === "admin" || raw === "maintain" || raw === "write" || raw === "triage" || raw === "read" ? raw : "read";
      const decision = authorizeTrigger({ deliveryId: args.deliveryId, action: args.commentAction, senderType: args.senderType, body: args.command, permission });
      await ctx.runMutation(internal.githubWebhookData.complete, { deliveryId: args.deliveryId, disposition: decision.accepted ? "processed" : "rejected", status: decision.accepted ? "enqueued" : "completed", now: Date.now() });
    } catch {
      await ctx.runMutation(internal.githubWebhookData.complete, { deliveryId: args.deliveryId, disposition: "rejected", status: "failed", now: Date.now() });
    }
  },
});

"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  authorizeTrigger,
  GitHubAppClient,
  pinPullRequest,
  reviewPolicy,
} from "@buildit/github";
import type { WorkflowId } from "@convex-dev/workflow";

export const processWebhook = internalAction({
  args: {
    deliveryId: v.string(),
    installationId: v.number(),
    githubRepositoryId: v.number(),
    prNumber: v.number(),
    senderLogin: v.string(),
    senderType: v.string(),
    commentAction: v.string(),
    command: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      if (!Number.isInteger(args.prNumber) || args.prNumber < 1)
        throw new Error("invalid_pull_request_number");
      const scope = await ctx.runQuery(internal.githubWebhookData.scope, {
        installationId: args.installationId,
        githubRepositoryId: args.githubRepositoryId,
      });
      const appId = process.env.GITHUB_APP_ID,
        privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
      if (!appId || !privateKey) throw new Error("github_app_not_configured");
      const client = new GitHubAppClient({ appId, privateKey });
      const response = await client.withToken(
        {
          installationId: args.installationId,
          repositoryId: args.githubRepositoryId,
          stage: "review",
        },
        (token) =>
          fetch(
            `https://api.github.com/repos/${encodeURIComponent(scope.owner)}/${encodeURIComponent(scope.name)}/collaborators/${encodeURIComponent(args.senderLogin)}/permission`,
            {
              headers: {
                Accept: "application/vnd.github+json",
                Authorization: `Bearer ${token}`,
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "BuildIT",
              },
            },
          ),
      );
      if (!response.ok) throw new Error(`permission_lookup_${response.status}`);
      const raw = ((await response.json()) as { permission?: string })
        .permission;
      const permission =
        raw === "admin" ||
        raw === "maintain" ||
        raw === "write" ||
        raw === "triage" ||
        raw === "read"
          ? raw
          : "read";
      const decision = authorizeTrigger({
        deliveryId: args.deliveryId,
        action: args.commentAction,
        senderType: args.senderType,
        body: args.command,
        permission,
      });
      if (!decision.accepted) {
        await ctx.runMutation(internal.githubWebhookData.complete, {
          deliveryId: args.deliveryId,
          disposition: "rejected",
          status: "completed",
          now: Date.now(),
        });
        return;
      }
      if (decision.kind === "cancel") {
        const actorId = await sha256(args.senderLogin.toLowerCase()),
          now = Date.now();
        const targets: Array<{ reviewId: string; workflowId?: string }> =
          await ctx.runQuery(internal.githubWebhookData.cancellationTargets, {
            organizationId: scope.organizationId,
            repositoryId: scope.repositoryId,
            prNumber: args.prNumber,
          });
        for (const target of targets) {
          if (target.workflowId) {
            await ctx.runMutation(internal.durableReview.cancel, {
              reviewId: target.reviewId,
              workflowId: target.workflowId as WorkflowId,
              actorId,
              now,
            });
          } else {
            await ctx.runMutation(internal.reviewState.requestCancellation, {
              reviewId: target.reviewId,
              actorId,
              now,
            });
          }
        }
        await ctx.runMutation(internal.githubWebhookData.complete, {
          deliveryId: args.deliveryId,
          disposition: "processed",
          status: "completed",
          now: Date.now(),
        });
        return;
      }
      const pullResponse = await client.withToken(
        {
          installationId: args.installationId,
          repositoryId: args.githubRepositoryId,
          stage: "review",
        },
        (token) =>
          fetch(
            `https://api.github.com/repos/${encodeURIComponent(scope.owner)}/${encodeURIComponent(scope.name)}/pulls/${args.prNumber}`,
            {
              headers: {
                Accept: "application/vnd.github+json",
                Authorization: `Bearer ${token}`,
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "BuildIT",
              },
            },
          ),
      );
      if (!pullResponse.ok)
        throw new Error(`pull_request_lookup_${pullResponse.status}`);
      const pull = (await pullResponse.json()) as {
        number?: number;
        head?: {
          sha?: string;
          ref?: string;
          repo?: { full_name?: string } | null;
        };
        base?: { sha?: string; ref?: string; repo?: { full_name?: string } };
      };
      const snapshot = pinPullRequest({
        number: pull.number ?? args.prNumber,
        head: {
          sha: pull.head?.sha ?? "",
          ref: pull.head?.ref ?? "",
          repoFullName: pull.head?.repo?.full_name ?? null,
        },
        base: {
          sha: pull.base?.sha ?? "",
          ref: pull.base?.ref ?? "",
          repoFullName: pull.base?.repo?.full_name ?? "",
        },
      });
      const mode: "review" | "autofix" =
        decision.kind === "autofix" ? "autofix" : "review";
      if (!reviewPolicy(snapshot, mode, scope.forkPolicy).allowed) {
        await ctx.runMutation(internal.githubWebhookData.complete, {
          deliveryId: args.deliveryId,
          disposition: "rejected",
          status: "completed",
          now: Date.now(),
        });
        return;
      }
      await ctx.runMutation(internal.githubWebhookData.recordPinnedSnapshot, {
        deliveryId: args.deliveryId,
        prNumber: snapshot.number,
        headSha: snapshot.headSha,
        baseSha: snapshot.baseSha,
        headRefHash: await sha256(snapshot.headRef),
        baseRefHash: await sha256(snapshot.baseRef),
        isFork: snapshot.isFork,
        triggerVerb: mode,
      });
      const review = await ctx.runMutation(
        internal.githubWebhookData.materializeReview,
        {
          deliveryId: args.deliveryId,
          organizationId: scope.organizationId,
          repositoryId: scope.repositoryId,
          baseRef: snapshot.baseRef,
          triggerActor: await sha256(args.senderLogin.toLowerCase()),
          actorPermission: permission,
          now: Date.now(),
        },
      );
      if (review.status !== "queued") throw new Error("review_not_runnable");
      await ctx.runMutation(internal.durableReview.start, {
        organizationId: scope.organizationId,
        reviewId: review.reviewId,
        expectedHeadSha: review.headSha,
        expectedGeneration: review.executionGeneration,
        now: Date.now(),
      });
      await ctx.runMutation(internal.githubWebhookData.complete, {
        deliveryId: args.deliveryId,
        disposition: "processed",
        status: "enqueued",
        now: Date.now(),
      });
    } catch {
      await ctx.runMutation(internal.githubWebhookData.complete, {
        deliveryId: args.deliveryId,
        disposition: "rejected",
        status: "failed",
        now: Date.now(),
      });
    }
  },
});

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export const processPullRequestWebhook = internalAction({
  args: {
    deliveryId: v.string(),
    installationId: v.number(),
    githubRepositoryId: v.number(),
    prNumber: v.number(),
    headSha: v.string(),
  },
  handler: async (ctx, args): Promise<{ staleCount: number } | undefined> => {
    try {
      const result: { staleCount: number } = await ctx.runMutation(
        internal.githubWebhookData.reconcilePullRequestHead,
        {
          installationId: args.installationId,
          githubRepositoryId: args.githubRepositoryId,
          prNumber: args.prNumber,
          observedHeadSha: args.headSha,
          now: Date.now(),
        },
      );
      await ctx.runMutation(internal.githubWebhookData.complete, {
        deliveryId: args.deliveryId,
        disposition: "processed",
        status: "completed",
        now: Date.now(),
      });
      return result;
    } catch {
      await ctx.runMutation(internal.githubWebhookData.complete, {
        deliveryId: args.deliveryId,
        disposition: "rejected",
        status: "failed",
        now: Date.now(),
      });
    }
  },
});

export const processPushWebhook = internalAction({
  args: {
    deliveryId: v.string(),
    installationId: v.number(),
    githubRepositoryId: v.number(),
    ref: v.string(),
    afterSha: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(
        internal.githubWebhookData.reconcileDefaultBranchPush,
        {
          installationId: args.installationId,
          githubRepositoryId: args.githubRepositoryId,
          ref: args.ref,
          afterSha: args.afterSha,
          now: Date.now(),
        },
      );
      await ctx.runMutation(internal.githubWebhookData.complete, {
        deliveryId: args.deliveryId,
        disposition: "processed",
        status: "completed",
        now: Date.now(),
      });
    } catch {
      await ctx.runMutation(internal.githubWebhookData.complete, {
        deliveryId: args.deliveryId,
        disposition: "rejected",
        status: "failed",
        now: Date.now(),
      });
    }
  },
});

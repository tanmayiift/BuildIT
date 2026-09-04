"use node";
import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  authorizeTrigger,
  GitHubAppClient,
  pinPullRequest,
  reviewPolicy,
} from "@buildit/github";
import type { WorkflowId } from "@convex-dev/workflow";
import { requireExecutionEnabled } from "./lib/executionGate";


// Every review starts here, whoever asked for it. The comment path grew this pipeline - fetch the
// pull request, pin it, apply fork policy, record the snapshot, then materialize - and an automatic
// trigger reaching materializeReview by another route would skip the fork and pinning checks
// entirely. So there is one way in, and an architecture test asserts exactly one call site.
type StartReviewInput = {
  deliveryId: string;
  installationId: number;
  githubRepositoryId: number;
  prNumber: number;
  triggerActorLogin: string;
  permission: "read" | "triage" | "write" | "maintain" | "admin";
  mode: "review" | "autofix";
  trigger: "github_comment" | "automatic";
  provider?: "anthropic" | "openai" | "gemini";
  budgetLimit?: 1 | 2 | 3 | 5;
  client: GitHubAppClient;
  scope: { organizationId: Id<"organizations">; repositoryId: Id<"repositories">; owner: string; name: string; forkPolicy: "manual_review_only" | "disabled" };
};

async function startReviewForPullRequest(ctx: ActionCtx, input: StartReviewInput) {
    const pullResponse = await input.client.withToken(
      {
        installationId: input.installationId,
        repositoryId: input.githubRepositoryId,
        stage: "review",
      },
      (token) =>
        fetch(
          `https://api.github.com/repos/${encodeURIComponent(input.scope.owner)}/${encodeURIComponent(input.scope.name)}/pulls/${input.prNumber}`,
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
      number: pull.number ?? input.prNumber,
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
    if (!reviewPolicy(snapshot, input.mode, input.scope.forkPolicy).allowed) {
      await ctx.runAction(internal.reviewPublicationWorker.acknowledge, {
        installationId: input.installationId, githubRepositoryId: input.githubRepositoryId,
        headSha: snapshot.headSha, conclusion: "neutral",
        title: "BuildIT did not review this pull request",
        summary: "This repository does not allow BuildIT to review pull requests from forks. A maintainer can change that in the repository's BuildIT settings, or push the branch to this repository and open the pull request from there.",
      });
      await ctx.runMutation(internal.githubWebhookData.complete, {
        deliveryId: input.deliveryId,
        disposition: "rejected",
        status: "completed",
        now: Date.now(),
      });
      return;
    }
    await ctx.runMutation(internal.githubWebhookData.recordPinnedSnapshot, {
      deliveryId: input.deliveryId,
      prNumber: snapshot.number,
      headSha: snapshot.headSha,
      baseSha: snapshot.baseSha,
      headRefHash: await sha256(snapshot.headRef),
      baseRefHash: await sha256(snapshot.baseRef),
      isFork: snapshot.isFork,
      triggerVerb: input.mode,
    });
    const review = await ctx.runMutation(
      internal.githubWebhookData.materializeReview,
      {
        deliveryId: input.deliveryId,
        trigger: input.trigger,
        organizationId: input.scope.organizationId,
        repositoryId: input.scope.repositoryId,
        baseRef: snapshot.baseRef,
        triggerActor: await sha256(input.triggerActorLogin.toLowerCase()),
        actorPermission: input.permission,
        ...(input.provider ? { expectedProvider: input.provider } : {}),
        ...(input.budgetLimit
          ? { expectedBudgetLimit: input.budgetLimit }
          : {}),
        now: Date.now(),
      },
    );
    if (review.status !== "queued") {
      const blocked = review.blockedReason === "concurrency_limit_reached"
        ? { title: "BuildIT is at its review limit", summary: "This workspace already has as many reviews running as its plan allows. This one will not start. Wait for a running review to finish, or cancel one, then comment again." }
        : { title: "BuildIT needs a model key before it can review", summary: "No model provider is connected to this workspace yet, so there is nothing to run the review with. Connect a key in BuildIT, then comment `@buildit review` again." };
      await ctx.runAction(internal.reviewPublicationWorker.acknowledge, {
        installationId: input.installationId, githubRepositoryId: input.githubRepositoryId,
        headSha: snapshot.headSha, conclusion: "action_required", ...blocked,
      });
      throw new Error("review_not_runnable");
    }
    // The acknowledgement goes up before the work starts, so the pull request is never silent
    // while a review is in flight - and never silent for good if the review dies mid-flight.
    await ctx.runAction(internal.reviewPublicationWorker.acknowledge, {
      installationId: input.installationId, githubRepositoryId: input.githubRepositoryId,
      headSha: snapshot.headSha,
      title: "BuildIT is reviewing this pull request",
      summary: "Reading the pull request and the code it changes, then running this repository's required checks against the exact commit. The result replaces this message.",
    });
    await ctx.runMutation(internal.durableReview.start, {
      organizationId: input.scope.organizationId,
      reviewId: review.reviewId,
      expectedHeadSha: review.headSha,
      expectedGeneration: review.executionGeneration,
      now: Date.now(),
    });
    await ctx.runMutation(internal.githubWebhookData.complete, {
      deliveryId: input.deliveryId,
      disposition: "processed",
      status: "enqueued",
      now: Date.now(),
    });
}

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
      if (decision.kind === "dismiss") {
        await ctx.scheduler.runAfter(0, internal.findingFeedbackWorker.dismissByIndex, {
          githubRepositoryId: args.githubRepositoryId, prNumber: args.prNumber,
          findingIndex: decision.findingIndex, senderLogin: args.senderLogin });
        return;
      }
      if (decision.kind === "help" || decision.kind === "pause" || decision.kind === "resume") {
        await ctx.scheduler.runAfter(0, internal.reviewCommandWorker.respond, {
          organizationId: scope.organizationId,
          repositoryId: scope.repositoryId,
          prNumber: args.prNumber,
          kind: decision.kind,
          actor: await sha256(args.senderLogin.toLowerCase()),
        });
        return;
      }
      if (decision.kind === "ask") {
        await ctx.scheduler.runAfter(0, internal.reviewAskWorker.answer, {
          organizationId: scope.organizationId,
          repositoryId: scope.repositoryId,
          prNumber: args.prNumber,
          question: decision.question,
          askedBy: (await sha256(args.senderLogin.toLowerCase())) ?? "",
        });
        return;
      }
      if (decision.kind === "cancel") {
        const actorId = await sha256(args.senderLogin.toLowerCase()),
          now = Date.now();
        const targets: Array<{ reviewId: Id<"reviews">; workflowId?: string }> =
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
      requireExecutionEnabled();
      await startReviewForPullRequest(ctx, {
        deliveryId: args.deliveryId, installationId: args.installationId,
        githubRepositoryId: args.githubRepositoryId, prNumber: args.prNumber,
        triggerActorLogin: args.senderLogin, permission, client, scope,
        mode: decision.kind === "autofix" ? "autofix" : "review", trigger: "github_comment",
        ...(decision.provider ? { provider: decision.provider } : {}),
        ...(decision.budgetLimit ? { budgetLimit: decision.budgetLimit } : {}),
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


// An automatic review only ever reaches materializeReview through startReviewForPullRequest, so it
// gets the same pinning and fork checks as one a person asked for. The author's own permission is
// what it runs as - an automatic review must not grant more than the person who opened the pull
// request already has.
async function startAutomaticReview(ctx: ActionCtx, args: { deliveryId: string; installationId: number; githubRepositoryId: number; prNumber: number; headSha: string; authorLogin: string }) {
  const eligibility = await ctx.runQuery(internal.automaticReviewData.automaticEligibility, {
    installationId: args.installationId, githubRepositoryId: args.githubRepositoryId,
    prNumber: args.prNumber, headSha: args.headSha });
  if (!eligibility.eligible) return;
  const scope = await ctx.runQuery(internal.githubWebhookData.scope, {
    installationId: args.installationId, githubRepositoryId: args.githubRepositoryId });
  const appId = process.env.GITHUB_APP_ID, privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey) return;
  await startReviewForPullRequest(ctx, {
    deliveryId: args.deliveryId, installationId: args.installationId,
    githubRepositoryId: args.githubRepositoryId, prNumber: args.prNumber,
    triggerActorLogin: args.authorLogin, permission: "write", mode: "review", trigger: "automatic",
    client: new GitHubAppClient({ appId, privateKey }), scope,
  });
}

export const processPullRequestWebhook = internalAction({
  args: {
    deliveryId: v.string(),
    installationId: v.number(),
    githubRepositoryId: v.number(),
    prNumber: v.number(),
    headSha: v.string(),
    action: v.optional(v.string()),
    authorLogin: v.optional(v.string()),
    merged: v.optional(v.boolean()),
    title: v.optional(v.string()),
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
      // Reconciling first is what makes this a debounce rather than a queue: the previous review
      // for an older head is marked stale above, so eligibility sees only a review that covers the
      // head that just arrived.
      if (args.action === "closed" && args.merged) {
        await ctx.scheduler.runAfter(0, internal.changelogWorker.record, {
          githubRepositoryId: args.githubRepositoryId, prNumber: args.prNumber,
          title: args.title ?? `Pull request #${args.prNumber}`, mergedAt: Date.now() });
      }
      if (["opened", "reopened", "synchronize"].includes(args.action ?? "") && args.authorLogin) {
        await startAutomaticReview(ctx, args as { deliveryId: string; installationId: number; githubRepositoryId: number; prNumber: number; headSha: string; authorLogin: string });
      }
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

"use node";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { WorkflowId } from "@convex-dev/workflow";
import { GitHubAppClient, pinPullRequest, reviewPolicy } from "@buildit/github";
import { requireExecutionEnabled } from "./lib/executionGate";

const provider = v.union(v.literal("anthropic"), v.literal("openai"), v.literal("gemini"));
const args = { repositoryId: v.id("repositories"), prNumber: v.number(), budgetLimit: v.number(), provider };
type DashboardScope = { actorId: string; actorRole: "developer" | "admin" | "owner"; organizationId: Id<"organizations">;
  repositoryId: Id<"repositories">; githubRepositoryId: number; installationId: number; owner: string; name: string; forkPolicy: "manual_review_only" | "disabled";
  credentialScopeId: string; provider: "anthropic" | "openai" | "gemini"; model: string; availableModels: string[] };
type PreparedReview = { repository: string; pull: Awaited<ReturnType<typeof snapshot>>; credentialScopeId: string; consent: { reads: string[]; runs: string[]; provider: string; model: string; maximumProviderCostUsd: number; writes: string[]; cannot: string[] } };
const recordPreview = makeFunctionReference<"mutation", { repositoryId: Id<"repositories">; actorId: string; headSha: string; now: number }, string>("dashboardReviewData:recordPreview");
function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
export function previewFailureCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "github_timeout") return "github_timeout";
  if (message === "pull_request_unavailable" || message.startsWith("github_pull_request_")) return "pull_request_unavailable";
  if (message === "repository_or_installation_unavailable" || message === "installation_unavailable" || message === "installation_suspended" || message.startsWith("github_token_") || message.startsWith("github_installation_")) return "github_app_access_unavailable";
  return "github_preview_failed";
}
export function previewTelemetryFailure(code: ReturnType<typeof previewFailureCode>) {
  if (code === "github_timeout") return "timeout" as const;
  if (code === "github_app_access_unavailable") return "configuration_missing" as const;
  if (code === "pull_request_unavailable") return "upstream_unavailable" as const;
  return "UnknownError" as const;
}
export function modelRouteDescription(route: Pick<DashboardScope, "provider" | "model" | "availableModels">) {
  if (route.provider === "openai" && route.model === "gpt-5.4-mini" && route.availableModels.includes("gpt-5.4")) return "openai · gpt-5.4-mini for context and independent checks, with gpt-5.4 for code findings";
  return `${route.provider} · ${route.model}`;
}
async function snapshot(scope: { installationId: number; githubRepositoryId: number; forkPolicy: "manual_review_only" | "disabled" }, prNumber: number) {
  if (!Number.isInteger(prNumber) || prNumber < 1) throw new Error("invalid_pull_request_number");
  const client = new GitHubAppClient({ appId: required("GITHUB_APP_ID"), privateKey: required("GITHUB_APP_PRIVATE_KEY") });
  const tokenScope = { installationId: scope.installationId, repositoryId: scope.githubRepositoryId, stage: "review" as const };
  try {
    const response = await client.withToken(tokenScope, token => fetch(`https://api.github.com/repositories/${scope.githubRepositoryId}/pulls/${prNumber}`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "BuildIT" } }));
    if (response.status === 403 || response.status === 404) throw new Error("pull_request_unavailable");
    if (!response.ok) throw new Error(`github_pull_request_${response.status}`);
    const pull = await response.json() as { number?: number; title?: string; html_url?: string; changed_files?: number; additions?: number; deletions?: number; head?: { sha?: string; ref?: string; repo?: { full_name?: string } | null }; base?: { sha?: string; ref?: string; repo?: { full_name?: string } } };
    const pinned = pinPullRequest({ number: pull.number ?? prNumber, head: { sha: pull.head?.sha ?? "", ref: pull.head?.ref ?? "", repoFullName: pull.head?.repo?.full_name ?? null }, base: { sha: pull.base?.sha ?? "", ref: pull.base?.ref ?? "", repoFullName: pull.base?.repo?.full_name ?? "" } });
    const policy = reviewPolicy(pinned, "review", scope.forkPolicy); if (!policy.allowed) throw new Error(policy.reason);
    return { ...pinned, title: (pull.title ?? "Untitled pull request").slice(0, 500), url: pull.html_url ?? "", changedFiles: pull.changed_files ?? 0, additions: pull.additions ?? 0, deletions: pull.deletions ?? 0 };
  } finally { await client.revoke(tokenScope); }
}

export const prepare = action({ args, handler: async (ctx, input): Promise<PreparedReview> => {
  const scope: DashboardScope = await ctx.runQuery(internal.dashboardReviewData.scope, { repositoryId: input.repositoryId, provider: input.provider });
  let pull: Awaited<ReturnType<typeof snapshot>>;
  try { pull = await snapshot(scope, input.prNumber); }
  catch (error) {
    const code = previewFailureCode(error);
    await ctx.runAction(internal.telemetryWorker.emit, { operation: "activation.preview", stage: "activation", outcome: "failed", errorCode: previewTelemetryFailure(code) });
    throw new Error(code);
  }
  await ctx.runMutation(recordPreview, { repositoryId: input.repositoryId, actorId: scope.actorId, headSha: pull.headSha, now: Date.now() });
  await ctx.runAction(internal.telemetryWorker.emit, { operation: "activation.preview", stage: "activation", outcome: "succeeded" });
  return { repository: `${scope.owner}/${scope.name}`, pull, credentialScopeId: scope.credentialScopeId,
    consent: { reads: ["PR description and diff", "linked GitHub Issues", "repository files needed for impact analysis"],
      runs: ["dependency install with scripts disabled", "test", "lint", "typecheck", "Gitleaks 8.28.0", "OSV-Scanner 2.2.3", "BuildIT static rules 1.0.0"],
      provider: scope.provider, model: `${modelRouteDescription(scope)}. Only bounded context and evidence go to this provider through the saved key inspected now`, maximumProviderCostUsd: input.budgetLimit,
      writes: ["one BuildIT Check", "one BuildIT PR summary"], cannot: ["merge", "edit workflows", "change repository settings", "write a fix branch during review mode"] } };
} });

export const start = action({ args: { ...args, expectedHeadSha: v.string(), expectedBaseSha: v.string(), expectedCredentialScopeId: v.string(), consent: v.literal(true) }, handler: async (ctx, input): Promise<{ reviewId: string }> => {
  requireExecutionEnabled();
  const scope: DashboardScope = await ctx.runQuery(internal.dashboardReviewData.scope, { repositoryId: input.repositoryId, provider: input.provider });
  const pull = await snapshot(scope, input.prNumber);
  if (pull.headSha !== input.expectedHeadSha || pull.baseSha !== input.expectedBaseSha) throw new Error("pull_request_changed_review_again");
  if (scope.credentialScopeId !== input.expectedCredentialScopeId) throw new Error("provider_credential_changed_review_again");
  const review = await ctx.runMutation(internal.dashboardReviewData.create, { repositoryId: input.repositoryId, prNumber: input.prNumber,
    headSha: pull.headSha, baseSha: pull.baseSha, baseRef: pull.baseRef, isFork: pull.isFork, actorId: scope.actorId,
    actorRole: scope.actorRole as "developer" | "admin" | "owner", expectedCredentialScopeId: input.expectedCredentialScopeId, expectedProvider: input.provider, budgetLimit: input.budgetLimit, now: Date.now() });
  await ctx.runAction(internal.telemetryWorker.emit, { operation: "activation.review", stage: "activation", outcome: "started" });
  if (review.status === "queued") await ctx.runMutation(internal.durableReview.start, { organizationId: scope.organizationId, reviewId: review.reviewId,
    expectedHeadSha: review.headSha, expectedGeneration: review.executionGeneration, now: Date.now() });
  return { reviewId: String(review.reviewId) };
} });

export const cancel = action({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, input): Promise<{ status: "cancelled" | "already_finished" }> => {
    const scope = await ctx.runQuery(internal.dashboardReviewData.cancellationScope, input);
    if (scope.terminal) return { status: "already_finished" };
    const now = Date.now();
    if (scope.workflowId) {
      await ctx.runMutation(internal.durableReview.cancel, {
        reviewId: input.reviewId,
        workflowId: scope.workflowId as WorkflowId,
        actorId: scope.actorId,
        now,
      });
    } else {
      await ctx.runMutation(internal.reviewState.requestCancellation, {
        reviewId: input.reviewId,
        actorId: scope.actorId,
        now,
      });
    }
    await ctx.runAction(internal.telemetryWorker.emit, { operation: "activation.decision", stage: "decision", outcome: "cancelled" });
    return { status: "cancelled" };
  },
});

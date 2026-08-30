"use node";
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { GitHubAppClient, GitHubRepositoryWriter, sideEffectKey } from "@buildit/github";
import { issueArtifactGrant } from "@buildit/security";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
type Scope = { organizationId: Id<"organizations">; repositoryId: Id<"repositories">; reviewId: Id<"reviews">; installationId: number; githubRepositoryId: number; prNumber: number; headSha: string; conclusion: "success" | "failure" | "neutral" | "action_required"; status: string; reason: string; report: { id: Id<"artifacts">; storageKey: string; checksum: string; size: number } };

export const publish = internalAction({
  args: { organizationId: v.id("organizations"), reviewId: v.id("reviews"), expectedHeadSha: v.string(), expectedGeneration: v.number() },
  handler: async (ctx, args): Promise<{ checkId: string; commentId: string }> => {
    const scope: Scope = await ctx.runQuery(internal.reviewPublicationData.publicationScope, args), brokerUrl = required("BUILDIT_BROKER_URL").replace(/\/$/, ""), artifactSecret = Buffer.from(required("ARTIFACT_GRANT_SECRET"), "base64url");
    const grant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(scope.report.id), storageKey: scope.report.storageKey, operation: "read" }, artifactSecret);
    const response = await fetch(`${brokerUrl}/api/artifacts`, { headers: { authorization: `Bearer ${grant}` } });
    if (!response.ok) throw new Error(`report_artifact_download_${response.status}`);
    const bodyBuffer = Buffer.from(await response.arrayBuffer());
    if (bodyBuffer.byteLength !== scope.report.size || createHash("sha256").update(bodyBuffer).digest("hex") !== scope.report.checksum) throw new Error("report_artifact_integrity_failed");
    const body = bodyBuffer.toString("utf8");
    if (!body.includes(`Head: \`${scope.headSha}\``) || !body.includes("BuildIT did not merge this pull request.")) throw new Error("report_publication_contract_failed");
    const github = new GitHubAppClient({ appId: required("GITHUB_APP_ID"), privateKey: required("GITHUB_APP_PRIVATE_KEY") }), tokenScope = { installationId: scope.installationId, repositoryId: scope.githubRepositoryId, stage: "review" as const }, token = await github.tokenFor(tokenScope);
    try {
      const current = await fetch(`https://api.github.com/repositories/${scope.githubRepositoryId}/pulls/${scope.prNumber}`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "BuildIT" } });
      if (!current.ok) throw new Error(`github_pull_${current.status}`);
      const value = await current.json() as { head?: { sha?: unknown } };
      if (value.head?.sha !== scope.headSha) throw new Error("stale_head");
      const writer = new GitHubRepositoryWriter({ repositoryId: scope.githubRepositoryId, installationToken: token }), requestHash = createHash("sha256").update(`${scope.conclusion}\0${body}`).digest("hex"), now = Date.now();
      const checkKey = sideEffectKey({ repositoryId: scope.githubRepositoryId, prNumber: scope.prNumber, headSha: scope.headSha, kind: "check" }), commentKey = sideEffectKey({ repositoryId: scope.githubRepositoryId, prNumber: scope.prNumber, headSha: scope.headSha, kind: "comment" });
      const checkEffect: Id<"githubSideEffects"> = await ctx.runMutation(internal.reviewState.reserveSideEffect, { ...args, operationKey: checkKey, type: "check_update", requestHash, now });
      const check = await writer.upsertCheckRun({ name: "BuildIT / review", headSha: scope.headSha, conclusion: scope.conclusion, title: `BuildIT: ${scope.status.replaceAll("_", " ")}`, summary: body });
      await ctx.runMutation(internal.reviewPublicationData.completeSideEffect, { ...args, sideEffectId: checkEffect, requestHash, externalId: String(check.id), status: "completed", now: Date.now() });
      const commentEffect: Id<"githubSideEffects"> = await ctx.runMutation(internal.reviewState.reserveSideEffect, { ...args, operationKey: commentKey, type: "comment_update", requestHash, now });
      const comment = await writer.upsertIssueComment({ prNumber: scope.prNumber, marker: `buildit-review:${scope.reviewId}:${scope.headSha}`, body });
      await ctx.runMutation(internal.reviewPublicationData.completeSideEffect, { ...args, sideEffectId: commentEffect, requestHash, externalId: String(comment.id), status: "completed", now: Date.now() });
      return { checkId: String(check.id), commentId: String(comment.id) };
    } finally { github.revoke(tokenScope); }
  },
});

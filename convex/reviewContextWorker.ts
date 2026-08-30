"use node";
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { chunkRepositorySnapshot, GitHubAppClient, GitHubIssueContextClient, PullRequestContextClient, RepositoryContentClient, type PullRequestContext, type RepositorySnapshot } from "@buildit/github";
import { acquireRequirements,repositoryRequirementSources } from "@buildit/orchestrator";
import { issueArtifactGrant } from "@buildit/security";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
export function sameRepositoryIssueNumber(url: string, repositoryUrl: string) {
  try {
    const link = new URL(url), repository = new URL(repositoryUrl), prefix = repository.pathname.replace(/\/$/, "");
    if (link.protocol !== "https:" || repository.protocol !== "https:" || link.hostname !== "github.com" || repository.hostname !== "github.com" || link.search || link.hash) return undefined;
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), match = link.pathname.match(new RegExp(`^${escaped}/issues/(\\d+)$`)), number = match ? Number(match[1]) : 0;
    return Number.isSafeInteger(number) && number > 0 ? number : undefined;
  } catch { return undefined; }
}

export const gather = internalAction({
  args: { organizationId: v.id("organizations"), reviewId: v.id("reviews"), expectedHeadSha: v.string(), expectedGeneration: v.number() },
  handler: async (ctx, args): Promise<{ artifactIds: string[]; chunkCount: number; fileCount: number; omittedCount: number; coverage: "full" | "partial" }> => {
    const scope: { organizationId: Id<"organizations">; repositoryId: Id<"repositories">; reviewId: Id<"reviews">; installationId: number; githubRepositoryId: number; prNumber: number; headSha: string; baseSha: string; executionGeneration: number; expiresAt: number } = await ctx.runQuery(internal.reviewArtifactData.contextScope, args);
    const github = new GitHubAppClient({ appId: required("GITHUB_APP_ID"), privateKey: required("GITHUB_APP_PRIVATE_KEY") });
    const tokenScope = { installationId: scope.installationId, repositoryId: scope.githubRepositoryId, stage: "review" as const };
    await ctx.runQuery(internal.durableReview.assertActive, args);
    const token = await github.tokenFor(tokenScope);
    try {
      await ctx.runQuery(internal.durableReview.assertActive, args);
      const [headSnapshot, baseSnapshot, pullContext]: [RepositorySnapshot, RepositorySnapshot, PullRequestContext] = await Promise.all([
        new RepositoryContentClient().fetchExactCommit({ installationToken: token, repositoryId: scope.githubRepositoryId,
          commitSha: scope.headSha, limits: { maxFiles: 10_000, maxFileBytes: 1_000_000, maxTotalBytes: 40_000_000 } }),
        new RepositoryContentClient().fetchExactCommit({ installationToken: token, repositoryId: scope.githubRepositoryId,
          commitSha: scope.baseSha, limits: { maxFiles: 10_000, maxFileBytes: 1_000_000, maxTotalBytes: 40_000_000 } }),
        new PullRequestContextClient().fetch({ installationToken: token, repositoryId: scope.githubRepositoryId, prNumber: scope.prNumber,
          expectedHeadSha: scope.headSha, expectedBaseSha: scope.baseSha }),
      ]);
      const repositoryMatch = pullContext.htmlUrl.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)\/pull\/\d+$/i);
      if (!repositoryMatch) throw new Error("pull_request_url_invalid");
      const repositoryUrl = repositoryMatch[1]!, issueClient = new GitHubIssueContextClient(),repositoryIntent=repositoryRequirementSources({files:headSnapshot.files,headSha:scope.headSha,now:Date.now()});
      const intent = await acquireRequirements({ prBody: pullContext.body, prUrl: pullContext.htmlUrl, repositoryUrl, headSha: scope.headSha, now: Date.now(), maxSourceBytes: 250_000, fetch: async link => {
        if (link.type !== "github_issue") return { status: "inaccessible", version: "connection_unavailable" };
        const issueNumber = sameRepositoryIssueNumber(link.url, repositoryUrl);
        if (!issueNumber) return { status: "inaccessible", version: "repository_scope_mismatch" };
        return issueClient.fetch({ installationToken: token, repositoryId: scope.githubRepositoryId, issueNumber, maxBytes: 250_000 });
      },repositorySources:repositoryIntent.sources });
      const intentCoverage=intent.coverage==="complete"&&repositoryIntent.coverage==="complete"?"complete" as const:"partial" as const;
      const pull = { title: pullContext.title, body: pullContext.body, files: pullContext.files, omitted: pullContext.omitted,
        urlHash: createHash("sha256").update(pullContext.htmlUrl).digest("hex"), requirementCoverage: intentCoverage,
        requirementSources: intent.sources.map(source => ({ id: source.id, type: source.type, status: source.status, version: source.version, urlHash: createHash("sha256").update(source.url).digest("hex"),
          ...(source.type === "pull_request" || source.content === undefined ? {} : { content: source.content }) })),
        requirements: intent.requirements };
      const pullBytes = Buffer.byteLength(JSON.stringify(pull));
      if (pullBytes > 2_500_000) throw new Error("pull_request_context_too_large");
      const artifactIds: string[] = [], brokerUrl = required("BUILDIT_BROKER_URL").replace(/\/$/, ""),
        secret = Buffer.from(required("ARTIFACT_GRANT_SECRET"), "base64url");
      let chunkCount = 0;
      for (const [revision, snapshot] of [["head", headSnapshot], ["base", baseSnapshot]] as const) {
        const chunks = chunkRepositorySnapshot(snapshot, revision === "head" ? Math.max(1_100_000, 3_700_000 - pullBytes) : 3_700_000);
        chunkCount += chunks.length;
        for (const chunk of chunks) {
          const body = Buffer.from(JSON.stringify({ version: 1, revision, pull: revision === "head" && chunk.chunkIndex === 0 ? pull : undefined, snapshot: chunk }));
          if (body.byteLength > 4_000_000) throw new Error("context_artifact_too_large");
          const checksum = createHash("sha256").update(body).digest("hex"), now = Date.now();
          const reserved: { artifactId: Id<"artifacts">; repositoryId: Id<"repositories">; reviewId: Id<"reviews">; storageKey: string; expiresAt: number } = await ctx.runMutation(internal.reviewArtifactData.reserve, { ...args, checksum, size: body.byteLength, chunkIndex: chunk.chunkIndex, revision, now });
          const grant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId),
            artifactId: String(reserved.artifactId), storageKey: reserved.storageKey, operation: "write" }, secret, now);
          await ctx.runQuery(internal.durableReview.assertActive, args);
          const response = await fetch(`${brokerUrl}/api/artifacts`, { method: "PUT", headers: { authorization: `Bearer ${grant}`, "content-type": "application/octet-stream", "x-buildit-sha256": checksum }, body });
          if (!response.ok) throw new Error(`artifact_upload_${response.status}`);
          const coverage = headSnapshot.coverage === "full" && baseSnapshot.coverage === "full" && pullContext.coverage === "full" && intentCoverage === "complete" ? "full" as const : "partial" as const;
          await ctx.runMutation(internal.reviewArtifactData.complete, { organizationId: scope.organizationId, reviewId: scope.reviewId,
            artifactId: reserved.artifactId, checksum, size: body.byteLength, coverage, now: Date.now() });
          artifactIds.push(String(reserved.artifactId));
        }
      }
      const coverage = headSnapshot.coverage === "full" && baseSnapshot.coverage === "full" && pullContext.coverage === "full" && intentCoverage === "complete" ? "full" as const : "partial" as const;
      return { artifactIds, chunkCount, fileCount: headSnapshot.files.length + baseSnapshot.files.length,
        omittedCount: headSnapshot.omitted.length + baseSnapshot.omitted.length + pullContext.omitted.length + intent.sources.filter(source => source.status !== "available").length+repositoryIntent.omitted.length, coverage };
    } finally { github.revoke(tokenScope); }
  },
});

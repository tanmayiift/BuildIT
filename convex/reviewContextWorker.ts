"use node";
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { chunkRepositorySnapshot, GitHubAppClient, PullRequestContextClient, RepositoryContentClient, type PullRequestContext, type RepositorySnapshot } from "@buildit/github";
import { issueArtifactGrant } from "@buildit/security";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }

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
      const pull = { title: pullContext.title, body: pullContext.body, files: pullContext.files, omitted: pullContext.omitted,
        urlHash: createHash("sha256").update(pullContext.htmlUrl).digest("hex") };
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
          const coverage = headSnapshot.coverage === "full" && baseSnapshot.coverage === "full" && pullContext.coverage === "full" ? "full" as const : "partial" as const;
          await ctx.runMutation(internal.reviewArtifactData.complete, { organizationId: scope.organizationId, reviewId: scope.reviewId,
            artifactId: reserved.artifactId, checksum, size: body.byteLength, coverage, now: Date.now() });
          artifactIds.push(String(reserved.artifactId));
        }
      }
      const coverage = headSnapshot.coverage === "full" && baseSnapshot.coverage === "full" && pullContext.coverage === "full" ? "full" as const : "partial" as const;
      return { artifactIds, chunkCount, fileCount: headSnapshot.files.length + baseSnapshot.files.length,
        omittedCount: headSnapshot.omitted.length + baseSnapshot.omitted.length + pullContext.omitted.length, coverage };
    } finally { github.revoke(tokenScope); }
  },
});

"use node";
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { chunkRepositorySnapshot, GitHubAppClient, RepositoryContentClient, type RepositorySnapshot } from "@buildit/github";
import { issueArtifactGrant } from "@buildit/security";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }

export const gather = internalAction({
  args: { organizationId: v.id("organizations"), reviewId: v.id("reviews"), expectedHeadSha: v.string(), expectedGeneration: v.number() },
  handler: async (ctx, args): Promise<{ artifactIds: string[]; chunkCount: number; fileCount: number; omittedCount: number; coverage: "full" | "partial" }> => {
    const scope: { organizationId: Id<"organizations">; repositoryId: Id<"repositories">; reviewId: Id<"reviews">; installationId: number; githubRepositoryId: number; prNumber: number; headSha: string; baseSha: string; executionGeneration: number; expiresAt: number } = await ctx.runQuery(internal.reviewArtifactData.contextScope, args);
    const github = new GitHubAppClient({ appId: required("GITHUB_APP_ID"), privateKey: required("GITHUB_APP_PRIVATE_KEY") });
    const tokenScope = { installationId: scope.installationId, repositoryId: scope.githubRepositoryId, stage: "review" as const };
    const token = await github.tokenFor(tokenScope);
    try {
      const [snapshot, pullResponse]: [RepositorySnapshot, Response] = await Promise.all([
        new RepositoryContentClient().fetchExactCommit({ installationToken: token, repositoryId: scope.githubRepositoryId,
          commitSha: scope.headSha, limits: { maxFiles: 10_000, maxFileBytes: 1_000_000, maxTotalBytes: 40_000_000 } }),
        fetch(`https://api.github.com/repositories/${scope.githubRepositoryId}/pulls/${scope.prNumber}`, { headers: {
          Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "BuildIT" } }),
      ]);
      if (!pullResponse.ok) throw new Error(`pull_request_context_${pullResponse.status}`);
      const rawPull = await pullResponse.json() as { title?: unknown; body?: unknown; html_url?: unknown };
      const pull = { title: typeof rawPull.title === "string" ? rawPull.title.slice(0, 500) : "",
        body: typeof rawPull.body === "string" ? rawPull.body.slice(0, 250_000) : "",
        urlHash: createHash("sha256").update(typeof rawPull.html_url === "string" ? rawPull.html_url : "").digest("hex") };
      const chunks = chunkRepositorySnapshot(snapshot);
      const artifactIds: string[] = [], brokerUrl = required("BUILDIT_BROKER_URL").replace(/\/$/, ""),
        secret = Buffer.from(required("ARTIFACT_GRANT_SECRET"), "base64url");
      for (const chunk of chunks) {
        const body = Buffer.from(JSON.stringify({ version: 1, pull: chunk.chunkIndex === 0 ? pull : undefined, snapshot: chunk }));
        const checksum = createHash("sha256").update(body).digest("hex"), now = Date.now();
        const reserved: { artifactId: Id<"artifacts">; repositoryId: Id<"repositories">; reviewId: Id<"reviews">; storageKey: string; expiresAt: number } = await ctx.runMutation(internal.reviewArtifactData.reserve, { ...args, checksum, size: body.byteLength, chunkIndex: chunk.chunkIndex, now });
        const grant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId),
          artifactId: String(reserved.artifactId), storageKey: reserved.storageKey, operation: "write" }, secret, now);
        const response = await fetch(`${brokerUrl}/api/artifacts`, { method: "PUT", headers: { authorization: `Bearer ${grant}`, "content-type": "application/octet-stream", "x-buildit-sha256": checksum }, body });
        if (!response.ok) throw new Error(`artifact_upload_${response.status}`);
        await ctx.runMutation(internal.reviewArtifactData.complete, { organizationId: scope.organizationId, reviewId: scope.reviewId,
          artifactId: reserved.artifactId, checksum, size: body.byteLength, coverage: snapshot.coverage, now: Date.now() });
        artifactIds.push(String(reserved.artifactId));
      }
      return { artifactIds, chunkCount: chunks.length, fileCount: snapshot.files.length, omittedCount: snapshot.omitted.length, coverage: snapshot.coverage };
    } finally { github.revoke(tokenScope); }
  },
});

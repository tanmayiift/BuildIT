"use node";
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { chunkRepositorySnapshot, GitHubAppClient, GitHubIssueContextClient, omissionCoverage, type PullRequestContext, PullRequestContextClient, RepositoryContentClient, type RepositorySnapshot } from "@buildit/github";
import { dependencyManifest } from "@buildit/runner";
import { acquireRequirements, isRequirementSourcePath, repositoryRequirementSources } from "@buildit/orchestrator";
import { issueArtifactGrant,issueTrackerGrant } from "@buildit/security";

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
  handler: async (ctx, args): Promise<{ artifactIds: string[]; chunkCount: number; fileCount: number; omittedCount: number }> => {
    const scope: { organizationId: Id<"organizations">; repositoryId: Id<"repositories">; reviewId: Id<"reviews">; installationId: number; githubRepositoryId: number; prNumber: number; headSha: string; baseSha: string; executionGeneration: number; expiresAt: number;trackers:Array<{documentId:Id<"trackerConnections">;id:string;organizationId:string;provider:"github"|"linear"|"jira";workspaceId:string;ciphertext:string;nonce:string;tag:string;wrappedDataKey:string;kmsKeyId:string;envelopeVersion:1;keyVersion:number;aadDigest:string;status:"active";createdBy:string;createdAt:number}> } = await ctx.runQuery(internal.reviewArtifactData.contextScope, args);
    const github = new GitHubAppClient({ appId: required("GITHUB_APP_ID"), privateKey: required("GITHUB_APP_PRIVATE_KEY") });
    const tokenScope = { installationId: scope.installationId, repositoryId: scope.githubRepositoryId, stage: "review" as const };
    await ctx.runQuery(internal.durableReview.assertActive, args);
    const token = await github.tokenFor(tokenScope);
    try {
      await ctx.runQuery(internal.durableReview.assertActive, args);
      const pullContext: PullRequestContext = await new PullRequestContextClient().fetch({ installationToken: token,
        repositoryId: scope.githubRepositoryId, prNumber: scope.prNumber, expectedHeadSha: scope.headSha, expectedBaseSha: scope.baseSha });
      const changedPaths = new Set(pullContext.files.map(file => file.path));
      const limits = { maxFiles: 10_000, maxFetchFiles: 2_500, maxFileBytes: 1_000_000, maxTotalBytes: 40_000_000 };
      // Head keeps the documents, because requirements are read from them. Base does not: its file
      // contents are filtered out of the model context entirely (reviewAnalysisWorker filters
      // revision !== "base"), so fetching anything beyond the changed files buys a presence check.
      const headSelect = { keep: (path: string) => changedPaths.has(path) || isRequirementSourcePath(path) || dependencyManifest.test(path), relevantOnlyAbove: 400 };
      const baseSelect = { keep: (path: string) => changedPaths.has(path), relevantOnlyAbove: 400 };
      await ctx.runQuery(internal.durableReview.assertActive, args);
      const [headSnapshot, baseSnapshot]: [RepositorySnapshot, RepositorySnapshot] = await Promise.all([
        new RepositoryContentClient().fetchExactCommit({ installationToken: token, repositoryId: scope.githubRepositoryId,
          commitSha: scope.headSha, limits, select: headSelect }),
        new RepositoryContentClient().fetchExactCommit({ installationToken: token, repositoryId: scope.githubRepositoryId,
          commitSha: scope.baseSha, limits, select: baseSelect }),
      ]);
      const repositoryMatch = pullContext.htmlUrl.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)\/pull\/\d+$/i);
      if (!repositoryMatch) throw new Error("pull_request_url_invalid");
      const repositoryUrl = repositoryMatch[1]!, issueClient = new GitHubIssueContextClient(),repositoryIntent=repositoryRequirementSources({files:headSnapshot.files,headSha:scope.headSha,now:Date.now()}),brokerUrl=required("BUILDIT_BROKER_URL").replace(/\/$/,""),trackerSecret=Buffer.from(required("TRACKER_GRANT_SECRET"),"base64url");
      const intent = await acquireRequirements({ prBody: pullContext.body, prUrl: pullContext.htmlUrl, repositoryUrl, headSha: scope.headSha, now: Date.now(), maxSourceBytes: 250_000, fetch: async link => {
        if (link.type!=="github_issue"){const credential=scope.trackers.find(item=>item.provider===link.type);if(!credential)return{status:"inaccessible",version:"connection_unavailable"};const{documentId:_,...brokerCredential}=credential,grant=issueTrackerGrant({organizationId:String(scope.organizationId),repositoryId:String(scope.repositoryId),reviewId:String(scope.reviewId),credentialScopeId:credential.id,provider:link.type,workspaceId:credential.workspaceId,urlHash:createHash("sha256").update(link.url).digest("hex")},trackerSecret),body=JSON.stringify({organizationId:String(scope.organizationId),repositoryId:String(scope.repositoryId),reviewId:String(scope.reviewId),url:link.url,credential:brokerCredential}),response=await fetch(`${brokerUrl}/api/tracker`,{method:"POST",headers:{authorization:`Bearer ${grant}`,"content-type":"application/json"},body}),output=await response.json()as{result?:{status:"available"|"missing"|"inaccessible"|"image_only"|"oversized";version:string;content?:string}};if(!response.ok||!output.result)throw new Error(`tracker_context_${response.status}`);await ctx.runMutation(internal.reviewArtifactData.markTrackerUsed,{...args,connectionId:credential.documentId,now:Date.now()});return output.result}
        const issueNumber = sameRepositoryIssueNumber(link.url, repositoryUrl);
        if (!issueNumber) return { status: "inaccessible", version: "repository_scope_mismatch" };
        return issueClient.fetch({ installationToken: token, repositoryId: scope.githubRepositoryId, issueNumber, maxBytes: 250_000 });
      },repositorySources:repositoryIntent.sources });
      const intentCoverage=intent.coverage==="complete"&&repositoryIntent.coverage==="complete"?"complete" as const:"partial" as const;
      const pull = { title: pullContext.title, body: pullContext.body, files: pullContext.files, omitted: pullContext.omitted,
        urlHash: createHash("sha256").update(pullContext.htmlUrl).digest("hex"), requirementCoverage: intentCoverage,
        requirementSources: intent.sources.map(source => ({ id: source.id, type: source.type, status: source.status, version: source.version, urlHash: createHash("sha256").update(source.url).digest("hex"),
          ...(source.type === "pull_request" || source.content === undefined ? {} : { content: source.content }) })),
        requirements: intent.requirements,requirementConflicts:intent.conflicts };
      const pullBytes = Buffer.byteLength(JSON.stringify(pull));
      if (pullBytes > 2_500_000) throw new Error("pull_request_context_too_large");
      const artifactIds: string[] = [],
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
          const headCoverage = omissionCoverage(headSnapshot.omitted, changedPaths);
          const baseCoverage = omissionCoverage(baseSnapshot.omitted, changedPaths);
          // Ordered worst-first: an unreadable changed file is a bigger hole than a truncated diff,
          // which is bigger than a ticket that could not be fetched. The first one that applies is
          // the cause the review reports, so "inconclusive" can name what stopped it.
          const coverageGap = headCoverage !== "full" || baseCoverage !== "full" ? "changed_files" as const
            : pullContext.coverage !== "full" ? "diff_truncated" as const
            : intentCoverage !== "complete" ? "requirements" as const : undefined;
          const coverage = coverageGap ? "partial" as const : "full" as const;
          await ctx.runMutation(internal.reviewArtifactData.complete, { organizationId: scope.organizationId, reviewId: scope.reviewId,
            expectedHeadSha: args.expectedHeadSha, expectedGeneration: args.expectedGeneration,
            artifactId: reserved.artifactId, checksum, size: body.byteLength, coverage, coverageGap, now: Date.now() });
          artifactIds.push(String(reserved.artifactId));
        }
      }
      return { artifactIds, chunkCount, fileCount: headSnapshot.files.length + baseSnapshot.files.length,
        omittedCount: headSnapshot.omitted.length + baseSnapshot.omitted.length + pullContext.omitted.length + intent.sources.filter(source => source.status !== "available").length+repositoryIntent.omitted.length };
    } finally { await github.revoke(tokenScope); }
  },
});

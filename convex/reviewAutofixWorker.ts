"use node";
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { DataModel } from "./_generated/dataModel";
import type { GenericActionCtx } from "convex/server";
import { GitHubAppClient, GitHubRepositoryWriter, RepositoryContentClient, chunkRepositorySnapshot } from "@buildit/github";
import { contentHash, validatePatchProposals, type PatchProposal } from "@buildit/orchestrator";
import { defaultExecutionPlans } from "@buildit/runner";
import { issueArtifactGrant, issueExecutionGrant } from "@buildit/security";
import { detectPackageManager, revisionFromStorageKey, sha256Json, summarizeExecution, type ExecutionResponse } from "./lib/validationEvidence";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
type ArtifactRef = { id: Id<"artifacts">; storageKey: string; checksum: string; size: number };
type Scope = { organizationId: Id<"organizations">; repositoryId: Id<"repositories">; reviewId: Id<"reviews">; installationId: number; githubRepositoryId: number; prNumber: number; headSha: string; baseSha: string; createdAt: number; configRevisionId: Id<"configRevisions">; runnerImageVersion: string; analysis: ArtifactRef; contexts: ArtifactRef[]; rounds: Array<{ roundNumber: number; candidateCommitSha: string; outcome: string }> };
type SnapshotChunk = { revision?: "base" | "head"; snapshot?: { commitSha?: string; files?: Array<{ path: string; content: string; size: number }> } };
type Analysis = { version?: number; pinned?: { headSha?: string; baseSha?: string }; records?: Array<{ stage?: string; value?: { patches?: PatchProposal[] } }>; arbitrated?: Array<{ id?: string; resolution?: string }> };

async function readArtifact(scope: Scope, artifact: ArtifactRef, brokerUrl: string, secret: Buffer) {
  const grant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(artifact.id), storageKey: artifact.storageKey, operation: "read" }, secret);
  const response = await fetch(`${brokerUrl}/api/artifacts`, { headers: { authorization: `Bearer ${grant}` } });
  if (!response.ok) throw new Error(`autofix_artifact_download_${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength !== artifact.size || createHash("sha256").update(body).digest("hex") !== artifact.checksum) throw new Error("autofix_artifact_integrity_failed");
  return body;
}

async function storeArtifact(ctx: GenericActionCtx<DataModel>, scope: Scope, args: { organizationId: Id<"organizations">; reviewId: Id<"reviews">; expectedHeadSha: string; expectedGeneration: number }, input: { roundNumber: number; slot: string; type: "patch" | "command_output"; body: Buffer }, brokerUrl: string, secret: Buffer) {
  const checksum = createHash("sha256").update(input.body).digest("hex"), now = Date.now();
  const reserved: { artifactId: Id<"artifacts">; storageKey: string } = await ctx.runMutation(internal.reviewAutofixData.reserveArtifact, { ...args, roundNumber: input.roundNumber, slot: input.slot, type: input.type, checksum, size: input.body.byteLength, now });
  const grant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(reserved.artifactId), storageKey: reserved.storageKey, operation: "write" }, secret, now);
  const upload = await fetch(`${brokerUrl}/api/artifacts`, { method: "PUT", headers: { authorization: `Bearer ${grant}`, "content-type": "application/octet-stream", "x-buildit-sha256": checksum }, body: new Uint8Array(input.body) });
  if (!upload.ok) throw new Error(`autofix_artifact_upload_${upload.status}`);
  await ctx.runMutation(internal.reviewAutofixData.completeArtifact, { ...args, artifactId: reserved.artifactId, checksum, size: input.body.byteLength });
  return { id: reserved.artifactId, storageKey: reserved.storageKey, checksum, size: input.body.byteLength };
}

export const runFirstRound = internalAction({
  args: { organizationId: v.id("organizations"), reviewId: v.id("reviews"), expectedHeadSha: v.string(), expectedGeneration: v.number() },
  handler: async (ctx, args): Promise<{ candidateCommitSha: string; outcome: "passed" | "failed" | "incomplete"; roundNumber: 1 }> => {
    const scope: Scope = await ctx.runQuery(internal.reviewAutofixData.scope, args);
    const prior = scope.rounds.find(item => item.roundNumber === 1);
    if (prior) return { candidateCommitSha: prior.candidateCommitSha, outcome: prior.outcome as "passed" | "failed" | "incomplete", roundNumber: 1 };
    const brokerUrl = required("BUILDIT_BROKER_URL").replace(/\/$/, ""), artifactSecret = Buffer.from(required("ARTIFACT_GRANT_SECRET"), "base64url"), executionSecret = Buffer.from(required("EXECUTION_GRANT_SECRET"), "base64url");
    const [analysisBody, ...contextBodies] = await Promise.all([readArtifact(scope, scope.analysis, brokerUrl, artifactSecret), ...scope.contexts.map(item => readArtifact(scope, item, brokerUrl, artifactSecret))]);
    const analysis = JSON.parse(analysisBody.toString("utf8")) as Analysis;
    if (analysis.version !== 1 || analysis.pinned?.headSha !== scope.headSha || analysis.pinned?.baseSha !== scope.baseSha || !Array.isArray(analysis.records) || !Array.isArray(analysis.arbitrated)) throw new Error("autofix_analysis_pinning_failed");
    const chunks = contextBodies.map(body => JSON.parse(body.toString("utf8")) as SnapshotChunk), headFiles = chunks.filter(item => item.revision === "head").flatMap(item => item.snapshot?.files ?? []), acceptedFindingIds = new Set(analysis.arbitrated.filter(item => item.resolution === "accepted" && typeof item.id === "string").map(item => item.id!));
    const proposals = analysis.records.find(item => item.stage === "patch")?.value?.patches;
    if (!Array.isArray(proposals) || !proposals.length) throw new Error("autofix_patch_unavailable");
    const sources = headFiles.map(file => ({ path: file.path, content: file.content, contentHash: contentHash(file.content) })), patches = validatePatchProposals({ proposals, sources, acceptedFindingIds });
    const github = new GitHubAppClient({ appId: required("GITHUB_APP_ID"), privateKey: required("GITHUB_APP_PRIVATE_KEY") }), tokenScope = { installationId: scope.installationId, repositoryId: scope.githubRepositoryId, stage: "autofix_delivery" as const }, token = await github.tokenFor(tokenScope), writer = new GitHubRepositoryWriter({ repositoryId: scope.githubRepositoryId, installationToken: token });
    try {
      const pullResponse = await fetch(`https://api.github.com/repositories/${scope.githubRepositoryId}/pulls/${scope.prNumber}`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "BuildIT" } });
      if (!pullResponse.ok) throw new Error(`github_pull_${pullResponse.status}`);
      const pull = await pullResponse.json() as { head?: { sha?: string } };
      if (pull.head?.sha !== scope.headSha) throw new Error("stale_head");
      const candidateCommitSha = await writer.createCandidateCommit({ pinnedHead: scope.headSha, currentHead: scope.headSha, message: `BuildIT Autofix for PR #${scope.prNumber} · round 1`, patches: patches.map(item => ({ path: item.path, content: item.replacementContent })), identity: { name: "BuildIT", email: "buildit@users.noreply.github.com", date: new Date(scope.createdAt + 1).toISOString() } });
      const candidate = await new RepositoryContentClient().fetchExactCommit({ installationToken: token, repositoryId: scope.githubRepositoryId, commitSha: candidateCommitSha, limits: { maxFiles: 10_000, maxFileBytes: 1_000_000, maxTotalBytes: 40_000_000 } });
      if (candidate.coverage !== "full") throw new Error("autofix_candidate_context_partial");
      const candidateArtifacts: Array<{ id: Id<"artifacts">; storageKey: string; checksum: string; size: number }> = [];
      for (const chunk of chunkRepositorySnapshot(candidate, 3_700_000)) candidateArtifacts.push(await storeArtifact(ctx, scope, args, { roundNumber: 1, slot: `candidate-${chunk.chunkIndex}`, type: "patch", body: Buffer.from(JSON.stringify({ version: 1, revision: "head", snapshot: chunk })) }, brokerUrl, artifactSecret));
      const baseContexts = scope.contexts.map((context, index) => ({ context, body: chunks[index]! })).filter(item => item.body.revision === "base"), paths = { base: new Set(baseContexts.flatMap(item => item.body.snapshot?.files?.map(file => file.path) ?? [])), head: new Set(candidate.files.map(file => file.path)) }, manager = detectPackageManager(paths), { install, checks } = defaultExecutionPlans(manager), runtime = "node24" as const;
      const baseDescriptors = baseContexts.map(({ context }) => ({ revision: "base" as const, artifactId: String(context.id), storageKey: context.storageKey, checksum: context.checksum, size: context.size, readGrant: issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(context.id), storageKey: context.storageKey, operation: "read" }, artifactSecret) }));
      const candidateDescriptors = candidateArtifacts.map(item => ({ revision: "head" as const, artifactId: String(item.id), storageKey: item.storageKey, checksum: item.checksum, size: item.size, readGrant: issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(item.id), storageKey: item.storageKey, operation: "read" }, artifactSecret) })), descriptors = [...baseDescriptors, ...candidateDescriptors];
      const artifactsHash = sha256Json(descriptors.map(({ readGrant: _, ...item }) => item)), plansHash = sha256Json({ runtime, install, checks }), executionGrant = issueExecutionGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), baseSha: scope.baseSha, headSha: candidateCommitSha, artifactsHash, plansHash, ttlMs: 120_000 }, executionSecret);
      const executionResponse = await fetch(`${brokerUrl}/api/execute`, { method: "POST", headers: { authorization: `Bearer ${executionGrant}`, "content-type": "application/json" }, body: JSON.stringify({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), baseSha: scope.baseSha, headSha: candidateCommitSha, runtime, artifacts: descriptors, install, checks }) });
      const output = await executionResponse.json() as ExecutionResponse & { error?: string };
      if (!executionResponse.ok) throw new Error(output.error ?? `autofix_execution_${executionResponse.status}`);
      const allSummaries = summarizeExecution(output, scope.baseSha, candidateCommitSha), headSummaries = allSummaries.filter(item => item.revision === "head").map(item => ({ commitSha: item.commitSha, planId: item.planId, kind: item.kind, required: item.required, conclusion: item.conclusion, ...("exitCode" in item && item.exitCode !== undefined ? { exitCode: item.exitCode } : {}), durationMs: item.durationMs, commandFingerprint: item.commandFingerprint, nameHash: createHash("sha256").update(item.planId).digest("hex") }));
      const requiredRuns = headSummaries.filter(item => item.required), outcome = requiredRuns.some(item => !["passed", "failed"].includes(item.conclusion)) ? "incomplete" as const : requiredRuns.some(item => item.conclusion === "failed") ? "failed" as const : "passed" as const;
      const validationBody = Buffer.from(JSON.stringify({ version: 1, roundNumber: 1, pinned: { baseSha: scope.baseSha, originalHeadSha: scope.headSha, candidateCommitSha, configRevisionId: String(scope.configRevisionId), runnerImageVersion: scope.runnerImageVersion }, manager, output })), validationArtifact = await storeArtifact(ctx, scope, args, { roundNumber: 1, slot: "validation", type: "command_output", body: validationBody }, brokerUrl, artifactSecret), patchFingerprint = createHash("sha256").update(JSON.stringify(patches.map(item => ({ path: item.path, expectedContentHash: item.expectedContentHash, replacementHash: contentHash(item.replacementContent), findingIds: item.findingIds })))).digest("hex");
      await ctx.runMutation(internal.reviewAutofixData.completeRound, { ...args, roundNumber: 1, candidateCommitSha, patchFingerprint, patchArtifactId: candidateArtifacts[0]!.id, validationArtifactId: validationArtifact.id, summaries: headSummaries, outcome, now: Date.now() });
      return { candidateCommitSha, outcome, roundNumber: 1 };
    } finally { github.revoke(tokenScope); }
  },
});

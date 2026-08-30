"use node";
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { runModelReviewChain, type ModelStageRequest, type PromptStage } from "@buildit/orchestrator";
import type { ProviderName, ProviderResult } from "@buildit/providers";
import { issueArtifactGrant, issueModelInvocationGrant } from "@buildit/security";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
type SnapshotChunk = { revision?: "base" | "head"; pull?: { title: string; body: string; files: Array<{ path: string; patch?: string; status: string }>; omitted: unknown[]; urlHash: string }; snapshot: { files: Array<{ path: string; content: string; size: number }>; omitted: unknown[]; coverage: string } };
type AnalysisScope = { organizationId: Id<"organizations">; repositoryId: Id<"repositories">; reviewId: Id<"reviews">; headSha: string; baseSha: string; configRevision: string; provider: ProviderName; model: string;
  credential: { id: string; organizationId: string; repositoryId?: string; provider: ProviderName; ciphertext: string; nonce: string; tag: string; wrappedDataKey: string; kmsKeyId: string; envelopeVersion: 1; keyVersion: number; aadDigest: string; maskedSuffix: string; status: "valid"; createdBy: string; createdAt: number; lastValidatedAt: number };
  credentialDocumentId: Id<"providerCredentials">; artifacts: Array<{ id: Id<"artifacts">; storageKey: string; checksum: string; size: number }> };

export function boundedAnalysisContext(chunks: SnapshotChunk[], maxBytes = 80_000) {
  const headChunks = chunks.filter(chunk => chunk.revision !== "base"), pull = headChunks.find(chunk => chunk.pull)?.pull;
  if (!pull) throw new Error("pull_request_context_missing");
  const body = pull.body.slice(0, 30_000), bodyTruncated = body.length !== pull.body.length, changes: Array<{ path: string; status: string; patch?: string }> = [], patchPaths: string[] = [];
  let patchBudget = 30_000;
  for (const file of pull.files) {
    const patch = file.patch?.slice(0, Math.max(0, patchBudget));
    if (patch) patchBudget -= patch.length;
    if (file.patch && patch?.length !== file.patch.length) patchPaths.push(file.path);
    changes.push({ path: file.path, status: file.status, ...(patch ? { patch } : {}) });
  }
  const changed = new Set(changes.map(file => file.path)), files: Array<{ path: string; content: string }> = [], excluded: string[] = [];
  const base = { pull: { title: pull.title, body, bodyTruncated, changes, urlHash: pull.urlHash }, files, exclusions: { paths: excluded, patchPaths, source: headChunks.flatMap(chunk => chunk.snapshot.omitted), pull: pull.omitted } };
  let bytes = Buffer.byteLength(JSON.stringify(base));
  for (const file of headChunks.flatMap(chunk => chunk.snapshot.files).sort((a, b) => Number(changed.has(b.path)) - Number(changed.has(a.path)) || a.path.localeCompare(b.path))) {
    const item = { path: file.path, content: file.content }, size = Buffer.byteLength(JSON.stringify(item));
    if (bytes + size > maxBytes) { excluded.push(file.path); continue; }
    files.push(item); bytes += size;
  }
  if (Buffer.byteLength(JSON.stringify(base)) > maxBytes) throw new Error("analysis_context_too_large");
  return { ...base, coverage: excluded.length || patchPaths.length || bodyTruncated || pull.omitted.length || headChunks.some(chunk => chunk.snapshot.coverage !== "full") ? "partial" as const : "full" as const };
}
function criticModel(provider: ProviderName, primary: string) { return provider === "gemini" ? (primary === "gemini-2.5-flash" ? "gemini-2.5-pro" : "gemini-2.5-flash") : provider === "openai" ? (primary === "gpt-5.4-mini" ? "gpt-5.4" : "gpt-5.4-mini") : (primary === "claude-sonnet-4-5" ? "claude-sonnet-4-6" : "claude-sonnet-4-5"); }

export const analyze = internalAction({
  args: { organizationId: v.id("organizations"), reviewId: v.id("reviews"), expectedHeadSha: v.string(), expectedGeneration: v.number() },
  handler: async (ctx, args): Promise<{ artifactId: string; stages: number; inputTokens: number; outputTokens: number }> => {
    const scope: AnalysisScope = await ctx.runQuery(internal.reviewModelData.analysisScope, args), brokerUrl = required("BUILDIT_BROKER_URL").replace(/\/$/, ""), artifactSecret = Buffer.from(required("ARTIFACT_GRANT_SECRET"), "base64url"), modelSecret = Buffer.from(required("MODEL_GRANT_SECRET"), "base64url");
    const chunks: SnapshotChunk[] = [];
    for (const artifact of scope.artifacts) {
      const grant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(artifact.id), storageKey: artifact.storageKey, operation: "read" }, artifactSecret);
      const response = await fetch(`${brokerUrl}/api/artifacts`, { headers: { authorization: `Bearer ${grant}` } });
      if (!response.ok) throw new Error(`context_artifact_download_${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.byteLength !== artifact.size || createHash("sha256").update(body).digest("hex") !== artifact.checksum) throw new Error("context_artifact_integrity_failed");
      chunks.push(JSON.parse(body.toString("utf8")) as SnapshotChunk);
    }
    const revisions = new Set(chunks.map(chunk => chunk.revision));
    if (!revisions.has("base") || !revisions.has("head")) throw new Error("base_head_context_incomplete");
    const untrusted = boundedAnalysisContext(chunks), usage: Array<{ inputTokens: number; outputTokens: number }> = [];
    const records = await runModelReviewChain({ pinned: { headSha: scope.headSha, baseSha: scope.baseSha, configRevision: scope.configRevision }, untrusted,
      invoke: async (stageRequest: ModelStageRequest): Promise<ProviderResult> => {
        const stage = stageRequest.stage as PromptStage, model = stage === "critic" ? criticModel(scope.provider, scope.model) : scope.model;
        const request = { model, system: stageRequest.system, input: stageRequest.input, schemaName: stageRequest.schemaName, schema: stageRequest.schema, maxOutputTokens: stageRequest.maxOutputTokens };
        const body = JSON.stringify({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), stage, credential: scope.credential, request });
        const grant = issueModelInvocationGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), credentialScopeId: scope.credential.id,
          provider: scope.provider, model, stage, requestHash: createHash("sha256").update(body).digest("hex") }, modelSecret);
        const response = await fetch(`${brokerUrl}/api/model`, { method: "POST", headers: { authorization: `Bearer ${grant}`, "content-type": "application/json" }, body });
        const output = await response.json() as { result?: ProviderResult; error?: string };
        if (!response.ok || !output.result) throw new Error(output.error ?? `model_stage_${response.status}`);
        return output.result;
      }, onUsage: item => { usage.push({ inputTokens: item.inputTokens, outputTokens: item.outputTokens }); } });
    const outputBody = Buffer.from(JSON.stringify({ version: 1, pinned: { headSha: scope.headSha, baseSha: scope.baseSha, configRevision: scope.configRevision }, coverage: untrusted.coverage, records }));
    if (outputBody.byteLength > 4_000_000) throw new Error("analysis_output_too_large");
    const checksum = createHash("sha256").update(outputBody).digest("hex"), now = Date.now();
    const reserved: { artifactId: Id<"artifacts">; storageKey: string } = await ctx.runMutation(internal.reviewModelData.reserveOutput, { ...args, checksum, size: outputBody.byteLength, now });
    const writeGrant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(reserved.artifactId), storageKey: reserved.storageKey, operation: "write" }, artifactSecret, now);
    const upload = await fetch(`${brokerUrl}/api/artifacts`, { method: "PUT", headers: { authorization: `Bearer ${writeGrant}`, "content-type": "application/octet-stream", "x-buildit-sha256": checksum }, body: outputBody });
    if (!upload.ok) throw new Error(`analysis_artifact_upload_${upload.status}`);
    const inputTokens = usage.reduce((sum, item) => sum + item.inputTokens, 0), outputTokens = usage.reduce((sum, item) => sum + item.outputTokens, 0);
    await ctx.runMutation(internal.reviewModelData.completeAnalysis, { ...args, artifactId: reserved.artifactId, checksum, size: outputBody.byteLength, credentialId: scope.credentialDocumentId, inputTokens, outputTokens, now: Date.now() });
    return { artifactId: String(reserved.artifactId), stages: records.length, inputTokens, outputTokens };
  },
});

"use node";
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { defaultExecutionPlans, type PackageManager } from "@buildit/runner";
import { issueArtifactGrant, issueExecutionGrant } from "@buildit/security";
import { detectPackageManager, revisionFromStorageKey, sha256Json, summarizeExecution, type ExecutionResponse } from "./lib/validationEvidence";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
type Scope = { organizationId: Id<"organizations">; repositoryId: Id<"repositories">; reviewId: Id<"reviews">; headSha: string; baseSha: string; configRevisionId: Id<"configRevisions">; runnerImageVersion: string; expiresAt: number; completedArtifactId?: Id<"artifacts">; contexts: Array<{ id: Id<"artifacts">; storageKey: string; checksum: string; size: number }> };

export const validate = internalAction({
  args: { organizationId: v.id("organizations"), reviewId: v.id("reviews"), expectedHeadSha: v.string(), expectedGeneration: v.number() },
  handler: async (ctx, args): Promise<{ artifactId: string; checks: number; manager: PackageManager; reused: boolean }> => {
    const scope: Scope = await ctx.runQuery(internal.reviewValidationData.validationScope, args);
    if (scope.completedArtifactId) return { artifactId: String(scope.completedArtifactId), checks: 0, manager: "npm", reused: true };
    const brokerUrl = required("BUILDIT_BROKER_URL").replace(/\/$/, ""), artifactSecret = Buffer.from(required("ARTIFACT_GRANT_SECRET"), "base64url"), executionSecret = Buffer.from(required("EXECUTION_GRANT_SECRET"), "base64url");
    const paths = { base: new Set<string>(), head: new Set<string>() };
    const revisions = scope.contexts.map(context => ({ context, revision: revisionFromStorageKey(context.storageKey) }));
    for (const { context, revision } of revisions) {
      const grant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(context.id), storageKey: context.storageKey, operation: "read" }, artifactSecret);
      const response = await fetch(`${brokerUrl}/api/artifacts`, { headers: { authorization: `Bearer ${grant}` } });
      if (!response.ok) throw new Error(`context_artifact_download_${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.byteLength !== context.size || createHash("sha256").update(body).digest("hex") !== context.checksum) throw new Error("context_artifact_integrity_failed");
      const chunk = JSON.parse(body.toString("utf8")) as { revision?: string; snapshot?: { files?: Array<{ path?: string }> } };
      if (chunk.revision !== revision || !Array.isArray(chunk.snapshot?.files)) throw new Error("context_artifact_revision_invalid");
      for (const file of chunk.snapshot.files) if (typeof file.path === "string") paths[revision].add(file.path); else throw new Error("context_artifact_path_invalid");
    }
    const manager = detectPackageManager(paths), { install, checks } = defaultExecutionPlans(manager), runtime = "node24" as const;
    const descriptors = revisions.map(({ context, revision }) => ({ revision, artifactId: String(context.id), storageKey: context.storageKey, checksum: context.checksum, size: context.size,
      readGrant: issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(context.id), storageKey: context.storageKey, operation: "read" }, artifactSecret) }));
    const artifactsHash = sha256Json(descriptors.map(({ readGrant: _, ...item }) => item)), plansHash = sha256Json({ runnerImageVersion: scope.runnerImageVersion, runtime, install, checks });
    const executionGrant = issueExecutionGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), baseSha: scope.baseSha, headSha: scope.headSha, artifactsHash, plansHash, ttlMs: 120_000 }, executionSecret);
    await ctx.runQuery(internal.durableReview.assertActive, args);
    const response = await fetch(`${brokerUrl}/api/execute`, { method: "POST", headers: { authorization: `Bearer ${executionGrant}`, "content-type": "application/json" }, body: JSON.stringify({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), baseSha: scope.baseSha, headSha: scope.headSha, runnerImageVersion: scope.runnerImageVersion, runtime, artifacts: descriptors, install, checks }) });
    const output = await response.json() as ExecutionResponse & { error?: string };
    if (!response.ok) throw new Error(output.error ?? `validation_execution_${response.status}`);
    const summaries = summarizeExecution(output, scope.baseSha, scope.headSha).map(item => ({ ...item, nameHash: createHash("sha256").update(item.planId).digest("hex") }));
    const outputBody = Buffer.from(JSON.stringify({ version: 1, pinned: { baseSha: scope.baseSha, headSha: scope.headSha, configRevisionId: String(scope.configRevisionId), runnerImageVersion: scope.runnerImageVersion }, manager, output }));
    if (outputBody.byteLength > 4_000_000) throw new Error("validation_output_too_large");
    const checksum = createHash("sha256").update(outputBody).digest("hex"), now = Date.now();
    const reserved: { artifactId: Id<"artifacts">; storageKey: string } = await ctx.runMutation(internal.reviewValidationData.reserveOutput, { ...args, checksum, size: outputBody.byteLength, now });
    const writeGrant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(reserved.artifactId), storageKey: reserved.storageKey, operation: "write" }, artifactSecret, now);
    await ctx.runQuery(internal.durableReview.assertActive, args);
    const upload = await fetch(`${brokerUrl}/api/artifacts`, { method: "PUT", headers: { authorization: `Bearer ${writeGrant}`, "content-type": "application/octet-stream", "x-buildit-sha256": checksum }, body: outputBody });
    if (!upload.ok) throw new Error(`validation_artifact_upload_${upload.status}`);
    await ctx.runMutation(internal.reviewValidationData.completeValidation, { ...args, artifactId: reserved.artifactId, checksum, size: outputBody.byteLength, summaries, manager, now: Date.now() });
    return { artifactId: String(reserved.artifactId), checks: summaries.length, manager, reused: false };
  },
});

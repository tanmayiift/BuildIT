"use node";
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { BROKER_REQUEST_TIMEOUT_MS, defaultExecutionPlans, type PackageManager } from "@buildit/runner";
import { issueArtifactGrant, issueExecutionGrant } from "@buildit/security";
import { detectPackageManager, pairExecutionEvidence, revisionFromStorageKey, sha256Json, type ExecutionResponse } from "./lib/validationEvidence";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
type Scope = { organizationId: Id<"organizations">; repositoryId: Id<"repositories">; reviewId: Id<"reviews">; headSha: string; baseSha: string; configRevisionId: Id<"configRevisions">; runnerImageVersion: string; expiresAt: number; completedArtifactId?: Id<"artifacts">; contexts: Array<{ id: Id<"artifacts">; storageKey: string; checksum: string; size: number }> };

export const validate = internalAction({
  args: { organizationId: v.id("organizations"), reviewId: v.id("reviews"), expectedHeadSha: v.string(), expectedGeneration: v.number() },
  handler: async (ctx, args): Promise<{ artifactId: string; checks: number; manager: PackageManager | "none"; reused: boolean }> => {
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
    const manager = detectPackageManager(paths), plans = manager ? defaultExecutionPlans(manager) : { install: undefined, checks: [] }, { install, checks } = plans, runtime = "node24" as const;
    const descriptors = revisions.map(({ context, revision }) => ({ revision, artifactId: String(context.id), storageKey: context.storageKey, checksum: context.checksum, size: context.size,
      readGrant: issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(context.id), storageKey: context.storageKey, operation: "read" }, artifactSecret) }));
    const artifactsHash = sha256Json(descriptors.map(({ readGrant: _, ...item }) => item)), plansHash = sha256Json({ runnerImageVersion: scope.runnerImageVersion, runtime, install, checks });
    const executionGrant = issueExecutionGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), baseSha: scope.baseSha, headSha: scope.headSha, artifactsHash, plansHash, ttlMs: 120_000 }, executionSecret);
    await ctx.runQuery(internal.durableReview.assertActive, args);
    const response = await fetch(`${brokerUrl}/api/execute`, { method: "POST", headers: { authorization: `Bearer ${executionGrant}`, "content-type": "application/json" }, body: JSON.stringify({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), baseSha: scope.baseSha, headSha: scope.headSha, runnerImageVersion: scope.runnerImageVersion, runtime, artifacts: descriptors, install, checks }), signal: AbortSignal.timeout(BROKER_REQUEST_TIMEOUT_MS) });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      let code: string | undefined;
      try { code = (JSON.parse(detail) as { error?: string }).error; } catch { code = undefined; }
      throw new Error(code ?? `validation_execution_${response.status}`);
    }
    const output = await response.json() as ExecutionResponse & { error?: string };
    const environment = { configRevision: String(scope.configRevisionId), runnerImage: scope.runnerImageVersion, runtime, manager: manager ?? "none" as const, architecture: "linux-x64", networkPolicy: "deny-all-v1", toolVersions: [{ name: "node", version: "24" }, { name: "package-manager", version: manager ?? "none" }], install, checks }, paired = pairExecutionEvidence(output, scope.baseSha, scope.headSha, environment), summaries = paired.summaries.map(item => ({ ...item, nameHash: createHash("sha256").update(item.planId).digest("hex") }));
    // pairExecutionEvidence reclassifies a check that failed and then passed on rerun as "flaky",
    // and that reclassification only ever reached the checkRuns table. reportChecks reads the raw
    // broker results back out of this artifact, so it still saw "failed" - and a single review
    // could publish a neutral check run titled "Review needs attention" whose own body opened with
    // "## Changes need review". That is the pre-existing-failure contradiction again, on a
    // different input, because the fix then was to teach one of the two derivations a rule rather
    // than to stop deriving it twice.
    //
    // The artifact keeps the broker's shape - reportChecks needs `outputs` and `scanners` from it -
    // and only the conclusions are replaced, taken from the same paired evidence checkRuns is built
    // from. One reconciliation, both readers.
    const pairedConclusions = new Map(paired.summaries.map(item => [`${item.revision}:${item.planId}`, item.conclusion]));
    const withPairedConclusions = (revision: "base" | "head", side: typeof output.head) => ({
      ...side,
      results: side.results.map(item => ({ ...item, conclusion: pairedConclusions.get(`${revision}:${item.planId}`) ?? item.conclusion })),
    });
    const reconciledOutput = { ...output, base: withPairedConclusions("base", output.base), head: withPairedConclusions("head", output.head) };
    const outputBody = Buffer.from(JSON.stringify({ version: 1, pinned: { baseSha: scope.baseSha, headSha: scope.headSha, configRevisionId: String(scope.configRevisionId), runnerImageVersion: scope.runnerImageVersion }, manager: manager ?? "none", executionFingerprint: paired.executionFingerprint, output: reconciledOutput }));
    if (outputBody.byteLength > 4_000_000) throw new Error("validation_output_too_large");
    const checksum = createHash("sha256").update(outputBody).digest("hex"), now = Date.now();
    const reserved: { artifactId: Id<"artifacts">; storageKey: string } = await ctx.runMutation(internal.reviewValidationData.reserveOutput, { ...args, checksum, size: outputBody.byteLength, now });
    const writeGrant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(reserved.artifactId), storageKey: reserved.storageKey, operation: "write" }, artifactSecret, now);
    await ctx.runQuery(internal.durableReview.assertActive, args);
    const upload = await fetch(`${brokerUrl}/api/artifacts`, { method: "PUT", headers: { authorization: `Bearer ${writeGrant}`, "content-type": "application/octet-stream", "x-buildit-sha256": checksum }, body: outputBody });
    if (!upload.ok) throw new Error(`validation_artifact_upload_${upload.status}`);
    await ctx.runMutation(internal.reviewValidationData.completeValidation, { ...args, artifactId: reserved.artifactId, checksum, size: outputBody.byteLength, summaries, manager: manager ?? "none" as const, now: Date.now() });
    return { artifactId: String(reserved.artifactId), checks: summaries.length, manager: manager ?? "none", reused: false };
  },
});

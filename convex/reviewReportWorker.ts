"use node";
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { composeVerifiedReport, type ReviewCheckDecision } from "@buildit/orchestrator";
import { redact } from "@buildit/security";
import { issueArtifactGrant } from "@buildit/security";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
type ArtifactRef = { id: Id<"artifacts">; storageKey: string; checksum: string; size: number };
type Scope = { organizationId: Id<"organizations">; repositoryId: Id<"repositories">; reviewId: Id<"reviews">; repository: string; prNumber: number; headSha: string; baseSha: string; configRevision: string; coverage: "complete" | "partial"; coverageGap?: "changed_files" | "diff_truncated" | "requirements"; injectionUnscoped: boolean; environmentAvailable: boolean; isStale: boolean; expiresAt: number; costUsd: number; analysis: ArtifactRef; validation: ArtifactRef; completedArtifactId?: Id<"artifacts"> };
type RunResult = { planId: string; required: boolean; conclusion: ReviewCheckDecision["conclusion"] };
type Validation = { version?: number; manager?: "npm" | "pnpm" | "yarn" | "none"; pinned?: { headSha?: string; baseSha?: string }; output?: { head?: { results?: RunResult[]; outputs?: Array<{ planId: string; text?: string; truncated?: boolean; evidenceTruncated?: boolean }> }; scanners?: { head?: { scanner?: string; complete?: boolean; commitSha?: string; runs?: Array<{ scanner?: string; scannerVersion?: string }>; findings?: Array<{ scanner?: string; severity?: string }> } } } };
type Finding = { title: string; severity: "critical" | "high" | "warning" | "info"; resolution: "accepted" | "rejected" | "uncertain"; blocking: boolean; evidenceIds: string[]; path?: string; startLine?: number; endLine?: number; impact?: string; explanation?: string };
type Analysis = { version?: number; pinned?: { headSha?: string; baseSha?: string }; arbitrated?: Finding[] };

async function download(scope: Scope, artifact: ArtifactRef, brokerUrl: string, secret: Buffer) {
  const grant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(artifact.id), storageKey: artifact.storageKey, operation: "read" }, secret);
  const response = await fetch(`${brokerUrl}/api/artifacts`, { headers: { authorization: `Bearer ${grant}` } });
  if (!response.ok) throw new Error(`report_evidence_download_${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength !== artifact.size || createHash("sha256").update(body).digest("hex") !== artifact.checksum) throw new Error("report_evidence_integrity_failed");
  return body;
}

export function reportChecks(validation: Validation, headSha: string): ReviewCheckDecision[] {
  if (validation.version !== 1 || validation.pinned?.headSha !== headSha || !validation.output?.head) throw new Error("report_validation_pinning_failed");
  const outputs = new Map((validation.output.head.outputs ?? []).map(item => [item.planId, item]));
  const checks = (validation.output.head.results ?? []).map(item => { const output = outputs.get(item.planId); return { name: item.planId, required: item.required, conclusion: item.conclusion, ...(["failed", "timed_out"].includes(item.conclusion) && typeof output?.text === "string" && output.text.trim() ? { excerpt: redact(output.text) } : {}), evidenceComplete: Boolean(output && typeof output.text === "string" && !output.truncated && !output.evidenceTruncated) }; });
  const scanner = validation.output.scanners?.head;
  if (scanner) {
    const names: Record<string, string> = { builditRules: "buildit-rules", gitleaks: "gitleaks", osvScanner: "osv-scanner" };
    const runs = scanner.runs?.length ? scanner.runs : [{ scanner: scanner.scanner ?? "builditRules" }], seen = new Set<string>();
    for (const run of runs) {
      const id = run.scanner, name = id ? names[id] : undefined;
      if (!id || !name || seen.has(id)) throw new Error("report_scanner_inventory_invalid");
      seen.add(id);
      checks.push({ name, required: true, conclusion: scanner.findings?.some(item => (!item.scanner || item.scanner === id) && item.severity === "critical") ? "failed" : "passed", evidenceComplete: scanner.complete === true && scanner.commitSha === headSha });
    }
  }
  return checks;
}

export const compose = internalAction({
  args: { organizationId: v.id("organizations"), reviewId: v.id("reviews"), expectedHeadSha: v.string(), expectedGeneration: v.number() },
  handler: async (ctx, args): Promise<{ artifactId: Id<"artifacts">; reused: boolean }> => {
    const scope: Scope = await ctx.runQuery(internal.reviewReportData.reportScope, args);
    if (scope.completedArtifactId) return { artifactId: scope.completedArtifactId, reused: true };
    const brokerUrl = required("BUILDIT_BROKER_URL").replace(/\/$/, ""), secret = Buffer.from(required("ARTIFACT_GRANT_SECRET"), "base64url");
    const [analysisBody, validationBody] = await Promise.all([download(scope, scope.analysis, brokerUrl, secret), download(scope, scope.validation, brokerUrl, secret)]);
    const analysis = JSON.parse(analysisBody.toString("utf8")) as Analysis, validation = JSON.parse(validationBody.toString("utf8")) as Validation;
    if (analysis.version !== 1 || analysis.pinned?.headSha !== scope.headSha || analysis.pinned?.baseSha !== scope.baseSha || !Array.isArray(analysis.arbitrated)) throw new Error("report_analysis_pinning_failed");
    const body = Buffer.from(composeVerifiedReport({ ...(validation.manager ? { ecosystem: validation.manager } : {}), repository: scope.repository, prNumber: scope.prNumber, headSha: scope.headSha, baseSha: scope.baseSha, configRevision: scope.configRevision,
      coverage: scope.coverage, ...(scope.coverageGap ? { coverageGap: scope.coverageGap } : {}), injectionUnscoped: scope.injectionUnscoped, checks: reportChecks(validation, scope.headSha), findings: analysis.arbitrated, claims: [], evidence: [], environmentAvailable: scope.environmentAvailable, isStale: scope.isStale,
      costUsd: scope.costUsd, retentionExpiresAt: scope.expiresAt }).body, "utf8");
    if (body.byteLength > 60_000) throw new Error("report_output_too_large");
    const checksum = createHash("sha256").update(body).digest("hex"), now = Date.now();
    const reserved: { artifactId: Id<"artifacts">; storageKey: string } = await ctx.runMutation(internal.reviewReportData.reserveOutput, { ...args, checksum, size: body.byteLength, now });
    const grant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(reserved.artifactId), storageKey: reserved.storageKey, operation: "write" }, secret, now);
    await ctx.runQuery(internal.durableReview.assertActive, args);
    const upload = await fetch(`${brokerUrl}/api/artifacts`, { method: "PUT", headers: { authorization: `Bearer ${grant}`, "content-type": "text/markdown", "x-buildit-sha256": checksum }, body });
    if (!upload.ok) throw new Error(`report_artifact_upload_${upload.status}`);
    await ctx.runMutation(internal.reviewReportData.completeOutput, { ...args, artifactId: reserved.artifactId, checksum, size: body.byteLength });
    return { artifactId: reserved.artifactId, reused: false };
  },
});

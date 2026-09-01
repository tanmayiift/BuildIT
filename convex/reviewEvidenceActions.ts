"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { issueArtifactGrant } from "@buildit/security";

type FindingDetail = {
  id: string;
  title: string;
  category: string;
  severity: string;
  confidence: number;
  path: string;
  startLine: number;
  endLine: number;
  impact: string;
  explanation: string;
  resolution: "accepted" | "uncertain";
  blocking: boolean;
};
type Scope = {
  organizationId: Id<"organizations">;
  repositoryId: Id<"repositories">;
  reviewId: Id<"reviews">;
  headSha: string;
  baseSha: string;
  artifact: { id: Id<"artifacts">; storageKey: string; checksum: string; size: number };
};

const categories = new Set(["correctness", "security", "requirement", "architecture", "quality", "dependency", "test"]);
const severities = new Set(["critical", "high", "warning", "info"]);
const resolutions = new Set(["accepted", "uncertain"]);
const text = (value: unknown, maximum: number) => typeof value === "string" ? value.trim().slice(0, maximum) : "";

export function findingDetailsFromAnalysis(value: unknown, pinned: { headSha: string; baseSha: string }): FindingDetail[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("finding_detail_artifact_invalid");
  const analysis = value as { version?: unknown; pinned?: { headSha?: unknown; baseSha?: unknown }; arbitrated?: unknown };
  if (analysis.version !== 1 || analysis.pinned?.headSha !== pinned.headSha || analysis.pinned?.baseSha !== pinned.baseSha) throw new Error("finding_detail_pinning_failed");
  if (!Array.isArray(analysis.arbitrated)) throw new Error("finding_detail_artifact_invalid");
  return analysis.arbitrated.slice(0, 100).flatMap((raw): FindingDetail[] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>, id = text(item.id, 200), title = text(item.title, 500), category = text(item.category, 40), severity = text(item.severity, 20), path = text(item.path, 500), impact = text(item.impact, 2_000), explanation = text(item.explanation, 2_000), resolution = text(item.resolution, 20);
    const confidence = item.confidence, startLine = item.startLine, endLine = item.endLine;
    if (!id || !title || !impact || !explanation || !categories.has(category) || !severities.has(severity) || !resolutions.has(resolution) || typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1 || !path || !Number.isInteger(startLine) || Number(startLine) < 1 || !Number.isInteger(endLine) || Number(endLine) < Number(startLine) || typeof item.blocking !== "boolean") return [];
    return [{ id, title, category, severity, confidence, path, startLine: Number(startLine), endLine: Number(endLine), impact, explanation, resolution: resolution as FindingDetail["resolution"], blocking: item.blocking }];
  });
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

export const getFindingDetails = action({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args): Promise<FindingDetail[]> => {
    const scope: Scope = await ctx.runQuery(internal.reviewEvidenceData.findingDetailScope, args);
    const secret = Buffer.from(required("ARTIFACT_GRANT_SECRET"), "base64url"), broker = required("BUILDIT_BROKER_URL").replace(/\/$/, "");
    const grant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(scope.artifact.id), storageKey: scope.artifact.storageKey, operation: "read" }, secret);
    const response = await fetch(`${broker}/api/artifacts`, { headers: { authorization: `Bearer ${grant}` } });
    if (!response.ok) throw new Error(`finding_detail_download_${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength !== scope.artifact.size || createHash("sha256").update(body).digest("hex") !== scope.artifact.checksum) throw new Error("finding_detail_integrity_failed");
    return findingDetailsFromAnalysis(JSON.parse(body.toString("utf8")), { headSha: scope.headSha, baseSha: scope.baseSha });
  },
});

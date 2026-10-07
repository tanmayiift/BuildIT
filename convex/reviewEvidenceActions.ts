"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { decodeContextArtifact } from "@buildit/runner";
import { issueArtifactGrant, redact } from "@buildit/security";

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

type ArtifactRef = { id: Id<"artifacts">; storageKey: string; checksum: string; size: number };
type ReviewRef = { organizationId: Id<"organizations">; repositoryId: Id<"repositories">; reviewId: Id<"reviews"> };

// One read-grant per artifact, and the bytes checked against the row before anything parses them.
async function downloadArtifact(scope: ReviewRef, artifact: ArtifactRef) {
  const secret = Buffer.from(required("ARTIFACT_GRANT_SECRET"), "base64url"), broker = required("BUILDIT_BROKER_URL").replace(/\/$/, "");
  const grant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(artifact.id), storageKey: artifact.storageKey, operation: "read" }, secret);
  const response = await fetch(`${broker}/api/artifacts`, { headers: { authorization: `Bearer ${grant}` } });
  if (!response.ok) throw new Error(`finding_detail_download_${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength !== artifact.size || createHash("sha256").update(body).digest("hex") !== artifact.checksum) throw new Error("finding_detail_integrity_failed");
  return body;
}

export const getFindingDetails = action({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args): Promise<FindingDetail[]> => {
    const scope: Scope = await ctx.runQuery(internal.reviewEvidenceData.findingDetailScope, args);
    const body = await downloadArtifact(scope, scope.artifact);
    return findingDetailsFromAnalysis(JSON.parse(body.toString("utf8")), { headSha: scope.headSha, baseSha: scope.baseSha });
  },
});

// The review page said "No source was shown" and meant it: a finding named a file and a line range,
// and the reader had to go and find them. These are the lines, from the commit the review pinned.
export type CitedLine = { number: number; text: string; cited: boolean };
export type FindingExcerpt = { findingId: string; path: string; lines: CitedLine[]; clipped: boolean } | { findingId: string; path: string; withheld: "secret" | "unavailable" };
export type CheckTail = { planId: string; lines: string[]; truncated: boolean };
export type ReviewEvidenceView = { state: "erased"; erasedAt: number } | { state: "unavailable" } | { state: "shown"; excerpts: FindingExcerpt[]; checks: CheckTail[] };

const contextLines = 3, maxExcerptLines = 40, maxLineCharacters = 240, checkTailLines = 30;
const clip = (line: string) => line.length > maxLineCharacters ? `${line.slice(0, maxLineCharacters - 1)}…` : line;

// The cited range with three lines either side, at most 40 lines, each at most 240 characters.
// Redacted line by line and as a block: a secret spanning lines is invisible to the first, and an
// excerpt the two disagree on is withheld whole rather than shown with part of a key in it.
export function citedExcerpt(content: string, startLine: number, endLine: number): { lines: CitedLine[]; clipped: boolean } | "secret" | undefined {
  const all = content.split("\n");
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine > all.length) return undefined;
  const from = Math.max(1, startLine - contextLines), wanted = Math.min(all.length, endLine + contextLines);
  const to = Math.min(wanted, from + maxExcerptLines - 1);
  const raw = all.slice(from - 1, to), lines = raw.map(line => redact(line));
  if (redact(raw.join("\n")) !== lines.join("\n")) return "secret";
  return { lines: lines.map((text, index) => ({ number: from + index, text: clip(text), cited: from + index >= startLine && from + index <= endLine })), clipped: to < wanted };
}

// The last 30 lines of each check that failed on the head commit: where a test runner prints the
// failure. From the validation evidence analysis.json already holds, so nothing new is stored.
export function failedCheckTails(validation: unknown): CheckTail[] {
  const head = (validation as { head?: { results?: unknown; outputs?: unknown } } | undefined)?.head;
  const results = Array.isArray(head?.results) ? head.results as Array<{ planId?: unknown; conclusion?: unknown }> : [];
  const outputs = Array.isArray(head?.outputs) ? head.outputs as Array<{ planId?: unknown; text?: unknown; truncated?: unknown }> : [];
  const failed = new Set(results.filter(row => row?.conclusion === "failed" || row?.conclusion === "timed_out").map(row => row.planId).filter((id): id is string => typeof id === "string"));
  return outputs.filter(item => typeof item.planId === "string" && failed.has(item.planId) && typeof item.text === "string").slice(0, 10).map(item => {
    const lines = redact(item.text as string).replace(/\s+$/, "").split("\n");
    return { planId: item.planId as string, lines: lines.slice(-checkTailLines).map(clip), truncated: lines.length > checkTailLines || item.truncated === true };
  });
}

type SnapshotFile = { path?: unknown; content?: unknown };
export function reviewEvidenceView(analysisValue: unknown, headChunks: readonly unknown[], pinned: { headSha: string; baseSha: string }): ReviewEvidenceView {
  const findings = findingDetailsFromAnalysis(analysisValue, pinned);
  const files = new Map<string, string>();
  for (const chunk of headChunks) {
    const value = chunk as { revision?: unknown; snapshot?: { files?: unknown } };
    // Only the commit under review: the base snapshot is a different file at the same path.
    if (value?.revision !== "head" || !Array.isArray(value.snapshot?.files)) throw new Error("finding_evidence_snapshot_invalid");
    for (const file of value.snapshot.files as SnapshotFile[]) if (typeof file.path === "string" && typeof file.content === "string") files.set(file.path, file.content);
  }
  const excerpts = findings.map((finding): FindingExcerpt => {
    const content = files.get(finding.path), excerpt = content === undefined ? undefined : citedExcerpt(content, finding.startLine, finding.endLine);
    if (excerpt === "secret") return { findingId: finding.id, path: finding.path, withheld: "secret" };
    return excerpt ? { findingId: finding.id, path: finding.path, ...excerpt } : { findingId: finding.id, path: finding.path, withheld: "unavailable" };
  });
  return { state: "shown", excerpts, checks: failedCheckTails((analysisValue as { validation?: unknown }).validation) };
}

type EvidenceScope = { state: "erased"; erasedAt: number } | { state: "unavailable" } | (ReviewRef & { state: "available"; headSha: string; baseSha: string; analysis: ArtifactRef; heads: ArtifactRef[] });

export const getFindingEvidence = action({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args): Promise<ReviewEvidenceView> => {
    const scope: EvidenceScope = await ctx.runQuery(internal.reviewEvidenceData.findingEvidenceScope, args);
    if (scope.state !== "available") return scope;
    const [analysis, ...heads] = await Promise.all([scope.analysis, ...scope.heads].map(artifact => downloadArtifact(scope, artifact)));
    return reviewEvidenceView(JSON.parse(analysis!.toString("utf8")), heads.map(body => decodeContextArtifact(body)), { headSha: scope.headSha, baseSha: scope.baseSha });
  },
});

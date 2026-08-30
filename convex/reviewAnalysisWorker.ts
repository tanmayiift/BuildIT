"use node";
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { arbitrateFindings, runModelReviewChain, validateFindingCandidates, type CriticDecision, type EvidenceRecord, type FindingCandidate, type ModelStageRequest, type PromptStage } from "@buildit/orchestrator";
import type { ProviderName, ProviderResult } from "@buildit/providers";
import { fingerprint, issueArtifactGrant, issueModelInvocationGrant, redact } from "@buildit/security";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
type SnapshotChunk = { artifactId?: Id<"artifacts">; revision?: "base" | "head"; pull?: { title: string; body: string; files: Array<{ path: string; patch?: string; status: string }>; omitted: unknown[]; urlHash: string }; snapshot: { files: Array<{ path: string; content: string; size: number }>; omitted: unknown[]; coverage: string } };
type AnalysisScope = { organizationId: Id<"organizations">; repositoryId: Id<"repositories">; reviewId: Id<"reviews">; headSha: string; baseSha: string; configRevision: string; provider: ProviderName; model: string;
  credential: { id: string; organizationId: string; repositoryId?: string; provider: ProviderName; ciphertext: string; nonce: string; tag: string; wrappedDataKey: string; kmsKeyId: string; envelopeVersion: 1; keyVersion: number; aadDigest: string; maskedSuffix: string; status: "valid"; createdBy: string; createdAt: number; lastValidatedAt: number };
  credentialDocumentId: Id<"providerCredentials">; artifacts: Array<{ id: Id<"artifacts">; storageKey: string; checksum: string; size: number }>;
  validationArtifact: { id: Id<"artifacts">; storageKey: string; checksum: string; size: number } };

type ValidationArtifact = { version?: number; pinned?: { headSha?: string; baseSha?: string }; manager?: string; output?: { base?: { results?: unknown[]; outputs?: Array<{ planId?: string; text?: string; truncated?: boolean; evidenceTruncated?: boolean }> }; head?: { results?: unknown[]; outputs?: Array<{ planId?: string; text?: string; truncated?: boolean; evidenceTruncated?: boolean }> }; scanners?: unknown } };

function sourceEvidence(path: string, content: string) { const contentHash = createHash("sha256").update(content).digest("hex"); return { evidenceId: `source-${createHash("sha256").update(`${path}\0${contentHash}`).digest("hex").slice(0, 24)}`, path, contentHash, startLine: 1, endLine: Math.max(1, content.split("\n").length) }; }

export function redactModelOutput<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map(redactModelOutput) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactModelOutput(item)])) as T;
  return value;
}

export function boundedValidationEvidence(value: ValidationArtifact, pinned: { headSha: string; baseSha: string }, maxOutputBytes = 60_000) {
  if (value.version !== 1 || value.pinned?.headSha !== pinned.headSha || value.pinned?.baseSha !== pinned.baseSha || !value.output?.base || !value.output.head) throw new Error("validation_evidence_pinning_failed");
  let remaining = maxOutputBytes;
  const run = (input: NonNullable<ValidationArtifact["output"]>["base"]) => ({ results: input?.results ?? [], outputs: (input?.outputs ?? []).map(item => {
    const raw = typeof item.text === "string" ? redact(item.text) : "", text = raw.slice(0, Math.max(0, remaining)); remaining -= Buffer.byteLength(text);
    return { planId: item.planId, text, truncated: Boolean(item.truncated || item.evidenceTruncated || text.length !== raw.length) };
  }) });
  return { manager: value.manager, base: run(value.output.base), head: run(value.output.head), scanners: value.output.scanners };
}

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
  const changed = new Set(changes.map(file => file.path)), files: Array<{ evidenceId: string; path: string; content: string; startLine: number; endLine: number; contentHash: string }> = [], excluded: string[] = [];
  const base = { pull: { title: pull.title, body, bodyTruncated, changes, urlHash: pull.urlHash }, files, exclusions: { paths: excluded, patchPaths, source: headChunks.flatMap(chunk => chunk.snapshot.omitted), pull: pull.omitted } };
  let bytes = Buffer.byteLength(JSON.stringify(base));
  for (const file of headChunks.flatMap(chunk => chunk.snapshot.files).sort((a, b) => Number(changed.has(b.path)) - Number(changed.has(a.path)) || a.path.localeCompare(b.path))) {
    const evidence = sourceEvidence(file.path, file.content), item = { ...evidence, content: file.content }, size = Buffer.byteLength(JSON.stringify(item));
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
      chunks.push({ ...(JSON.parse(body.toString("utf8")) as SnapshotChunk), artifactId: artifact.id });
    }
    const revisions = new Set(chunks.map(chunk => chunk.revision));
    if (!revisions.has("base") || !revisions.has("head")) throw new Error("base_head_context_incomplete");
    const validation = scope.validationArtifact, validationGrant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(validation.id), storageKey: validation.storageKey, operation: "read" }, artifactSecret);
    const validationResponse = await fetch(`${brokerUrl}/api/artifacts`, { headers: { authorization: `Bearer ${validationGrant}` } });
    if (!validationResponse.ok) throw new Error(`validation_artifact_download_${validationResponse.status}`);
    const validationBody = Buffer.from(await validationResponse.arrayBuffer());
    if (validationBody.byteLength !== validation.size || createHash("sha256").update(validationBody).digest("hex") !== validation.checksum) throw new Error("validation_artifact_integrity_failed");
    const validationValue = JSON.parse(validationBody.toString("utf8")) as ValidationArtifact;
    const untrusted = { ...boundedAnalysisContext(chunks), validation: boundedValidationEvidence(validationValue, { headSha: scope.headSha, baseSha: scope.baseSha }) }, usage: Array<{ inputTokens: number; outputTokens: number }> = [];
    const records = redactModelOutput(await runModelReviewChain({ pinned: { headSha: scope.headSha, baseSha: scope.baseSha, configRevision: scope.configRevision }, untrusted,
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
      }, onUsage: item => { usage.push({ inputTokens: item.inputTokens, outputTokens: item.outputTokens }); } }));
    const headEvidence = new Map<string, { record: EvidenceRecord; artifactId: Id<"artifacts"> }>();
    for (const chunk of chunks.filter(item => item.revision === "head")) for (const file of chunk.snapshot.files) {
      if (!chunk.artifactId) throw new Error("context_artifact_reference_missing");
      const item = sourceEvidence(file.path, file.content);
      headEvidence.set(item.evidenceId, { artifactId: chunk.artifactId, record: { id: item.evidenceId, artifactExists: true, commitSha: scope.headSha, path: item.path, pathExists: true, startLine: item.startLine, endLine: item.endLine, contentHash: item.contentHash, lineHashMatches: true, truncated: false } });
    }
    const stage = (name: PromptStage) => records.find(item => item.stage === name)?.value ?? {};
    const requirements = ((stage("requirements").requirements ?? []) as Array<{ id: string; status: "resolved" | "missing" | "inaccessible" | "conflicting" | "excluded"; confidence: number }>).filter(item => item && typeof item.id === "string" && Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1);
    const modelFindings = ((stage("findings").findings ?? []) as FindingCandidate[]).map(item => ({ ...item, origin: "model" as const }));
    const critic = ((stage("critic").decisions ?? []) as CriticDecision[]);
    const scannerHead = (validationValue.output?.scanners as { head?: { findings?: Array<{ ruleId?: string; severity?: "critical" | "warning" | "info"; path?: string; startLine?: number; endLine?: number; summary?: string }> } } | undefined)?.head?.findings ?? [];
    const scannerFindings: FindingCandidate[] = scannerHead.flatMap((item, index) => {
      if (!item.path || !item.ruleId || !item.severity || !Number.isInteger(item.startLine) || !Number.isInteger(item.endLine)) return [];
      const evidence = [...headEvidence.values()].find(value => value.record.path === item.path);
      if (!evidence) return [];
      return [{ id: `scanner-${index}-${item.ruleId}`, title: item.summary ?? item.ruleId, category: "security", severity: item.severity, confidence: 1, path: item.path, startLine: item.startLine!, endLine: item.endLine!, evidenceIds: [evidence.record.id], impact: item.summary ?? "Deterministic scanner finding", explanation: `${item.ruleId} was detected by the pinned BuildIT scanner.`, origin: "scanner" as const }];
    });
    const candidates = validateFindingCandidates({ findings: [...modelFindings, ...scannerFindings], criteriaIds: new Set(requirements.map(item => item.id)), allowedPaths: new Set([...headEvidence.values()].flatMap(item => item.record.path ? [item.record.path] : [])), evidence: [...headEvidence.values()].map(item => item.record), pinnedCommit: scope.headSha });
    const arbitrated = arbitrateFindings(candidates, critic), fingerprintKey = Buffer.from(required("FINDING_FINGERPRINT_SECRET"), "base64url");
    if (fingerprintKey.byteLength < 32) throw new Error("finding_fingerprint_secret_invalid");
    const outputBody = Buffer.from(JSON.stringify({ version: 1, pinned: { headSha: scope.headSha, baseSha: scope.baseSha, configRevision: scope.configRevision }, coverage: untrusted.coverage, records, arbitrated }));
    if (outputBody.byteLength > 4_000_000) throw new Error("analysis_output_too_large");
    const checksum = createHash("sha256").update(outputBody).digest("hex"), now = Date.now();
    const reserved: { artifactId: Id<"artifacts">; storageKey: string } = await ctx.runMutation(internal.reviewModelData.reserveOutput, { ...args, checksum, size: outputBody.byteLength, now });
    const writeGrant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(reserved.artifactId), storageKey: reserved.storageKey, operation: "write" }, artifactSecret, now);
    const upload = await fetch(`${brokerUrl}/api/artifacts`, { method: "PUT", headers: { authorization: `Bearer ${writeGrant}`, "content-type": "application/octet-stream", "x-buildit-sha256": checksum }, body: outputBody });
    if (!upload.ok) throw new Error(`analysis_artifact_upload_${upload.status}`);
    const inputTokens = usage.reduce((sum, item) => sum + item.inputTokens, 0), outputTokens = usage.reduce((sum, item) => sum + item.outputTokens, 0);
    await ctx.runMutation(internal.reviewModelData.completeAnalysis, { ...args, artifactId: reserved.artifactId, checksum, size: outputBody.byteLength, credentialId: scope.credentialDocumentId, inputTokens, outputTokens,
      requirements: requirements.map(item => ({ externalIdHash: fingerprint(item.id, fingerprintKey), status: item.status, confidence: item.confidence, sourceUrlHash: untrusted.pull.urlHash })),
      findings: arbitrated.filter(item => item.resolution !== "rejected").map(item => ({ fingerprintHmac: fingerprint(`${item.id}\0${item.path}\0${item.startLine}\0${item.endLine}`, fingerprintKey), pathHmac: fingerprint(item.path, fingerprintKey),
        category: item.category as "correctness" | "security" | "requirement" | "architecture" | "quality" | "dependency" | "test", severity: item.severity, confidence: item.confidence, blocking: item.blocking,
        evidenceIds: item.evidenceIds.map(id => headEvidence.get(id)!.artifactId), startLine: item.startLine, endLine: item.endLine, ...(item.origin === "scanner" ? { ruleId: item.id.split("-").slice(2).join("-") } : {}),
        ...(item.criterionId ? { requirementExternalIdHash: fingerprint(item.criterionId, fingerprintKey) } : {}), resolution: item.resolution === "accepted" ? "open" as const : "uncertain" as const })), now: Date.now() });
    return { artifactId: String(reserved.artifactId), stages: records.length, inputTokens, outputTokens };
  },
});

"use node";
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { arbitrateFindings, type ArbitrationDecision, type CriticDecision, dedupeSameDefect, type EvidenceRecord, type FindingCandidate, type ModelStageRequest, normalizeFindingCriteria, type PromptStage, reconcileArbitration, runModelReviewChain, validateFindingCandidates } from "@buildit/orchestrator";
import { approvedProviderModels, type ProviderName, type ProviderResult } from "@buildit/providers";
import { fingerprint, issueArtifactGrant, issueModelInvocationGrant, redact, redactForModel } from "@buildit/security";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
type RequirementSourceType = "pull_request" | "github_issue" | "linear" | "jira" | "repository_document" | "test";
type SnapshotChunk = { artifactId?: Id<"artifacts">; revision?: "base" | "head"; pull?: { title: string; body: string; files: Array<{ path: string; patch?: string; status: string }>; omitted: unknown[]; urlHash: string; requirementCoverage?: "complete" | "partial"; requirementSources?: Array<{ id: string; type: RequirementSourceType; status: string; version: string; urlHash: string; content?: string }>; requirements?: Array<{ id: string; text: string; sourceId: string; line: number; evidenceHash: string; certainty: string }>;requirementConflicts?:Array<{canonical:string;requirementIds:string[];sourceIds:string[]}> }; snapshot: { files: Array<{ path: string; content: string; size: number }>; omitted: unknown[]; coverage: string } };
type AnalysisScope = { organizationId: Id<"organizations">; repositoryId: Id<"repositories">; reviewId: Id<"reviews">; headSha: string; baseSha: string; configRevision: string; provider: ProviderName; model: string;
  credential: { id: string; organizationId: string; repositoryId?: string; provider: ProviderName; ciphertext: string; nonce: string; tag: string; wrappedDataKey: string; kmsKeyId: string; envelopeVersion: 1; keyVersion: number; aadDigest: string; maskedSuffix: string; availableModels: string[]; status: "valid"; createdBy: string; createdAt: number; lastValidatedAt: number };
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

// Drops whole array elements from the end until the value fits the remaining budget. Truncating
// mid-JSON would hand the model a malformed structure; dropping elements keeps it valid and the
// truncated flag tells the model the sample is incomplete.
export function boundJson<T>(value: T, budget: number): { value: T | undefined; truncated: boolean } {
  const size = (item: unknown) => Buffer.byteLength(JSON.stringify(item) ?? "");
  if (value === undefined) return { value: undefined, truncated: false };
  if (size(value) <= budget) return { value, truncated: false };
  if (Array.isArray(value)) {
    const kept: unknown[] = [];
    for (const item of value) {
      if (size([...kept, item]) > budget) return { value: kept as T, truncated: true };
      kept.push(item);
    }
    return { value: kept as T, truncated: true };
  }
  if (value && typeof value === "object") {
    const bounded = Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, boundJson(item, Math.max(0, Math.floor(budget / Math.max(1, Object.keys(value as object).length)))).value]));
    return { value: bounded as T, truncated: true };
  }
  return { value: undefined, truncated: true };
}

export function boundedValidationEvidence(value: ValidationArtifact, pinned: { headSha: string; baseSha: string }, maxOutputBytes = 60_000) {
  if (value.version !== 1 || value.pinned?.headSha !== pinned.headSha || value.pinned?.baseSha !== pinned.baseSha || !value.output?.base || !value.output.head) throw new Error("validation_evidence_pinning_failed");
  let remaining = maxOutputBytes;
  const run = (input: NonNullable<ValidationArtifact["output"]>["base"]) => ({ results: boundJson(input?.results ?? [], Math.max(0, remaining)).value ?? [], outputs: (input?.outputs ?? []).map(item => {
    const raw = typeof item.text === "string" ? redact(item.text) : "", text = raw.slice(0, Math.max(0, remaining)); remaining -= Buffer.byteLength(text);
    return { planId: item.planId, text, truncated: Boolean(item.truncated || item.evidenceTruncated || text.length !== raw.length) };
  }) });
  const boundedScanners = boundJson(value.output.scanners, Math.max(0, remaining));
  return { manager: value.manager, base: run(value.output.base), head: run(value.output.head),
    scanners: boundedScanners.value, scannersTruncated: boundedScanners.truncated };
}

export function boundedAnalysisContext(chunks: SnapshotChunk[], maxBytes = 80_000) {
  const headChunks = chunks.filter(chunk => chunk.revision !== "base"), pull = headChunks.find(chunk => chunk.pull)?.pull;
  if (!pull) throw new Error("pull_request_context_missing");
  type ModelSource = NonNullable<NonNullable<SnapshotChunk["pull"]>["requirementSources"]>[number] & { content?: string };
  type ModelRequirement = NonNullable<NonNullable<SnapshotChunk["pull"]>["requirements"]>[number] & { textTruncated?: boolean };
  type ModelConflict = NonNullable<NonNullable<SnapshotChunk["pull"]>["requirementConflicts"]>[number] & { canonicalTruncated?: boolean };
  type OmissionSample = { path?: string; reason: string };
  type OmissionKind = "repositoryFiles" | "patches" | "changedFiles" | "sourceOmissions" | "pullOmissions" | "requirementSources" | "requirements" | "requirementConflicts" | "truncatedTexts";
  const changes: Array<{ path: string; status: string; patch?: string }> = [];
  const requirementSources: ModelSource[] = [], requirements: ModelRequirement[] = [], requirementConflicts: ModelConflict[] = [];
  const files: Array<{ evidenceId: string; path: string; content: string; startLine: number; endLine: number; contentHash: string }> = [];
  const exclusions = { paths: [] as string[], patchPaths: [] as string[], changedPaths: [] as string[], source: [] as OmissionSample[], pull: [] as OmissionSample[],
    totals: {} as Partial<Record<OmissionKind, number>> };
  const base = { pull: { title: "", titleTruncated: false, body: "", bodyTruncated: false, changes, urlHash: pull.urlHash,
    requirementCoverage: pull.requirementCoverage ?? "partial", requirementSources, requirements, requirementConflicts }, files, exclusions, coverage: "partial" as "full" | "partial" };
  const size = () => Buffer.byteLength(JSON.stringify(base));
  if (size() > maxBytes) throw new Error("analysis_context_budget_too_small");
  const baseCeiling = Math.max(size(), Math.floor(maxBytes * 0.7));
  const pushWithin = <T>(target: T[], item: T, ceiling = baseCeiling) => { target.push(item); if (size() <= ceiling) return true; target.pop(); return false; };
  const increment = (kind: OmissionKind, amount = 1) => { exclusions.totals[kind] = (exclusions.totals[kind] ?? 0) + amount; };
  const fitText = (raw: string, maximum: number, assign: (value: string) => void) => {
    let low = 0, high = Math.min(raw.length, maximum);
    while (low < high) { const middle = Math.ceil((low + high) / 2); assign(redactForModel(raw.slice(0, middle))); if (size() <= baseCeiling) low = middle; else high = middle - 1; }
    assign(redactForModel(raw.slice(0, low)));
    return low !== raw.length;
  };
  base.pull.titleTruncated = fitText(pull.title, 500, value => { base.pull.title = value; });
  base.pull.bodyTruncated = fitText(pull.body, 30_000, value => { base.pull.body = value; });
  if (base.pull.titleTruncated) increment("truncatedTexts");
  if (base.pull.bodyTruncated) increment("truncatedTexts");

  let requirementBudget = 20_000;
  for (const source of pull.requirementSources ?? []) {
    const rawContent = source.content?.slice(0, Math.max(0, requirementBudget));
    const contentTruncated = Boolean(source.content && rawContent?.length !== source.content.length);
    const candidate = { ...source, ...(rawContent === undefined ? {} : { content: redactForModel(rawContent) }) } as ModelSource;
    if (pushWithin(requirementSources, candidate)) { requirementBudget -= Buffer.byteLength(rawContent ?? ""); if (contentTruncated) increment("truncatedTexts"); }
    else increment("requirementSources");
  }
  for (const item of pull.requirements ?? []) {
    const rawText = item.text.slice(0, 2_000), textTruncated = rawText.length !== item.text.length;
    if (pushWithin(requirements, { ...item, text: redactForModel(rawText), ...(textTruncated ? { textTruncated: true } : {}) } as ModelRequirement)) { if (textTruncated) increment("truncatedTexts"); }
    else increment("requirements");
  }
  for (const item of pull.requirementConflicts ?? []) {
    const rawCanonical = item.canonical.slice(0, 2_000), canonicalTruncated = rawCanonical.length !== item.canonical.length;
    if (pushWithin(requirementConflicts, { ...item, canonical: redactForModel(rawCanonical), ...(canonicalTruncated ? { canonicalTruncated: true } : {}) } as ModelConflict)) { if (canonicalTruncated) increment("truncatedTexts"); }
    else increment("requirementConflicts");
  }
  for (const file of pull.files) {
    if (!pushWithin(changes, { path: file.path, status: file.status })) {
      increment("changedFiles");
      pushWithin(exclusions.changedPaths, file.path);
    }
  }
  let patchBudget = 30_000;
  const omittedPatches = new Set<string>();
  const omitPatch = (path: string) => { if (omittedPatches.has(path)) return; omittedPatches.add(path); increment("patches"); pushWithin(exclusions.patchPaths, path); };
  for (const file of pull.files) {
    if (!file.patch) continue;
    const change = changes.find(item => item.path === file.path);
    if (!change) { omitPatch(file.path); continue; }
    const rawPatch = file.patch.slice(0, Math.max(0, patchBudget));
    if (!rawPatch || rawPatch.length !== file.patch.length) omitPatch(file.path);
    if (!rawPatch) continue;
    change.patch = redactForModel(rawPatch);
    if (size() <= baseCeiling) patchBudget -= rawPatch.length;
    else { delete change.patch; omitPatch(file.path); }
  }
  const sampleOmission = (value: unknown): OmissionSample => {
    if (!value || typeof value !== "object") return { reason: "omitted" };
    const item = value as { path?: unknown; reason?: unknown };
    return { ...(typeof item.path === "string" ? { path: redactForModel(item.path.slice(0, 500)) } : {}), reason: typeof item.reason === "string" ? redactForModel(item.reason.slice(0, 100)) : "omitted" };
  };
  const sourceOmissions = headChunks.flatMap(chunk => chunk.snapshot.omitted);
  if (sourceOmissions.length) increment("sourceOmissions", sourceOmissions.length);
  if (pull.omitted.length) increment("pullOmissions", pull.omitted.length);
  for (const item of sourceOmissions) pushWithin(exclusions.source, sampleOmission(item));
  for (const item of pull.omitted) pushWithin(exclusions.pull, sampleOmission(item));

  const changed = new Set(pull.files.map(file => file.path));
  for (const file of headChunks.flatMap(chunk => chunk.snapshot.files).sort((a, b) => Number(changed.has(b.path)) - Number(changed.has(a.path)) || a.path.localeCompare(b.path))) {
    const evidence = sourceEvidence(file.path, file.content), item = { ...evidence, content: redactForModel(file.content) }, size = Buffer.byteLength(JSON.stringify(item));
    if (Buffer.byteLength(JSON.stringify(base)) + size > maxBytes) { increment("repositoryFiles"); pushWithin(exclusions.paths, file.path, maxBytes); continue; }
    files.push(item);
  }
  const excludedAnything = Object.values(exclusions.totals).some(value => value > 0) || pull.requirementCoverage !== "complete" || headChunks.some(chunk => chunk.snapshot.coverage !== "full");
  base.coverage = excludedAnything ? "partial" : "full";
  if (size() > maxBytes) throw new Error("analysis_context_too_large");
  return base;
}
export function selectCriticModel(provider:ProviderName,primary:string,availableModels?:readonly string[]){const preferred=provider==="gemini"?(primary==="gemini-2.5-flash"?"gemini-2.5-pro":"gemini-2.5-flash"):provider==="openai"?(primary==="gpt-5.4-mini"?"gpt-5.4":"gpt-5.4-mini"):(primary==="claude-sonnet-4-5"?"claude-sonnet-4-6":"claude-sonnet-4-5"),available=availableModels?new Set(availableModels):approvedProviderModels[provider],independent=Boolean(availableModels)&&available.has(preferred)&&preferred!==primary;return{model:independent?preferred:primary,independent}}
export function selectFindingsModel(provider: ProviderName, primary: string, availableModels?: readonly string[]) {
  if (provider !== "openai" || primary !== "gpt-5.4-mini" || !availableModels?.includes("gpt-5.4")) return primary;
  return "gpt-5.4";
}
export function requireIndependentCritic(findings:FindingCandidate[],decisions:CriticDecision[],independent:boolean){if(independent)return decisions;const risky=new Set(findings.filter(item=>item.origin==="model"&&["critical","high"].includes(item.severity)).map(item=>item.id));return decisions.map(item=>risky.has(item.findingId)?{...item,verdict:"uncertain" as const,missingEvidenceIds:[...new Set([...item.missingEvidenceIds,"independent-critic-unavailable"])],explanation:"An independent approved critic model was unavailable."}:item)}

type ScannerFindingInput = { scanner?: string; ruleId?: string; fingerprint?: string; severity?: "critical" | "warning" | "info"; path?: string; startLine?: number; endLine?: number; summary?: string };
export function introducedScannerFindings(base: ScannerFindingInput[], head: ScannerFindingInput[]) {
  const key = (item: ScannerFindingInput) => typeof item.fingerprint === "string" && item.fingerprint.length > 0 && typeof item.ruleId === "string" && typeof item.path === "string"
    ? `${item.scanner ?? "unknown"}\0${item.ruleId}\0${item.path}\0${item.fingerprint}` : undefined;
  const remaining = new Map<string, number>();
  for (const item of base) { const value = key(item); if (value) remaining.set(value, (remaining.get(value) ?? 0) + 1); }
  return head.filter(item => { const value = key(item); if (!value) return true; const count = remaining.get(value) ?? 0; if (!count) return true; if (count === 1) remaining.delete(value); else remaining.set(value, count - 1); return false; });
}

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
    const availableModels = scope.credential.availableModels.length ? scope.credential.availableModels : undefined;
    const findingsModel = selectFindingsModel(scope.provider, scope.model, availableModels);
    const criticRoute = selectCriticModel(scope.provider, findingsModel, availableModels);
    const memory = await ctx.runQuery(internal.repositoryMemory.forRepository, { repositoryId: scope.repositoryId });
    const untrusted = { ...boundedAnalysisContext(chunks), validation: boundedValidationEvidence(validationValue, { headSha: scope.headSha, baseSha: scope.baseSha }), memory }, usage: Array<{ inputTokens: number; outputTokens: number }> = [];
    let injectionUnscoped = false;
    const records = redactModelOutput(await runModelReviewChain({ pinned: { headSha: scope.headSha, baseSha: scope.baseSha, configRevision: scope.configRevision }, untrusted,
      onInjection: report => { injectionUnscoped ||= report.scope.unscoped; },
      invoke: async (stageRequest: ModelStageRequest): Promise<ProviderResult> => {
        const stage = stageRequest.stage as PromptStage;
        const model = stage === "findings" ? findingsModel : stage === "critic" ? criticRoute.model : scope.model;
        const request = { model, system: stageRequest.system, input: stageRequest.input, schemaName: stageRequest.schemaName, schema: stageRequest.schema, maxOutputTokens: stageRequest.maxOutputTokens };
        const spend = await ctx.runMutation(internal.reviewModelData.preflightStageSpend,{...args,provider:scope.provider,model,inputBytes:Buffer.byteLength(request.system)+Buffer.byteLength(request.input)+Buffer.byteLength(JSON.stringify(request.schema)),maxOutputTokens:request.maxOutputTokens,now:Date.now()});
        if (!spend.allowed) throw new Error("budget_preflight_exceeded");
        const body = JSON.stringify({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), stage, credential: scope.credential, request });
        const grant = issueModelInvocationGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), credentialScopeId: scope.credential.id,
          provider: scope.provider, model, stage, requestHash: createHash("sha256").update(body).digest("hex") }, modelSecret);
        await ctx.runQuery(internal.durableReview.assertActive, args);
        const response = await fetch(`${brokerUrl}/api/model`, { method: "POST", headers: { authorization: `Bearer ${grant}`, "content-type": "application/json" }, body });
        const output = await response.json() as { result?: ProviderResult; error?: string; providerStatus?: number };
        if (!response.ok || !output.result){const reason=typeof output.providerStatus==="number"?`${output.error??"provider_error"}:http_${output.providerStatus}`:output.error??`http_${response.status}`;await ctx.runMutation(internal.reviewModelData.recordStageRun,{...args,stage,provider:scope.provider,model,promptVersion:`${stage}-v1`,schemaVersion:`${stage}-schema-v1`,finishReason:reason.slice(0,100),requestHash:createHash("sha256").update(stageRequest.system).update("\0").update(stageRequest.input).update("\0").update(JSON.stringify(stageRequest.schema)).digest("hex"),attempt:stageRequest.repairOf===undefined?1:2,outcome:"provider_error",inputTokens:0,outputTokens:0,now:Date.now()});throw new Error(output.error ?? `model_stage_${response.status}`)}
        return output.result;
      }, onUsage: async item => { usage.push({ inputTokens: item.inputTokens, outputTokens: item.outputTokens });await ctx.runMutation(internal.reviewModelData.recordStageRun,{...args,stage:item.stage,provider:item.provider,model:item.model,promptVersion:item.promptVersion,schemaVersion:item.schemaVersion,finishReason:item.finishReason,requestHash:item.requestFingerprint,...(item.requestId?{requestId:item.requestId}:{}),attempt:item.attempt,outcome:item.outcome,inputTokens:item.inputTokens,outputTokens:item.outputTokens,now:Date.now()}); } }));
    const headEvidence = new Map<string, { record: EvidenceRecord; artifactId: Id<"artifacts"> }>();
    for (const chunk of chunks.filter(item => item.revision === "head")) for (const file of chunk.snapshot.files) {
      if (!chunk.artifactId) throw new Error("context_artifact_reference_missing");
      const item = sourceEvidence(file.path, file.content);
      headEvidence.set(item.evidenceId, { artifactId: chunk.artifactId, record: { id: item.evidenceId, artifactExists: true, commitSha: scope.headSha, path: item.path, pathExists: true, startLine: item.startLine, endLine: item.endLine, contentHash: item.contentHash, lineHashMatches: true, truncated: false } });
    }
    const stage = (name: PromptStage) => records.find(item => item.stage === name)?.value ?? {};
    const sourceById = new Map(untrusted.pull.requirementSources.map(source => [source.id, source]));
    const provenanceByRequirementId = new Map(untrusted.pull.requirements.flatMap(requirement => { const source = sourceById.get(requirement.sourceId); return source ? [[requirement.id, source] as const] : []; }));
    const requirements = ((stage("requirements").requirements ?? []) as Array<{ id: string; status: "resolved" | "missing" | "inaccessible" | "conflicting" | "excluded"; confidence: number }>).filter(item => item && typeof item.id === "string" && provenanceByRequirementId.has(item.id) && Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1);
    const criteriaIds = new Set(requirements.map(item => item.id));
    const modelFindings = normalizeFindingCriteria(((stage("findings").findings ?? []) as FindingCandidate[]).map(item => ({ ...item, origin: "model" as const })), criteriaIds);
    const critic = requireIndependentCritic(modelFindings,((stage("critic").decisions ?? []) as CriticDecision[]),criticRoute.independent);
    const scannerRuns = validationValue.output?.scanners as { base?: { findings?: ScannerFindingInput[] }; head?: { findings?: ScannerFindingInput[] } } | undefined;
    const scannerHead = introducedScannerFindings(scannerRuns?.base?.findings ?? [], scannerRuns?.head?.findings ?? []);
    const scannerFindings: FindingCandidate[] = scannerHead.flatMap((item, index) => {
      if (!item.path || !item.ruleId || !item.severity || !Number.isInteger(item.startLine) || !Number.isInteger(item.endLine)) return [];
      const evidence = [...headEvidence.values()].find(value => value.record.path === item.path);
      if (!evidence) return [];
      return [{ id: `scanner-${index}-${item.ruleId}`, title: item.summary ?? item.ruleId, category: "security", severity: item.severity, confidence: 1, path: item.path, startLine: item.startLine!, endLine: item.endLine!, evidenceIds: [evidence.record.id], impact: item.summary ?? "Deterministic scanner finding", explanation: `${item.ruleId} was detected by the pinned BuildIT scanner.`, origin: "scanner" as const }];
    });
    const candidates = validateFindingCandidates({ findings: [...modelFindings, ...scannerFindings], criteriaIds, allowedPaths: new Set([...headEvidence.values()].flatMap(item => item.record.path ? [item.record.path] : [])), evidence: [...headEvidence.values()].map(item => item.record), pinnedCommit: scope.headSha });
    const arbitration = ((stage("arbitration").findings ?? []) as ArbitrationDecision[]), arbitrated = dedupeSameDefect(reconcileArbitration(arbitrateFindings(candidates, critic), arbitration)), fingerprintKey = Buffer.from(required("FINDING_FINGERPRINT_SECRET"), "base64url");
    if (fingerprintKey.byteLength < 32) throw new Error("finding_fingerprint_secret_invalid");
    const outputBody = Buffer.from(JSON.stringify({ version: 1, pinned: { headSha: scope.headSha, baseSha: scope.baseSha, configRevision: scope.configRevision }, coverage: untrusted.coverage, validation: untrusted.validation, records, arbitrated }));
    if (outputBody.byteLength > 4_000_000) throw new Error("analysis_output_too_large");
    const checksum = createHash("sha256").update(outputBody).digest("hex"), now = Date.now();
    const reserved: { artifactId: Id<"artifacts">; storageKey: string } = await ctx.runMutation(internal.reviewModelData.reserveOutput, { ...args, checksum, size: outputBody.byteLength, now });
    const writeGrant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(reserved.artifactId), storageKey: reserved.storageKey, operation: "write" }, artifactSecret, now);
    await ctx.runQuery(internal.durableReview.assertActive, args);
    const upload = await fetch(`${brokerUrl}/api/artifacts`, { method: "PUT", headers: { authorization: `Bearer ${writeGrant}`, "content-type": "application/octet-stream", "x-buildit-sha256": checksum }, body: outputBody });
    if (!upload.ok) throw new Error(`analysis_artifact_upload_${upload.status}`);
    const inputTokens = usage.reduce((sum, item) => sum + item.inputTokens, 0), outputTokens = usage.reduce((sum, item) => sum + item.outputTokens, 0);
    await ctx.runMutation(internal.reviewModelData.completeAnalysis, { ...args, artifactId: reserved.artifactId, checksum, size: outputBody.byteLength, credentialId: scope.credentialDocumentId, inputTokens, outputTokens,
      requirements: requirements.map(item => { const source = provenanceByRequirementId.get(item.id)!; return { externalIdHash: fingerprint(item.id, fingerprintKey), status: item.status, confidence: item.confidence,
        sourceType: source.type, sourceUrlHash: source.urlHash, fetchedVersion: source.version }; }),
      findings: arbitrated.filter(item => item.resolution !== "rejected").map(item => ({ fingerprintHmac: fingerprint(`${item.id}\0${item.path}\0${item.startLine}\0${item.endLine}`, fingerprintKey), pathHmac: fingerprint(item.path, fingerprintKey),
        category: item.category as "correctness" | "security" | "requirement" | "architecture" | "quality" | "dependency" | "test", severity: item.severity, confidence: item.confidence, blocking: item.blocking,
        evidenceIds: item.evidenceIds.map(id => headEvidence.get(id)!.artifactId), startLine: item.startLine, endLine: item.endLine, ...(item.origin === "scanner" ? { ruleId: item.id.split("-").slice(2).join("-") } : {}),
        ...(item.criterionId ? { requirementExternalIdHash: fingerprint(item.criterionId, fingerprintKey) } : {}), resolution: item.resolution === "accepted" ? "open" as const : "uncertain" as const, ...(item.reason === "prompt_injection_detected" ? { injectionSuspected: true } : {}) })), ...(injectionUnscoped ? { injectionUnscoped: true } : {}), now: Date.now() });
    return { artifactId: String(reserved.artifactId), stages: records.length, inputTokens, outputTokens };
  },
});

"use node";
import { isFindingResolutionReason } from "@buildit/contracts";
import { invokeAccountedModel } from "./lib/accountedModel";
import { findingFingerprint } from "./lib/findingFingerprint";
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { runEscalationCritic, arbitrateFindings, hunkWindows, relatedPaths, type ArbitrationDecision, type CriticDecision, dedupeSameDefect, type EvidenceRecord, type FindingCandidate, type ModelStageRequest, normalizeFindingCriteria, type PromptStage, type PromptVariant, reconcileArbitration, runModelReviewChain, type ReviewPlan, type ValidatedStage, validateFindingCandidates } from "@buildit/orchestrator";
import { approvedProviderModels, type ProviderName, type ProviderResult } from "@buildit/providers";
import { fingerprint, issueArtifactGrant, redact, redactForModel } from "@buildit/security";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
type RequirementSourceType = "pull_request" | "github_issue" | "linear" | "jira" | "repository_document" | "test";
type SnapshotChunk = { artifactId?: Id<"artifacts">; revision?: "base" | "head"; pull?: { reviewInstructions?: string[]; title: string; body: string; files: Array<{ path: string; patch?: string; status: string }>; omitted: unknown[]; urlHash: string; requirementCoverage?: "complete" | "partial"; requirementSources?: Array<{ id: string; type: RequirementSourceType; status: string; version: string; urlHash: string; content?: string }>; requirements?: Array<{ id: string; text: string; sourceId: string; line: number; evidenceHash: string; certainty: string }>;requirementConflicts?:Array<{canonical:string;requirementIds:string[];sourceIds:string[]}> }; snapshot: { files: Array<{ path: string; content: string; size: number }>; omitted: unknown[]; coverage: string } };
type AnalysisScope = { organizationId: Id<"organizations">; repositoryId: Id<"repositories">; reviewId: Id<"reviews">; githubRepositoryId: number; headSha: string; baseSha: string; configRevision: string; provider: ProviderName; model: string;
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

// What the findings model needs from validation, which is much less than the stored evidence: one row
// per check, the head commit's output only where a check failed (its start and its end, cut on line
// boundaries), never the base commit's output, and the scanner findings this pull request introduced.
// The key stays `validation`, so injection scoping still files a signal in it under "checks". The
// stored artifact keeps boundedValidationEvidence, because Autofix reads it.
type CheckRow = { planId?: string; kind?: string; required?: boolean; conclusion?: string; testCounts?: unknown; notRunReason?: string };
const lineTail = (text: string, bytes: number) => { const tail = text.slice(-bytes); const cut = tail.indexOf("\n"); return cut > 0 && tail.length < text.length ? tail.slice(cut + 1) : tail; };
const lineHead = (text: string, bytes: number) => { const head = text.slice(0, bytes); const cut = head.lastIndexOf("\n"); return cut > 0 && head.length < text.length ? head.slice(0, cut) : head; };
export function modelValidationView(value: ValidationArtifact, pinned: { headSha: string; baseSha: string }, changedPaths: ReadonlySet<string>, maxBytes = 24_000) {
  if (value.version !== 1 || value.pinned?.headSha !== pinned.headSha || value.pinned?.baseSha !== pinned.baseSha || !value.output?.base || !value.output.head) throw new Error("validation_evidence_pinning_failed");
  const headRows = (value.output.head.results ?? []) as CheckRow[], baseRows = (value.output.base.results ?? []) as CheckRow[];
  const failed = (row?: CheckRow) => row?.conclusion === "failed" || row?.conclusion === "timed_out";
  const checks = headRows.map(row => { const base = baseRows.find(item => item.planId === row.planId);
    return { planId: row.planId, kind: row.kind, required: row.required, conclusion: row.conclusion, baseConclusion: base?.conclusion,
      ...(failed(row) && failed(base) ? { preExisting: true } : {}), ...(row.testCounts ? { testCounts: row.testCounts } : {}), ...(row.notRunReason ? { notRunReason: row.notRunReason } : {}) }; });
  const outputs = (value.output.head.outputs ?? []).flatMap(item => {
    const row = headRows.find(candidate => candidate.planId === item.planId);
    if (!failed(row) || typeof item.text !== "string") return [];
    const text = redact(item.text), preExisting = failed(baseRows.find(candidate => candidate.planId === item.planId));
    // A failure the base commit shares needs only its ending; a new one needs where it starts too.
    const excerpt = preExisting ? lineTail(text, 1_500) : text.length <= 8_000 ? text : `${lineHead(text, 2_000)}\n…\n${lineTail(text, 6_000)}`;
    return [{ planId: item.planId, text: excerpt, truncated: excerpt.length < text.length || Boolean(item.truncated || item.evidenceTruncated) }];
  });
  const scanners = value.output.scanners as { base?: { findings?: Parameters<typeof introducedScannerFindings>[0] }; head?: { findings?: Parameters<typeof introducedScannerFindings>[1] } } | undefined;
  const introduced = introducedScannerFindings(scanners?.base?.findings ?? [], scanners?.head?.findings ?? [], changedPaths);
  const view = { manager: value.manager, checks, outputs,
    scanners: { introduced: introduced.slice(0, 20).map(item => ({ scanner: item.scanner, ruleId: item.ruleId, path: item.path, startLine: item.startLine, endLine: item.endLine, severity: item.severity, summary: item.summary })), introducedTotal: introduced.length } };
  const bounded = boundJson(view, maxBytes);
  return bounded.value ?? { manager: value.manager, checks, outputs: [], scanners: { introduced: [], introducedTotal: introduced.length }, truncated: true };
}

export function boundedValidationEvidence(value: ValidationArtifact, pinned: { headSha: string; baseSha: string }, maxOutputBytes = 60_000) {
  if (value.version !== 1 || value.pinned?.headSha !== pinned.headSha || value.pinned?.baseSha !== pinned.baseSha || !value.output?.base || !value.output.head) throw new Error("validation_evidence_pinning_failed");
  // Head first, and every part charged to the budget. Base used to be evaluated first from the same
  // budget, so a long base test log left the head's - the commit under review - empty; and results
  // and scanners were sized against the budget without being subtracted from it.
  let remaining = maxOutputBytes;
  const charge = (value: unknown) => { remaining -= value === undefined ? 0 : Buffer.byteLength(JSON.stringify(value)); };
  const run = (input: NonNullable<ValidationArtifact["output"]>["base"]) => {
    const results = boundJson(input?.results ?? [], Math.max(0, remaining)).value ?? []; charge(results);
    return { results, outputs: (input?.outputs ?? []).map(item => {
      const raw = typeof item.text === "string" ? redact(item.text) : "", text = raw.slice(0, Math.max(0, remaining)); remaining -= Buffer.byteLength(text);
      return { planId: item.planId, text, truncated: Boolean(item.truncated || item.evidenceTruncated || text.length !== raw.length) };
    }) };
  };
  const head = run(value.output.head), base = run(value.output.base);
  const boundedScanners = boundJson(value.output.scanners, Math.max(0, remaining));
  return { manager: value.manager, base, head, scanners: boundedScanners.value, scannersTruncated: boundedScanners.truncated };
}

// Why the model saw part of what was gathered, most specific first, for the stage's handoff record.
// It used to record a reason only for a dropped changed file, so every other partial context read
// "Partial" with nothing after it - on a page whose facts said "Coverage: Full".
export function analysisContextGap(context: Pick<ReturnType<typeof boundedAnalysisContext>, "coverage" | "pull" | "exclusions">, droppedChangedFile: boolean) {
  if (context.coverage === "full") return undefined;
  if (droppedChangedFile) return "analysis_budget";
  if (context.pull.requirementCoverage !== "complete") return "requirements";
  if ((context.exclusions.totals.changedExcerpts ?? 0) > 0) return "changed_excerpts";
  return "shortened";
}

export function boundedAnalysisContext(chunks: SnapshotChunk[], maxBytes = 80_000) {
  const headChunks = chunks.filter(chunk => chunk.revision !== "base"), pull = headChunks.find(chunk => chunk.pull)?.pull;
  if (!pull) throw new Error("pull_request_context_missing");
  type ModelSource = NonNullable<NonNullable<SnapshotChunk["pull"]>["requirementSources"]>[number] & { content?: string };
  type ModelRequirement = NonNullable<NonNullable<SnapshotChunk["pull"]>["requirements"]>[number] & { textTruncated?: boolean };
  type ModelConflict = NonNullable<NonNullable<SnapshotChunk["pull"]>["requirementConflicts"]>[number] & { canonicalTruncated?: boolean };
  type OmissionSample = { path?: string; reason: string };
  // repositoryFiles: a changed file whose content did not fit, which is what makes the review partial.
  // relatedFiles: an import neighbour that did not fit. Files outside both are not offered at all, so
  // they are not counted as left out.
  type OmissionKind = "repositoryFiles" | "changedExcerpts" | "relatedFiles" | "uncitedSources" | "patches" | "changedFiles" | "sourceOmissions" | "pullOmissions" | "requirementSources" | "requirements" | "requirementConflicts" | "truncatedTexts";
  const changes: Array<{ path: string; status: string; patch?: string }> = [];
  const requirementSources: ModelSource[] = [], requirements: ModelRequirement[] = [], requirementConflicts: ModelConflict[] = [];
  const files: Array<{ evidenceId: string; path: string; content: string; startLine: number; endLine: number; contentHash: string; excerpt?: true; related?: true }> = [];
  const exclusions = { paths: [] as string[], patchPaths: [] as string[], changedPaths: [] as string[], source: [] as OmissionSample[], pull: [] as OmissionSample[],
    totals: {} as Partial<Record<OmissionKind, number>> };
  const base = { pull: { title: "", titleTruncated: false, body: "", bodyTruncated: false, changes, urlHash: pull.urlHash,
    requirementCoverage: pull.requirementCoverage ?? "partial", requirementSources, requirements, requirementConflicts,
    // Bounded upstream by instructionsForPaths; repeated here because everything in this object is.
    reviewInstructions: (pull.reviewInstructions ?? []).slice(0, 20).map(item => redactForModel(String(item).slice(0, 2_000))) }, files, exclusions, coverage: "partial" as "full" | "partial" };
  const size = () => Buffer.byteLength(JSON.stringify(base));
  if (size() > maxBytes) throw new Error("analysis_context_budget_too_small");
  const baseCeiling = Math.max(size(), Math.floor(maxBytes * 0.7));
  const pushWithin = <T>(target: T[], item: T, ceiling = baseCeiling) => { target.push(item); if (size() <= ceiling) return true; target.pop(); return false; };
  // increment() writes into base and is not covered by pushWithin's pop-on-overflow, so every
  // exclusion counter can still grow after the last file was admitted. This holds back enough room
  // for those digits plus the keys that appear the first time a kind is excluded.
  const counterReserve = Math.max(48, Math.min(2_048, Math.floor(maxBytes * 0.01)));
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
  // Repository documents and tests are gathered wholesale as places a requirement might be written.
  // One earns a place in the prompt only when a requirement was actually read out of it; the rest
  // were up to 20 KB of README and test code, and then - once their text was dropped - 18 KB of ids
  // and hashes for zod's 120 of them, informing nothing. They are counted, not listed. A linked
  // ticket stays either way, because the author pointed at it.
  const citedSources = new Set((pull.requirements ?? []).map(item => item.sourceId));
  let uncited = 0;
  for (const source of pull.requirementSources ?? []) {
    if ((source.type === "repository_document" || source.type === "test") && !citedSources.has(source.id)) { uncited++; continue; }
    const { content: sourceContent, ...sourceMeta } = source as ModelSource;
    const rawContent = sourceContent?.slice(0, Math.max(0, requirementBudget));
    const contentTruncated = Boolean(sourceContent && rawContent !== undefined && rawContent.length !== sourceContent.length);
    const candidate = { ...sourceMeta, ...(rawContent === undefined ? {} : { content: redactForModel(rawContent) }) } as ModelSource;
    if (pushWithin(requirementSources, candidate)) { requirementBudget -= Buffer.byteLength(rawContent ?? ""); if (contentTruncated) increment("truncatedTexts"); }
    else increment("requirementSources");
  }
  if (uncited) increment("uncitedSources", uncited);
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
  // A sample is there to show the model what kind of thing was left out; the totals say how much.
  // Unbounded, the samples were up to ~56 KB of paths on every call.
  const sampleCap = 20;
  const pushSample = <T>(target: T[], item: T, ceiling = baseCeiling) => target.length < sampleCap && pushWithin(target, item, ceiling);
  let patchBudget = 30_000;
  const omittedPatches = new Set<string>();
  const omitPatch = (path: string) => { if (omittedPatches.has(path)) return; omittedPatches.add(path); increment("patches"); pushSample(exclusions.patchPaths, path); };
  const headFiles = headChunks.flatMap(chunk => chunk.snapshot.files), headByPath = new Map(headFiles.map(file => [file.path, file]));
  const admitPatch = (file: { path: string; patch?: string }, ceiling: number) => {
    if (!file.patch) return;
    const change = changes.find(item => item.path === file.path);
    if (!change) { omitPatch(file.path); return; }
    const rawPatch = file.patch.slice(0, Math.max(0, patchBudget));
    if (!rawPatch || rawPatch.length !== file.patch.length) omitPatch(file.path);
    if (!rawPatch) return;
    change.patch = redactForModel(rawPatch);
    if (size() <= ceiling) patchBudget -= rawPatch.length;
    else { delete change.patch; omitPatch(file.path); }
  };
  // An added file's patch is the file again, one "+" per line. It waits until the file itself has
  // been offered, and is sent only if the file was not.
  const isAdded = (file: { path: string; status: string }) => file.status === "added" && headByPath.has(file.path);
  for (const file of pull.files) if (!isAdded(file)) admitPatch(file, baseCeiling);
  const sampleOmission = (value: unknown): OmissionSample => {
    if (!value || typeof value !== "object") return { reason: "omitted" };
    const item = value as { path?: unknown; reason?: unknown };
    return { ...(typeof item.path === "string" ? { path: redactForModel(item.path.slice(0, 500)) } : {}), reason: typeof item.reason === "string" ? redactForModel(item.reason.slice(0, 100)) : "omitted" };
  };
  const sourceOmissions = headChunks.flatMap(chunk => chunk.snapshot.omitted);
  if (sourceOmissions.length) increment("sourceOmissions", sourceOmissions.length);
  if (pull.omitted.length) increment("pullOmissions", pull.omitted.length);
  for (const item of sourceOmissions.slice(0, sampleCap)) pushSample(exclusions.source, sampleOmission(item));
  for (const item of pull.omitted.slice(0, sampleCap)) pushSample(exclusions.pull, sampleOmission(item));

  // What the model reads of the repository: the changed files, then the files they import and the
  // files that import them, and nothing else. It used to be the changed files followed by the rest of
  // the snapshot in alphabetical order until 80 KB were spent - documents, manifests, whatever sorted
  // first - which was most of every prompt and none of the review.
  //
  // A changed file goes whole when it is small. A large one goes as windows around each hunk, cut on
  // line boundaries and carrying the whole file's evidence id, so a finding cites it exactly as it
  // would the whole file; it is skipped (and the review made partial) only when even that does not fit.
  const admit = (item: (typeof files)[number]) => {
    // The comma JSON adds before a second element is real payload; omitting it undercounted by a
    // byte, which is all it took on a tree this size.
    const bytes = Buffer.byteLength(JSON.stringify(item)) + (files.length ? 1 : 0);
    if (size() + bytes > maxBytes - counterReserve) return false;
    files.push(item);
    return true;
  };
  const related = relatedPaths(pull.files.map(file => file.path), headFiles);
  const wholeFileBytes = 16_000, hunkContext = 40, admittedWhole = new Set<string>();
  const changedFiles = pull.files.flatMap(file => { const head = headByPath.get(file.path); return head ? [{ ...file, content: head.content }] : []; })
    .sort((a, b) => a.content.length - b.content.length || a.path.localeCompare(b.path));
  for (const file of changedFiles) {
    const evidence = sourceEvidence(file.path, file.content), whole = { ...evidence, content: redactForModel(file.content) };
    if (file.content.length <= wholeFileBytes && admit(whole)) { admittedWhole.add(file.path); continue; }
    const windows = hunkWindows(file.content, file.patch, hunkContext)?.map(window => ({ ...evidence, content: redactForModel(window.text), startLine: window.startLine, endLine: window.endLine, excerpt: true as const }));
    const windowBytes = windows ? windows.reduce((total, item) => total + Buffer.byteLength(JSON.stringify(item)) + 1, 0) : Infinity;
    if (windows && windowBytes < Buffer.byteLength(JSON.stringify(whole))) {
      // Counted first so its digits are inside the check: every window goes, or none does.
      increment("changedExcerpts");
      if (size() + windowBytes <= maxBytes - counterReserve) { for (const item of windows) admit(item); continue; }
      if (!(exclusions.totals.changedExcerpts = (exclusions.totals.changedExcerpts ?? 1) - 1)) delete exclusions.totals.changedExcerpts;
    }
    if (admit(whole)) { admittedWhole.add(file.path); continue; }
    increment("repositoryFiles"); pushSample(exclusions.paths, file.path, maxBytes);
  }
  for (const file of pull.files) if (isAdded(file) && !admittedWhole.has(file.path)) admitPatch(file, maxBytes - counterReserve);
  let relatedBudget = 16_000;
  for (const path of related) {
    const file = headByPath.get(path)!, bytes = Buffer.byteLength(file.content);
    if (bytes <= relatedBudget && admit({ ...sourceEvidence(path, file.content), content: redactForModel(file.content), related: true })) relatedBudget -= bytes;
    else increment("relatedFiles");
  }
  // Related files are a courtesy, and an uncited document held no requirement; neither means the
  // model missed part of the code under review or its intent.
  const excludedAnything = Object.entries(exclusions.totals).some(([kind, value]) => kind !== "relatedFiles" && kind !== "uncitedSources" && (value ?? 0) > 0) || pull.requirementCoverage !== "complete" || headChunks.some(chunk => chunk.snapshot.coverage !== "full");
  base.coverage = excludedAnything ? "partial" : "full";
  while (size() > maxBytes && exclusions.paths.length) exclusions.paths.pop();
  while (size() > maxBytes && exclusions.patchPaths.length) exclusions.patchPaths.pop();
  // Counted as it is popped, not inferred from what survives. introducedScannerFindings filters head
  // findings to changedPaths, so a path dropped here takes its scanner findings with it - and
  // analysisDroppedChangedFile read `changedPaths.length > 0`, which is false once this loop has
  // emptied the array. A secret the pull request introduced into that file was then excluded from
  // the findings AND from the coverage gap that would have said so.
  while (size() > maxBytes && exclusions.changedPaths.length) { exclusions.changedPaths.pop(); increment("changedFiles"); }
  if (size() > maxBytes) throw new Error("analysis_context_too_large");
  return base;
}
export function selectCriticModel(provider:ProviderName,primary:string,availableModels?:readonly string[]){const preferred=provider==="gemini"?(primary==="gemini-2.5-flash"?"gemini-2.5-pro":"gemini-2.5-flash"):provider==="openai"?(primary==="gpt-5.4-mini"?"gpt-5.4":"gpt-5.4-mini"):(primary==="claude-sonnet-4-5"?"claude-sonnet-4-6":"claude-sonnet-4-5"),available=availableModels?new Set(availableModels):approvedProviderModels[provider],independent=Boolean(availableModels)&&available.has(preferred)&&preferred!==primary;return{model:independent?preferred:primary,independent}}
// The second opinion has to come from a model that gave neither the first findings nor the first
// critique. It used to be criticRoute.model - the first critic itself, with an identical input - so
// "escalation" re-rolled the same judge. The first approved model the key lists that is neither; or
// none, in which case a person decides rather than anything pretending a second look happened.
export function selectEscalationModel(provider: ProviderName, findingsModel: string, criticModel: string, availableModels?: readonly string[]) {
  if (!availableModels) return null;
  const approved = approvedProviderModels[provider];
  return availableModels.find(model => approved.has(model) && model !== findingsModel && model !== criticModel) ?? null;
}

// Apply a second critic to the findings it was asked about, and nothing else. It may resolve an
// uncertain finding to supported; an "unsupported" keeps it uncertain rather than rejecting it, so a
// second look can never be the quieter route to dismissing a finding. Duplicate or missing second
// decisions, and decisions about findings that were not escalated, change nothing.
export function mergeSecondOpinion(first: CriticDecision[], second: CriticDecision[], escalatedIds: ReadonlySet<string>) {
  const answers = new Map<string, CriticDecision[]>();
  for (const decision of second) if (escalatedIds.has(decision.findingId)) answers.set(decision.findingId, [...(answers.get(decision.findingId) ?? []), decision]);
  return first.map(decision => {
    const replies = answers.get(decision.findingId);
    if (!replies || replies.length !== 1) return decision;
    const reply = replies[0]!;
    return reply.verdict === "unsupported" ? { ...reply, verdict: "uncertain" as const } : reply;
  });
}

// Re-arbitration after a second opinion, deterministically. The first pass's arbitration output only
// ever saw the escalated findings while they were uncertain, so reconciling a now-supported one
// against it demoted it straight back - escalation could reject but never accept. It still applies,
// unchanged, to every finding that was not escalated.
export function rearbitrateAfterEscalation(candidates: FindingCandidate[], firstCritic: CriticDecision[], secondOpinion: CriticDecision[], escalatedIds: ReadonlySet<string>, arbitration: ArbitrationDecision[]) {
  const rearbitrated = arbitrateFindings(candidates, mergeSecondOpinion(firstCritic, secondOpinion, escalatedIds));
  return dedupeSameDefect(rearbitrated.map(item => escalatedIds.has(item.id) ? item : reconcileArbitration([item], arbitration)[0]!));
}

export function selectFindingsModel(provider: ProviderName, primary: string, availableModels?: readonly string[]) {
  if (provider !== "openai" || primary !== "gpt-5.4-mini" || !availableModels?.includes("gpt-5.4")) return primary;
  return "gpt-5.4";
}
export function requireIndependentCritic(findings:FindingCandidate[],decisions:CriticDecision[],independent:boolean){if(independent)return decisions;const risky=new Set(findings.filter(item=>item.origin==="model"&&["critical","high"].includes(item.severity)).map(item=>item.id));return decisions.map(item=>risky.has(item.findingId)?{...item,verdict:"uncertain" as const,missingEvidenceIds:[...new Set([...item.missingEvidenceIds,"independent-critic-unavailable"])],explanation:"An independent approved critic model was unavailable."}:item)}

type ScannerFindingInput = { scanner?: string; ruleId?: string; fingerprint?: string; severity?: "critical" | "warning" | "info"; path?: string; startLine?: number; endLine?: number; summary?: string };
// A scanner finding may only be attributed to a pull request if the file is in the pull request.
//
// Diffing head against base looks like it should be enough, and it is not, because the two
// revisions do not fetch the same files: head also selects requirement sources and dependency
// manifests, base selects only what the diff touched. So gitleaks scanned zod's string.test.ts on
// head, never saw it on base, and three JWT fixtures that had been sitting in that repository all
// along came back as Critical and Blocking against a pull request that never opened the file.
//
// changedPaths closes it from the other side, and is the stronger rule anyway: whatever the two
// snapshots happened to contain, a finding on a file the author did not touch is not theirs. The
// base diff still runs, so a finding they did introduce into a file that already had one is still
// reported.
export function introducedScannerFindings(base: ScannerFindingInput[], head: ScannerFindingInput[], changedPaths?: ReadonlySet<string>) {
  // Deliberately not the scanner's fingerprint. Both line-based scanners build theirs out of the
  // line number - builditRules as `${path}:${line}:${rule}`, gitleaks from its own File:Rule:Line -
  // so inserting a single line anywhere above an existing match changes it. Base and head then
  // disagree about a match neither commit introduced, and the pull request is told under
  // "Critical - Blocking - Confirmed by evidence" that it disabled TLS verification or committed a
  // secret that has been sitting in that file for years.
  //
  // scanner + rule + path, counted as a multiset, answers the question that actually matters: how
  // many times does this rule match this file on each side. One match that moved is consumed by the
  // one on base; a genuinely added second match finds the count already spent and is reported. That
  // is the same distinction the fingerprint was reaching for, without being sensitive to where in
  // the file the line happens to sit.
  const key = (item: ScannerFindingInput) => typeof item.fingerprint === "string" && item.fingerprint.length > 0 && typeof item.ruleId === "string" && typeof item.path === "string"
    ? `${item.scanner ?? "unknown"}\0${item.ruleId}\0${item.path}` : undefined;
  const remaining = new Map<string, number>();
  for (const item of base) { const value = key(item); if (value) remaining.set(value, (remaining.get(value) ?? 0) + 1); }
  const touched = changedPaths === undefined
    ? head
    : head.filter(item => typeof item.path === "string" && changedPaths.has(item.path));
  return touched.filter(item => { const value = key(item); if (!value) return true; const count = remaining.get(value) ?? 0; if (!count) return true; if (count === 1) remaining.delete(value); else remaining.set(value, count - 1); return false; });
}

// The evidence gate every model finding passes, written once and used twice: to decide whether the
// critic and arbitration calls could change the result at all, and for the result itself.
// Repositories that run the candidate prompts (packages/orchestrator/src/candidatePrompts.ts), as
// GitHub repository ids so a rename cannot move one in or out. Unset means none: the candidate is
// opt-in until the historical benchmark shows it does no worse, and then it becomes the default.
export function promptVariantFor(githubRepositoryId: number, allowlist = process.env.BUILDIT_PROMPT_CANDIDATE_REPOSITORIES): PromptVariant {
  const ids = (allowlist ?? "").split(",").map(value => value.trim()).filter(value => /^[1-9]\d{0,15}$/.test(value));
  return ids.includes(String(githubRepositoryId)) ? "candidate" : "current";
}

export type FindingGate = { provenance: ReadonlyMap<string, unknown>; evidence: EvidenceRecord[]; allowedPaths: ReadonlySet<string>; headSha: string };
export function gateModelFindings(records: ValidatedStage[], gate: FindingGate) {
  const stage = (name: PromptStage) => records.find(item => item.stage === name)?.value ?? {};
  const requirements = ((stage("requirements").requirements ?? []) as Array<{ id: string; status: "resolved" | "missing" | "inaccessible" | "conflicting" | "excluded"; confidence: number }>).filter(item => item && typeof item.id === "string" && gate.provenance.has(item.id) && Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1);
  const criteriaIds = new Set(requirements.map(item => item.id));
  const modelFindings = normalizeFindingCriteria(((stage("findings").findings ?? []) as FindingCandidate[]).map(item => ({ ...item, origin: "model" as const })), criteriaIds);
  const validated = validateFindingCandidates({ findings: modelFindings, criteriaIds, allowedPaths: new Set(gate.allowedPaths), evidence: gate.evidence, pinnedCommit: gate.headSha });
  return { requirements, criteriaIds, modelFindings, validated };
}

// Whether a model call could change anything, decided from what earlier stages returned - so a
// review with nothing to judge stops paying for judges. Each skip is provably output-identical:
// arbitrateFindings maps over validated candidates only, so with none the critic's decisions are
// never read; and reconcileArbitration touches only model findings already accepted, so with none
// the arbitration call is never read. Scanner findings never reach a model either way. On
// buildit-demo-zod#1 - no findings - critic and arbitration were two of three calls, ~190k tokens.
export function analysisSkipReason(stage: PromptStage, records: ValidatedStage[], gate: FindingGate, criticIndependent: boolean) {
  if (stage !== "critic" && stage !== "arbitration") return undefined;
  const { modelFindings, validated } = gateModelFindings(records, gate);
  if (!validated.length) return "no model finding passed the evidence gate";
  if (stage === "critic") return undefined;
  const decisions = (records.find(item => item.stage === "critic")?.value.decisions ?? []) as CriticDecision[];
  return arbitrateFindings(validated, requireIndependentCritic(modelFindings, decisions, criticIndependent)).some(item => item.origin === "model" && item.resolution === "accepted")
    ? undefined : "no model finding was accepted";
}

export const analyze = internalAction({
  args: { organizationId: v.id("organizations"), reviewId: v.id("reviews"), expectedHeadSha: v.string(), expectedGeneration: v.number() },
  handler: async (ctx, args): Promise<{ artifactId: string; stages: number; inputTokens: number; outputTokens: number }> => {
    const scope: AnalysisScope = await ctx.runQuery(internal.reviewModelData.analysisScope, args), brokerUrl = required("BUILDIT_BROKER_URL").replace(/\/$/, ""), artifactSecret = Buffer.from(required("ARTIFACT_GRANT_SECRET"), "base64url"), modelSecret = Buffer.from(required("MODEL_GRANT_SECRET"), "base64url");
    // Every download is independent of the others. One after another they cost a broker round trip
    // each before the first model call could start; together they cost the slowest one.
    const download = async (artifact: { id: Id<"artifacts">; storageKey: string; checksum: string; size: number }, kind: "context_artifact" | "validation_artifact") => {
      const grant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(artifact.id), storageKey: artifact.storageKey, operation: "read" }, artifactSecret);
      const response = await fetch(`${brokerUrl}/api/artifacts`, { headers: { authorization: `Bearer ${grant}` } });
      if (!response.ok) throw new Error(`${kind}_download_${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.byteLength !== artifact.size || createHash("sha256").update(body).digest("hex") !== artifact.checksum) throw new Error(`${kind}_integrity_failed`);
      return body;
    };
    const [contextBodies, validationBody] = await Promise.all([
      Promise.all(scope.artifacts.map(artifact => download(artifact, "context_artifact"))),
      download(scope.validationArtifact, "validation_artifact"),
    ]);
    const chunks: SnapshotChunk[] = contextBodies.map((body, index) => ({ ...(JSON.parse(body.toString("utf8")) as SnapshotChunk), artifactId: scope.artifacts[index]!.id }));
    const revisions = new Set(chunks.map(chunk => chunk.revision));
    if (!revisions.has("base") || !revisions.has("head")) throw new Error("base_head_context_incomplete");
    const validationValue = JSON.parse(validationBody.toString("utf8")) as ValidationArtifact;
    const availableModels = scope.credential.availableModels.length ? scope.credential.availableModels : undefined;
    const findingsModel = selectFindingsModel(scope.provider, scope.model, availableModels);
    const criticRoute = selectCriticModel(scope.provider, findingsModel, availableModels);
    const memory = await ctx.runQuery(internal.repositoryMemory.forRepository, { repositoryId: scope.repositoryId });
    // Memory stays out of the prompt: its fingerprints are keyed HMACs of model-chosen ids, which the
    // model cannot match to anything, so they were ~27 KB of hex per call that informed nothing.
    const context = boundedAnalysisContext(chunks), pinnedShas = { headSha: scope.headSha, baseSha: scope.baseSha };
    const contextChangedPaths = new Set<string>([...context.pull.changes.map(change => change.path), ...context.exclusions.changedPaths]);
    const storedValidation = boundedValidationEvidence(validationValue, pinnedShas);
    const untrusted = { ...context, validation: modelValidationView(validationValue, pinnedShas, contextChangedPaths) }, usage: Array<{ inputTokens: number; outputTokens: number }> = [];
    let injectionUnscoped = false;
    const injectionSurfaces = new Set<"code" | "narrative" | "checks" | "unknown">();
    const analysisStartedAt = Date.now();
    // Named rather than inlined so the escalation critic can go through exactly this path: the
    // budget preflight, the single-use grant minted per attempt, and the bounded provider retry
    // are all properties a second opinion needs just as much as a first.
    const invokeStage = async (stageRequest: ModelStageRequest, modelOverride?: string): Promise<ProviderResult> => {
        const stage = stageRequest.stage as PromptStage;
        const model = modelOverride ?? (stage === "findings" ? findingsModel : stage === "critic" ? criticRoute.model : scope.model);
        const request = { model, system: stageRequest.system, input: stageRequest.input, schemaName: stageRequest.schemaName, schema: stageRequest.schema, maxOutputTokens: stageRequest.maxOutputTokens };
        await ctx.runQuery(internal.durableReview.assertActive, args);
        return invokeAccountedModel(ctx, { scope: args, repositoryId: scope.repositoryId, stage, provider: scope.provider,
          credential: scope.credential, request, brokerUrl, modelSecret });
    };
    const headEvidence = new Map<string, { record: EvidenceRecord; artifactId: Id<"artifacts"> }>();
    for (const chunk of chunks.filter(item => item.revision === "head")) for (const file of chunk.snapshot.files) {
      if (!chunk.artifactId) throw new Error("context_artifact_reference_missing");
      const item = sourceEvidence(file.path, file.content);
      headEvidence.set(item.evidenceId, { artifactId: chunk.artifactId, record: { id: item.evidenceId, artifactExists: true, commitSha: scope.headSha, path: item.path, pathExists: true, startLine: item.startLine, endLine: item.endLine, contentHash: item.contentHash, lineHashMatches: true, truncated: false } });
    }
    const sourceById = new Map(untrusted.pull.requirementSources.map(source => [source.id, source]));
    const provenanceByRequirementId = new Map(untrusted.pull.requirements.flatMap(requirement => { const source = sourceById.get(requirement.sourceId); return source ? [[requirement.id, source] as const] : []; }));
    const findingGate: FindingGate = { provenance: provenanceByRequirementId, evidence: [...headEvidence.values()].map(item => item.record),
      allowedPaths: new Set([...headEvidence.values()].flatMap(item => item.record.path ? [item.record.path] : [])), headSha: scope.headSha };
    let plannedReview: ReviewPlan | undefined;
    const variant = promptVariantFor(scope.githubRepositoryId);
    const records = redactModelOutput(await runModelReviewChain({ pinned: { headSha: scope.headSha, baseSha: scope.baseSha, configRevision: scope.configRevision }, untrusted, variant,
      onInjection: report => { injectionUnscoped ||= report.scope.unscoped; for (const surface of report.scope.surfaces) injectionSurfaces.add(surface); },
      // planReview runs on every review and its output was discarded on every review - the chain
      // recomputed it internally and nothing ever saw which stages were chosen, how many findings
      // specialists were spawned, or why a stage was skipped. Recording it is what makes the routing
      // a decision somebody can inspect rather than a claim in a README.
      skip: (stageName, priorRecords) => analysisSkipReason(stageName, priorRecords, findingGate, criticRoute.independent),
      onPlan: async plan => { plannedReview = plan; await ctx.runMutation(internal.runStateData.record, {
        ...args, stage: "analysis" as const,
        plannedStages: [...plan.stages],
        findingsSpecialists: plan.findingsSpecialists,
        skippedStages: plan.skipped.map(item => ({ stage: item.stage, because: item.because })),
        memoryDismissed: memory.dismissedFingerprints.length,
        memoryRecurring: memory.recurringFingerprints.length,
        memoryReviewsSeen: memory.reviewsSeen,
        now: Date.now(),
      }); },
      invoke: (stageRequest: ModelStageRequest): Promise<ProviderResult> => invokeStage(stageRequest),
      onUsage: async item => { usage.push({ inputTokens: item.inputTokens, outputTokens: item.outputTokens });await ctx.runMutation(internal.reviewModelData.recordStageRun,{...args,...(item.invocationId?{invocationId:item.invocationId as Id<"modelInvocations">}:{}),stage:item.stage,provider:item.provider,model:item.model,promptVersion:item.promptVersion,schemaVersion:item.schemaVersion,finishReason:item.finishReason,requestHash:item.requestFingerprint,durationMs:item.durationMs,...(item.requestId?{requestId:item.requestId}:{}),attempt:item.attempt,outcome:item.outcome,inputTokens:item.inputTokens,outputTokens:item.outputTokens,now:Date.now()}); } }));
    const { requirements, criteriaIds, modelFindings } = gateModelFindings(records, findingGate);
    if (records.some(item => item.skipped)) await ctx.runMutation(internal.runStateData.record, { ...args, stage: "analysis" as const,
      skippedStages: [...(plannedReview?.skipped ?? []), ...records.flatMap(item => item.skipped ? [{ stage: item.stage, because: item.skipped }] : [])].map(item => ({ stage: item.stage, because: item.because })),
      now: Date.now() });
    const critic = requireIndependentCritic(modelFindings,((records.find(item => item.stage === "critic")?.value.decisions ?? []) as CriticDecision[]),criticRoute.independent);
    const scannerRuns = validationValue.output?.scanners as { base?: { findings?: ScannerFindingInput[] }; head?: { findings?: ScannerFindingInput[] } } | undefined;
    // The union of what fit in the context and what was dropped for budget - the whole changed set,
    // because a file excluded for size is still a file the author touched.
    const changedPaths = new Set<string>([
      ...untrusted.pull.changes.map(change => change.path),
      ...untrusted.exclusions.changedPaths,
    ]);
    const scannerHead = introducedScannerFindings(scannerRuns?.base?.findings ?? [], scannerRuns?.head?.findings ?? [], changedPaths);
    const scannerFindings: FindingCandidate[] = scannerHead.flatMap((item, index) => {
      if (!item.path || !item.ruleId || !item.severity || !Number.isInteger(item.startLine) || !Number.isInteger(item.endLine)) return [];
      const evidence = [...headEvidence.values()].find(value => value.record.path === item.path);
      if (!evidence) return [];
      return [{ id: `scanner-${index}-${item.ruleId}`, title: item.summary ?? item.ruleId, category: "security", severity: item.severity, confidence: 1, path: item.path, startLine: item.startLine!, endLine: item.endLine!, evidenceIds: [evidence.record.id], impact: item.summary ?? "Deterministic scanner finding", explanation: `${item.ruleId} was detected by the pinned BuildIT scanner.`, origin: "scanner" as const }];
    });
    const candidates = validateFindingCandidates({ findings: [...modelFindings, ...scannerFindings], criteriaIds, allowedPaths: new Set([...headEvidence.values()].flatMap(item => item.record.path ? [item.record.path] : [])), evidence: [...headEvidence.values()].map(item => item.record), pinnedCommit: scope.headSha });
    const arbitration = ((records.find(item => item.stage === "arbitration")?.value.findings ?? []) as ArbitrationDecision[]);
    const firstPass = dedupeSameDefect(reconcileArbitration(arbitrateFindings(candidates, critic), arbitration));

    // The escalation ladder. A finding the critic could not resolve used to end right here:
    // labelled uncertain, verdict recorded as "human review required", nothing re-run.
    // shouldEscalateToHuman has been in reviewPlan.ts since it was written with no caller outside a
    // test. A label is not a recovery path, and that is why the routing read as fixed.
    //
    // Rung one is a second opinion from a different model on the same evidence, bounded to exactly
    // one attempt by construction - there is no loop and no retry parameter - and taken only when
    // there genuinely is a different model to ask. If the sibling is unavailable the ladder stops
    // rather than pretending a second look happened.
    const escalation = await (async (): Promise<{ findings: typeof firstPass; decisions: Array<{ kind: string; reason: string; detail?: string }> }> => {
      // Only a model finding left uncertain by the critic is worth a second opinion. One the injection
      // policy marked stays with a person: a model must not be the route back out of that taint.
      const unresolved = firstPass.filter(item => item.resolution === "uncertain" && item.origin === "model" && item.reason !== "prompt_injection_detected");
      if (!unresolved.length) return { findings: firstPass, decisions: [] };
      const escalationModel = selectEscalationModel(scope.provider, findingsModel, criticRoute.model, availableModels);
      // Against findingsModel, not scope.model. criticRoute is derived from findingsModel, and
      // selectFindingsModel can move the findings stage off scope.model - so the independence check
      // has to compare against the model that actually wrote the findings.
      if (!criticRoute.independent || criticRoute.model === findingsModel || !escalationModel) {
        return { findings: firstPass, decisions: [{ kind: "human_escalation", reason: "no third independent model was available to ask, so a person decides", detail: `${unresolved.length} uncertain` }] };
      }
      try {
        const escalationRecords = await runEscalationCritic({
          pinned: { headSha: scope.headSha, baseSha: scope.baseSha, configRevision: scope.configRevision },
          untrusted, variant,
          // The stages that produced the findings under dispute, so this renders the prompt a
          // first-pass critic would see rather than a novel one whose output means something else.
          priorStages: records.filter(item => ["requirements", "findings"].includes(item.stage)),
          onUsage: async item => { usage.push({ inputTokens: item.inputTokens, outputTokens: item.outputTokens });await ctx.runMutation(internal.reviewModelData.recordStageRun,{...args,...(item.invocationId?{invocationId:item.invocationId as Id<"modelInvocations">}:{}),stage:item.stage,provider:item.provider,model:item.model,promptVersion:item.promptVersion,schemaVersion:item.schemaVersion,finishReason:item.finishReason,requestHash:item.requestFingerprint,durationMs:item.durationMs,...(item.requestId?{requestId:item.requestId}:{}),attempt:item.attempt,outcome:item.outcome,inputTokens:item.inputTokens,outputTokens:item.outputTokens,now:Date.now()}); },
          invoke: (stageRequest: ModelStageRequest): Promise<ProviderResult> => invokeStage(stageRequest, escalationModel),
        });
        const secondOpinion = ((escalationRecords.find(item => item.stage === "critic")?.value?.decisions ?? []) as CriticDecision[]);
        const escalatedIds = new Set(unresolved.map(item => item.id));
        const escalated = rearbitrateAfterEscalation(candidates, critic, secondOpinion, escalatedIds, arbitration);
        // A second opinion may resolve an uncertainty. It may never weaken a finding that was
        // already accepted: escalation exists to break a tie, not to argue a verdict down, and a
        // model asked twice must not become a route to a quieter answer.
        const weakened = escalated.some(item => firstPass.find(candidate => candidate.id === item.id)?.resolution === "accepted" && item.resolution !== "accepted");
        if (weakened) return { findings: firstPass, decisions: [{ kind: "critic_escalation_discarded", reason: "the second critic would have weakened an already accepted finding, so its opinion was not applied" }] };
        const stillUnresolved = escalated.filter(item => escalatedIds.has(item.id) && item.resolution === "uncertain").length;
        return { findings: escalated, decisions: [
          { kind: "critic_escalation", reason: `${unresolved.length} ${unresolved.length === 1 ? "finding was" : "findings were"} unresolved after the first critic`,
            detail: `second opinion from ${escalationModel}: ${unresolved.length - stillUnresolved} resolved, ${stillUnresolved} still uncertain` },
          ...(stillUnresolved ? [{ kind: "human_escalation", reason: "two independent critics could not resolve it, so a person decides", detail: `${stillUnresolved} still uncertain` }] : []),
        ] };
      } catch (error) {
        // A failed second opinion must not cost the first verdict. The finding stays exactly as
        // uncertain as it already was, and the run records that the ladder was attempted - so
        // "nobody asked twice" stays distinguishable from "we asked and could not reach the model".
        return { findings: firstPass, decisions: [{ kind: "critic_escalation_failed", reason: "the second critic could not be reached", detail: String((error as Error)?.message ?? "unknown").slice(0, 120) }] };
      }
    })();
    const arbitrated = escalation.findings;
    if (escalation.decisions.length) await ctx.runMutation(internal.runStateData.record, { ...args, stage: "analysis" as const, decisions: escalation.decisions, now: Date.now() });

    const fingerprintKey = Buffer.from(required("FINDING_FINGERPRINT_SECRET"), "base64url");
    if (fingerprintKey.byteLength < 32) throw new Error("finding_fingerprint_secret_invalid");
    const outputBody = Buffer.from(JSON.stringify({ version: 1, pinned: { headSha: scope.headSha, baseSha: scope.baseSha, configRevision: scope.configRevision }, coverage: untrusted.coverage, validation: storedValidation, records, arbitrated }));
    if (outputBody.byteLength > 4_000_000) throw new Error("analysis_output_too_large");
    const checksum = createHash("sha256").update(outputBody).digest("hex"), now = Date.now();
    const reserved: { artifactId: Id<"artifacts">; storageKey: string } = await ctx.runMutation(internal.reviewModelData.reserveOutput, { ...args, checksum, size: outputBody.byteLength, now });
    const writeGrant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(reserved.artifactId), storageKey: reserved.storageKey, operation: "write" }, artifactSecret, now);
    await ctx.runQuery(internal.durableReview.assertActive, args);
    const upload = await fetch(`${brokerUrl}/api/artifacts`, { method: "PUT", headers: { authorization: `Bearer ${writeGrant}`, "content-type": "application/octet-stream", "x-buildit-sha256": checksum }, body: outputBody });
    if (!upload.ok) throw new Error(`analysis_artifact_upload_${upload.status}`);
    const inputTokens = usage.reduce((sum, item) => sum + item.inputTokens, 0), outputTokens = usage.reduce((sum, item) => sum + item.outputTokens, 0);
    // A file the pull request changed that did not fit the model's window was skipped whole, and
    // nothing downstream ever learned. Two ways it can happen: the file's content lost the budget
    // race (exclusions.paths), or the changed-file entry itself did not fit (exclusions.changedPaths).
    const changedPathSet = new Set(untrusted.pull.changes.map(change => change.path));
    // The counter, not just the surviving array: the repair loop can empty changedPaths entirely,
    // and "nothing left in the list" is indistinguishable from "nothing was ever dropped".
    const analysisDroppedChangedFile = untrusted.exclusions.changedPaths.length > 0
      || (untrusted.exclusions.totals?.changedFiles ?? 0) > 0
      || (untrusted.exclusions.totals?.repositoryFiles ?? 0) > 0
      || untrusted.exclusions.paths.some(path => changedPathSet.has(path));
    const contextGap = analysisContextGap(untrusted, analysisDroppedChangedFile);
    // The handoff record for this stage: what it actually looked at, how completely, how long the
    // model work took, and which artifact carries the output. Written before the verdict mutation so
    // a failure in that mutation still leaves a trace of what the stage did.
    await ctx.runMutation(internal.runStateData.record, {
      ...args, stage: "analysis" as const,
      filesSelected: untrusted.files.length,
      filesChanged: changedPathSet.size,
      coverage: untrusted.coverage,
      ...(contextGap ? { coverageGap: contextGap } : {}),
      artifactIds: [reserved.artifactId],
      durationMs: Math.max(0, Date.now() - analysisStartedAt),
      now: Date.now(),
    });
    await ctx.runMutation(internal.reviewModelData.completeAnalysis, { ...args, ...(analysisDroppedChangedFile ? { analysisDroppedChangedFile: true } : {}), artifactId: reserved.artifactId, checksum, size: outputBody.byteLength, credentialId: scope.credentialDocumentId, inputTokens, outputTokens,
      requirements: requirements.map(item => { const source = provenanceByRequirementId.get(item.id)!; return { externalIdHash: fingerprint(item.id, fingerprintKey), status: item.status, confidence: item.confidence,
        sourceType: source.type, sourceUrlHash: source.urlHash, fetchedVersion: source.version }; }),
      findings: arbitrated.filter(item => item.resolution !== "rejected").map(item => ({ fingerprintHmac: findingFingerprint(item, fingerprintKey), pathHmac: fingerprint(item.path, fingerprintKey),
        category: item.category as "correctness" | "security" | "requirement" | "architecture" | "quality" | "dependency" | "test", severity: item.severity, confidence: item.confidence, blocking: item.blocking,
        evidenceIds: item.evidenceIds.map(id => headEvidence.get(id)!.artifactId), startLine: item.startLine, endLine: item.endLine, ...(item.origin === "scanner" ? { ruleId: item.id.split("-").slice(2).join("-") } : {}),
        ...(item.criterionId ? { requirementExternalIdHash: fingerprint(item.criterionId, fingerprintKey) } : {}), resolution: item.resolution === "accepted" ? "open" as const : "uncertain" as const, ...(isFindingResolutionReason(item.reason) ? { resolutionReason: item.reason } : {}), ...(item.reason === "prompt_injection_detected" ? { injectionSuspected: true } : {}) })), ...(injectionUnscoped ? { injectionUnscoped: true } : {}), ...(injectionSurfaces.size ? { injectionSurfaces: [...injectionSurfaces] } : {}), now: Date.now() });
    return { artifactId: String(reserved.artifactId), stages: records.length, inputTokens, outputTokens };
  },
});

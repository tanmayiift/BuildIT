"use node";
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { EXECUTION_LEASE_MS } from "@buildit/contracts";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  BROKER_REQUEST_TIMEOUT_MS, credentialTeardownRevisions, defaultExecutionPlans, diagnosticRerunAllowed,
  executionSegmentCursor, firstExecutionSegment, nextExecutionSegment,
  SANDBOX_DIAGNOSTIC_RERUN_LIMIT, segmentRunsInSandbox, stampCredentialTeardown,
  type CheckResult, type DiagnosticRun, type ExecutionRevision, type ExecutionSegment, type ExecutionStage,
  type PackageManager, type SegmentPlanState,
} from "@buildit/runner";
import { issueArtifactGrant, issueExecutionGrant } from "@buildit/security";
import { detectPackageManager, pairExecutionEvidence, revisionFromStorageKey, sha256Json, type ExecutionResponse, type ScannerSummary } from "./lib/validationEvidence";
import { runIdFor } from "./lib/runIdentity";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
function validationFailureCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/timeout|abort|timed out/i.test(message)) return "validation_timeout";
  if (/artifact|checksum|integrity|revision/i.test(message)) return "validation_artifact_failed";
  if (/not_resumable/.test(message)) return "validation_not_resumable";
  if (/stale|cancel|replaced/i.test(message)) return "validation_scope_changed";
  if (/broker|fetch|network|sandbox|runner|segment/i.test(message)) return "validation_runner_failed";
  return "validation_failed";
}
type Scope = { organizationId: Id<"organizations">; repositoryId: Id<"repositories">; reviewId: Id<"reviews">; headSha: string; baseSha: string; configRevisionId: Id<"configRevisions">; runnerImageVersion: string; expiresAt: number; completedArtifactId?: Id<"artifacts">; contexts: Array<{ id: Id<"artifacts">; storageKey: string; checksum: string; size: number }> };

const revisions: ExecutionRevision[] = ["base", "head"];
type SegmentOutput = { planId: string; text: string; truncated: boolean; evidenceTruncated: boolean };
type SegmentSide = { credentialTeardownProved?: boolean; stopped?: boolean; results: CheckResult[]; outputs: SegmentOutput[]; diagnostics: Record<string, DiagnosticRun[]> };
type SegmentResponse = { segment: ExecutionSegment; base: SegmentSide; head: SegmentSide; scanners?: { base: ScannerSummary; head: ScannerSummary }; error?: string };
type RevisionEvidence = { credentialTeardownProved: boolean; stopped: boolean; results: CheckResult[]; outputs: SegmentOutput[]; diagnostics: Record<string, DiagnosticRun[]> };
const emptyEvidence = (): RevisionEvidence => ({ credentialTeardownProved: false, stopped: false, results: [], outputs: [], diagnostics: {} });

export const validate = internalAction({
  args: { organizationId: v.id("organizations"), reviewId: v.id("reviews"), expectedHeadSha: v.string(), expectedGeneration: v.number() },
  handler: async (ctx, args): Promise<{ artifactId: string; checks: number; manager: PackageManager | "none"; reused: boolean; segments: number }> => {
    let executionJobId: Id<"executionJobs"> | undefined;
    try {
    const scope: Scope = await ctx.runQuery(internal.reviewValidationData.validationScope, args);
    if (scope.completedArtifactId) return { artifactId: String(scope.completedArtifactId), checks: 0, manager: "npm", reused: true, segments: 0 };
    const runId = runIdFor(String(args.reviewId), args.expectedGeneration);
    const jobKey = `validation:${String(args.reviewId)}:${args.expectedGeneration}:${scope.headSha}`;
    executionJobId = await ctx.runMutation(internal.executionJobsData.create, {
      organizationId: args.organizationId, reviewId: args.reviewId, expectedHeadSha: args.expectedHeadSha,
      expectedGeneration: args.expectedGeneration, jobKey, runId, baseSha: scope.baseSha, now: Date.now(),
    });
    // Claimed once for the whole job rather than once per segment. claimExecutionJob increments the
    // attempt counter and refuses a seventh, so re-claiming between segments would exhaust a
    // six-attempt budget on the first successful review of a repository with three checks.
    const claimed: { stage: ExecutionStage; stateVersion: number } = await ctx.runMutation(internal.executionJobsData.claim, { jobId: executionJobId, workerId: `validation:${runId}`, now: Date.now() });
    // The version the first checkpoint expects is whatever the record is at, not a hard-coded 1: a
    // prepare that failed leaves the stage where it was and the version one higher, and assuming 1
    // meant every retry of the same generation re-ran the entire review and then lost it on
    // execution_checkpoint_conflict at the last checkpoint.
    //
    // A record that already advanced past prepare is a different case and is refused here rather
    // than re-run. The evidence of the segments it completed lived in the previous worker's memory,
    // and this one cannot rebuild it - the stage the record is on is real, and checkpointing over it
    // from prepare would be a lie about what has happened. Refusing costs a review; pretending costs
    // a review AND ten minutes of sandbox on the way to the same failure.
    if (claimed.stage !== "prepare") throw new Error("execution_segments_not_resumable");
    const brokerUrl = required("BUILDIT_BROKER_URL").replace(/\/$/, ""), artifactSecret = Buffer.from(required("ARTIFACT_GRANT_SECRET"), "base64url"), executionSecret = Buffer.from(required("EXECUTION_GRANT_SECRET"), "base64url");
    const paths = { base: new Set<string>(), head: new Set<string>() };
    const contexts = scope.contexts.map(context => ({ context, revision: revisionFromStorageKey(context.storageKey) }));
    for (const { context, revision } of contexts) {
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
    // Re-issued per request rather than once for the job: an artifact read grant is single-use with
    // a sixty second life, and the segments that need the repository are now minutes apart.
    const describe = () => contexts.map(({ context, revision }) => ({ revision, artifactId: String(context.id), storageKey: context.storageKey, checksum: context.checksum, size: context.size,
      readGrant: issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(context.id), storageKey: context.storageKey, operation: "read" }, artifactSecret) }));
    const artifactsHash = sha256Json(describe().map(({ readGrant: _, ...item }) => item));

    const evidence: Record<ExecutionRevision, RevisionEvidence> = { base: emptyEvidence(), head: emptyEvidence() };
    let scanners: { base: ScannerSummary; head: ScannerSummary } | undefined;
    const state: SegmentPlanState = { checks, installable: Boolean(install), installed: [], diagnostics: [] };
    let segment: ExecutionSegment | null = firstExecutionSegment();
    let stage: ExecutionStage = claimed.stage, stateVersion = claimed.stateVersion, segments = 0, tailStartedAt = Date.now();

    while (segment) {
      const startedAt = Date.now();
      if (segmentRunsInSandbox(segment, state)) {
        segments += 1;
        const artifacts = describe();
        // Single-use, 120 seconds, and re-issued here rather than once for the job: a segmented
        // review is minutes of sandbox work, and one grant reused across it would outlive its own
        // replay window and bind none of the segments it authorised.
        const executionGrant = issueExecutionGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), baseSha: scope.baseSha, headSha: scope.headSha, artifactsHash,
          plansHash: sha256Json({ runnerImageVersion: scope.runnerImageVersion, runtime, install, checks, jobKey, segment }), ttlMs: 120_000 }, executionSecret);
        // Re-checked immediately before every segment, not once for the review. A cancellation that
        // arrives after prepare must not buy six more minutes of sandbox time.
        await ctx.runQuery(internal.durableReview.assertActive, args);
        const response = await fetch(`${brokerUrl}/api/execute`, { method: "POST", headers: { authorization: `Bearer ${executionGrant}`, "content-type": "application/json" },
          body: JSON.stringify({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), jobKey, segment, baseSha: scope.baseSha, headSha: scope.headSha, runnerImageVersion: scope.runnerImageVersion, runtime, artifacts, install, checks }),
          signal: AbortSignal.timeout(BROKER_REQUEST_TIMEOUT_MS) });
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          let code: string | undefined;
          try { code = (JSON.parse(detail) as { error?: string }).error; } catch { code = undefined; }
          throw new Error(code ?? `validation_execution_${response.status}`);
        }
        const output = await response.json() as SegmentResponse;
        for (const revision of segment.revisions ?? revisions) merge(evidence[revision], output[revision]);
        if (output.scanners) scanners = output.scanners;
        if (segment.stage === "prepare" && revisions.some(revision => !evidence[revision].credentialTeardownProved)) throw new Error("credential_teardown_unproved");
        if (segment.stage === "install") state.installed = revisions.filter(revision => evidence[revision].results.some(item => item.planId === "install" && item.conclusion === "passed"));
        if (segment.stage === "checks") state.diagnostics = rerunTargets(checks, evidence);
      }
      const next: ExecutionSegment | null = nextExecutionSegment(segment, state);
      if (!next) { tailStartedAt = startedAt; break; }
      // The proof that no credential is reachable inside either sandbox is made once, by `prepare`,
      // and re-stamped onto every cursor after it. Before the split it travelled with the single
      // result object; now it has to survive six more HTTP requests to a stateless broker, and
      // re-probing per segment would make the claim cheap rather than durable.
      const checkpoint: { stateVersion: number } = await ctx.runMutation(internal.executionJobsData.checkpoint, {
        jobId: executionJobId, requestKey: `${runId}:${executionSegmentCursor(segment)}`, expectedVersion: stateVersion,
        expectedStage: stage, nextStage: next.stage, cursor: stampCredentialTeardown(executionSegmentCursor(segment), revisions),
        // Not clamped to EXECUTION_STAGE_LIMIT_MS. A segment that overran is exactly what
        // assertExecutionStageDuration exists to refuse, and a clamp would hide the drift the way
        // vercel.json's maxDuration and the plan budget hid theirs from each other for a release.
        durationMs: Math.max(0, Date.now() - startedAt), now: Date.now(),
        // Hold the lease across the gap to the next segment. Without this the job sits unleased
        // between invocations with this worker still driving it, and reconcileWorker's job sweep -
        // added to reap jobs nobody is driving - cannot tell the difference and kills a review that
        // is progressing normally. Re-claiming instead would spend an attempt per segment and
        // exhaust the six-attempt budget on a healthy run.
        holdLeaseUntil: Date.now() + EXECUTION_LEASE_MS,
      });
      stateVersion = checkpoint.stateVersion;
      stage = next.stage;
      segment = next;
    }

    if (!scanners) throw new Error("scanner_evidence_incomplete");
    const output: ExecutionResponse = {
      base: side(evidence.base), head: side(evidence.head),
      diagnostics: { base: diagnosticsFor(evidence.base), head: diagnosticsFor(evidence.head) },
      scanners,
    };
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
    // Read back rather than trusted from memory. The point of stamping the teardown proof onto the
    // cursor is that the durable record carries it; asserting the in-memory copy would prove only
    // that this process still remembers what it decided six requests ago.
    const durable = await ctx.runQuery(internal.executionJobsData.get, { jobId: executionJobId });
    const proved = credentialTeardownRevisions(durable?.cursor ?? "");
    if (!revisions.every(revision => proved.includes(revision))) throw new Error("credential_teardown_unproved");
    await ctx.runMutation(internal.executionJobsData.checkpoint, {
      jobId: executionJobId, requestKey: `validation-complete:${runId}:${checksum}`, expectedVersion: stateVersion, expectedStage: stage, nextStage: "complete",
      cursor: stampCredentialTeardown(`validation-artifact:${String(reserved.artifactId)}`, revisions), artifactIds: [reserved.artifactId],
      durationMs: Math.max(0, Date.now() - tailStartedAt), now: Date.now(),
    });
    return { artifactId: String(reserved.artifactId), checks: summaries.length, manager: manager ?? "none", reused: false, segments };
    } catch (error) {
      if (executionJobId) {
        await ctx.runMutation(internal.executionJobsData.fail, { jobId: executionJobId, failureCode: validationFailureCode(error), now: Date.now() }).catch(() => undefined);
      }
      throw error;
    }
  },
});

function merge(into: RevisionEvidence, from: SegmentSide | undefined) {
  if (!from) return;
  into.credentialTeardownProved ||= Boolean(from.credentialTeardownProved);
  into.stopped ||= Boolean(from.stopped);
  into.results.push(...(from.results ?? []));
  into.outputs.push(...(from.outputs ?? []));
  for (const [planId, runs] of Object.entries(from.diagnostics ?? {})) into.diagnostics[planId] = [...(into.diagnostics[planId] ?? []), ...runs];
}

const side = (value: RevisionEvidence) => ({ credentialTeardownProved: value.credentialTeardownProved, stopped: value.stopped, results: value.results, outputs: value.outputs });

// Every result row needs a diagnostic run, because pairExecutionEvidence reads the count to decide
// whether a failure was ever reproduced. A row the broker returned without one - the not_run rows an
// install failure leaves behind - would otherwise read as "no runs recorded" rather than "never ran".
function diagnosticsFor(value: RevisionEvidence): Record<string, DiagnosticRun[]> {
  const merged: Record<string, DiagnosticRun[]> = { ...value.diagnostics };
  for (const item of value.results) {
    if (merged[item.planId]?.length) continue;
    const found = value.outputs.find(output => output.planId === item.planId), passed = item.conclusion === "passed";
    merged[item.planId] = [{ conclusion: passed ? "passed" : "failed", ...(passed ? {} : { failureFingerprint: sha256Json(found?.text ?? "") })}];
  }
  return merged;
}

// Which check pairs earn a rerun, and on which revision. A rerun is diagnostic, not a retry: it
// exists to tell a genuine failure from a flaky one, so a revision whose first run passed never gets
// a second - one green rerun beside one red first run reads as flaky, which would turn a stable pass
// into "we could not tell".
function rerunTargets(checks: Array<{ planId: string; required: boolean }>, evidence: Record<ExecutionRevision, RevisionEvidence>) {
  const targets: Array<{ planId: "install" | "test" | "lint" | "typecheck" | "build"; revisions: ExecutionRevision[] }> = [];
  for (const check of checks) {
    if (!check.required) continue;
    const wanted = revisions.filter(revision => diagnosticRerunAllowed(evidence[revision].diagnostics[check.planId] ?? [], 1 + SANDBOX_DIAGNOSTIC_RERUN_LIMIT));
    if (wanted.length) targets.push({ planId: check.planId as "test", revisions: wanted });
  }
  return targets;
}

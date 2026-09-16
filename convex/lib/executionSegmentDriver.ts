"use node";
// One segment loop, driven by both callers.
//
// The 300-second function ceiling split execution into segments: each `/api/execute` call runs one
// stage - and one check pair - against a sandbox that stays alive between calls. That loop was
// written inline in `reviewValidationWorker`, and `reviewAutofixWorker` kept the shape that came
// before it: a single call carrying the whole plan.
//
// That is not a slower autofix, it is a dead one. The broker's request parser now requires `jobKey`
// and a `segment` object, and folds both into the `plansHash` the execution grant is checked
// against. A body with neither is refused as `invalid_execution_request` before any sandbox is
// created, and would fail the grant scope check even if it were not. Every autofix round has been
// returning HTTP 400.
//
// So the loop moves here and both callers drive it. The broker contract is now stated in exactly
// one place, which is the property that was missing when it changed underneath autofix.
//
// `fetchImpl`, `checkpoint` and `assertActive` are injected rather than imported: this loop is the
// part with no test coverage - the segment primitives it calls are well covered in
// `packages/runner/test/executionSegments.test.ts`, the orchestration around them was not - and
// injecting the three effects is what lets it be driven against a fake broker.

import {
  BROKER_REQUEST_TIMEOUT_MS, executionSegmentCursor, firstExecutionSegment, nextExecutionSegment,
  diagnosticRerunAllowed, SANDBOX_DIAGNOSTIC_RERUN_LIMIT, segmentRunsInSandbox, stampCredentialTeardown,
  type CheckResult, type CommandPlan, type DiagnosticRun, type ExecutionRevision, type ExecutionSegment,
  type ExecutionStage, type SegmentPlanState,
} from "@buildit/runner";
import { issueExecutionGrant } from "@buildit/security";
import { EXECUTION_LEASE_MS } from "@buildit/contracts";
import { sha256Json, type ExecutionResponse, type ScannerSummary } from "./validationEvidence";

export type SegmentOutput = { planId: string; text: string; truncated: boolean; evidenceTruncated: boolean };
export type SegmentSide = { credentialTeardownProved?: boolean; stopped?: boolean; results: CheckResult[]; outputs: SegmentOutput[]; diagnostics: Record<string, DiagnosticRun[]> };
export type SegmentResponse = { segment: ExecutionSegment; base: SegmentSide; head: SegmentSide; scanners?: { base: ScannerSummary; head: ScannerSummary }; error?: string };
export type RevisionEvidence = { credentialTeardownProved: boolean; stopped: boolean; results: CheckResult[]; outputs: SegmentOutput[]; diagnostics: Record<string, DiagnosticRun[]> };

export const emptyEvidence = (): RevisionEvidence => ({ credentialTeardownProved: false, stopped: false, results: [], outputs: [], diagnostics: {} });

export function merge(into: RevisionEvidence, from: SegmentSide | undefined) {
  if (!from) return;
  into.credentialTeardownProved ||= Boolean(from.credentialTeardownProved);
  into.stopped ||= Boolean(from.stopped);
  into.results.push(...(from.results ?? []));
  into.outputs.push(...(from.outputs ?? []));
  for (const [planId, runs] of Object.entries(from.diagnostics ?? {})) into.diagnostics[planId] = [...(into.diagnostics[planId] ?? []), ...runs];
}

type Descriptor = { revision: ExecutionRevision; artifactId: string; storageKey: string; checksum: string; size: number; readGrant: string };

export type SegmentCheckpoint = (input: {
  requestKey: string; expectedVersion: number; expectedStage: ExecutionStage; nextStage: ExecutionStage;
  cursor: string; durationMs: number; now: number; holdLeaseUntil: number;
}) => Promise<{ stateVersion: number }>;

export type DriveSegmentsInput = {
  brokerUrl: string;
  executionSecret: Buffer;
  /** Re-issued per segment: an artifact read grant is single-use with a sixty second life. */
  describe: () => Descriptor[];
  artifactsHash: string;
  organizationId: string; repositoryId: string; reviewId: string;
  baseSha: string; headSha: string; runnerImageVersion: string;
  runtime: "node22" | "node24";
  install?: CommandPlan;
  checks: CommandPlan[];
  jobKey: string; runId: string;
  revisions: ExecutionRevision[];
  stage: ExecutionStage;
  stateVersion: number;
  /** What a `checks` segment leaves behind for the diagnostics segment to rerun. */
  rerunTargets: (evidence: Record<ExecutionRevision, RevisionEvidence>) => SegmentPlanState["diagnostics"];
  assertActive: () => Promise<void>;
  checkpoint: SegmentCheckpoint;
  /** Prefixes the failure thrown when the broker refuses a segment. */
  failurePrefix: string;
  fetchImpl?: typeof fetch;
  nowImpl?: () => number;
};

export type DriveSegmentsResult = {
  evidence: Record<ExecutionRevision, RevisionEvidence>;
  scanners?: { base: ScannerSummary; head: ScannerSummary };
  segments: number;
  stage: ExecutionStage;
  stateVersion: number;
  tailStartedAt: number;
};

export async function driveExecutionSegments(input: DriveSegmentsInput): Promise<DriveSegmentsResult> {
  const doFetch = input.fetchImpl ?? fetch, now = input.nowImpl ?? Date.now;
  const { install, checks, revisions } = input;
  const evidence: Record<ExecutionRevision, RevisionEvidence> = { base: emptyEvidence(), head: emptyEvidence() };
  let scanners: { base: ScannerSummary; head: ScannerSummary } | undefined;
  const state: SegmentPlanState = { checks, installable: Boolean(install), installed: [], diagnostics: [] };
  let segment: ExecutionSegment | null = firstExecutionSegment();
  let stage = input.stage, stateVersion = input.stateVersion, segments = 0, tailStartedAt = now();

  while (segment) {
    const startedAt = now();
    if (segmentRunsInSandbox(segment, state)) {
      segments += 1;
      const artifacts = input.describe();
      // Single-use, 120 seconds, and re-issued here rather than once for the job: a segmented run is
      // minutes of sandbox work, and one grant reused across it would outlive its own replay window
      // and bind none of the segments it authorised.
      const executionGrant = issueExecutionGrant({
        organizationId: input.organizationId, repositoryId: input.repositoryId, reviewId: input.reviewId,
        baseSha: input.baseSha, headSha: input.headSha, artifactsHash: input.artifactsHash,
        plansHash: sha256Json({ runnerImageVersion: input.runnerImageVersion, runtime: input.runtime, install, checks, jobKey: input.jobKey, segment }),
        ttlMs: 120_000,
      }, input.executionSecret);
      // Re-checked immediately before every segment, not once for the run. A cancellation that
      // arrives after prepare must not buy six more minutes of sandbox time.
      await input.assertActive();
      const response = await doFetch(`${input.brokerUrl}/api/execute`, {
        method: "POST", headers: { authorization: `Bearer ${executionGrant}`, "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: input.organizationId, repositoryId: input.repositoryId, reviewId: input.reviewId,
          jobKey: input.jobKey, segment, baseSha: input.baseSha, headSha: input.headSha,
          runnerImageVersion: input.runnerImageVersion, runtime: input.runtime, artifacts, install, checks,
        }),
        signal: AbortSignal.timeout(BROKER_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        let code: string | undefined;
        try { code = (JSON.parse(detail) as { error?: string }).error; } catch { code = undefined; }
        throw new Error(code ?? `${input.failurePrefix}_${response.status}`);
      }
      const output = await response.json() as SegmentResponse;
      for (const revision of segment.revisions ?? revisions) merge(evidence[revision], output[revision]);
      if (output.scanners) scanners = output.scanners;
      if (segment.stage === "prepare" && revisions.some(revision => !evidence[revision].credentialTeardownProved)) throw new Error("credential_teardown_unproved");
      if (segment.stage === "install") state.installed = revisions.filter(revision => evidence[revision].results.some(item => item.planId === "install" && item.conclusion === "passed"));
      if (segment.stage === "checks") state.diagnostics = input.rerunTargets(evidence);
    }
    const next: ExecutionSegment | null = nextExecutionSegment(segment, state);
    if (!next) { tailStartedAt = startedAt; break; }
    // The proof that no credential is reachable inside either sandbox is made once, by `prepare`,
    // and re-stamped onto every cursor after it. Before the split it travelled with the single
    // result object; now it has to survive six more HTTP requests to a stateless broker, and
    // re-probing per segment would make the claim cheap rather than durable.
    const checkpoint = await input.checkpoint({
      requestKey: `${input.runId}:${executionSegmentCursor(segment)}`, expectedVersion: stateVersion,
      expectedStage: stage, nextStage: next.stage, cursor: stampCredentialTeardown(executionSegmentCursor(segment), revisions),
      // Not clamped to EXECUTION_STAGE_LIMIT_MS. A segment that overran is exactly what
      // assertExecutionStageDuration exists to refuse, and a clamp would hide the drift the way
      // vercel.json's maxDuration and the plan budget hid theirs from each other for a release.
      durationMs: Math.max(0, now() - startedAt), now: now(),
      // Hold the lease across the gap to the next segment. Without this the job sits unleased
      // between invocations with this worker still driving it, and reconcileWorker's job sweep -
      // added to reap jobs nobody is driving - cannot tell the difference and kills a run that is
      // progressing normally. Re-claiming instead would spend an attempt per segment and exhaust
      // the six-attempt budget on a healthy run.
      holdLeaseUntil: now() + EXECUTION_LEASE_MS,
    });
    stateVersion = checkpoint.stateVersion;
    stage = next.stage;
    segment = next;
  }
  return { evidence, scanners, segments, stage, stateVersion, tailStartedAt };
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

/** The broker's single-call response shape, rebuilt from the evidence the segments returned. */
export function buildExecutionResponse(result: DriveSegmentsResult): ExecutionResponse {
  if (!result.scanners) throw new Error("scanner_evidence_incomplete");
  return {
    base: side(result.evidence.base), head: side(result.evidence.head),
    diagnostics: { base: diagnosticsFor(result.evidence.base), head: diagnosticsFor(result.evidence.head) },
    scanners: result.scanners,
  };
}

// Which check pairs earn a rerun, and on which revision. A rerun is diagnostic, not a retry: it
// exists to tell a genuine failure from a flaky one, so a revision whose first run passed never gets
// a second - one green rerun beside one red first run reads as flaky, which would turn a stable pass
// into "we could not tell".
export function rerunTargets(checks: Array<{ planId: string; required: boolean }>, evidence: Record<ExecutionRevision, RevisionEvidence>, revisions: readonly ExecutionRevision[]) {
  const targets: Array<{ planId: "install" | "test" | "lint" | "typecheck" | "build"; revisions: ExecutionRevision[] }> = [];
  for (const check of checks) {
    if (!check.required) continue;
    const wanted = revisions.filter(revision => diagnosticRerunAllowed(evidence[revision].diagnostics[check.planId] ?? [], 1 + SANDBOX_DIAGNOSTIC_RERUN_LIMIT));
    if (wanted.length) targets.push({ planId: check.planId as "test", revisions: wanted });
  }
  return targets;
}

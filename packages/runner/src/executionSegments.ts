import { createHash } from "node:crypto";
import { type CommandPlan, type NamedCommand, SANDBOX_ENV_PROBE_TIMEOUT_MS, SERVERLESS_SEGMENT_WORK_BUDGET_MS } from "./index.js";

/**
 * The sequencing of a segmented review, in one place.
 *
 * The broker is stateless between invocations and the worker holds the evidence, so only one of
 * them can decide what runs next, and it has to be the worker. What this module exists to prevent is
 * the worker deciding it in its own vocabulary while the broker validates it in another: that is the
 * shape behind three published contradictions in this codebase already, and importing the same
 * function is cheaper than keeping two ladders in step. The worker calls nextExecutionSegment; the
 * broker calls assertExecutionSegment on whatever arrives and refuses anything the signed plan does
 * not license.
 */

export type ExecutionRevision = "base" | "head";
export const executionRevisions = ["base", "head"] as const;

// The same names as the durable stages in @buildit/contracts, minus `complete` - that is a state the
// job reaches, not a unit of sandbox work anyone invokes the broker for.
export const segmentStages = ["prepare", "scanners", "install", "checks", "diagnostics", "compare"] as const;
export type SegmentStage = (typeof segmentStages)[number];

export type ExecutionSegment = {
  stage: SegmentStage;
  /** Which check pair, or which diagnostic rerun. Zero for the stages that happen exactly once. */
  index: number;
  planId?: NamedCommand;
  revisions?: ExecutionRevision[];
};

/** What the worker has learned so far, and the only thing the sequence depends on. */
export type SegmentPlanState = {
  checks: ReadonlyArray<Pick<CommandPlan, "planId">>;
  /** False when no package manager was detected: nothing to install, and so nothing to run. */
  installable: boolean;
  /**
   * Revisions whose install passed. A revision that did not install has every check recorded
   * not_run by the install segment itself - dropping those rows instead is what used to throw
   * paired_execution_incomplete and kill the review with no report - and is given no check work.
   * The other revision still runs its checks: an install that failed on one side does not make the
   * other side's evidence worth discarding.
   */
  installed: ReadonlyArray<ExecutionRevision>;
  /** Check pairs that earned a rerun, decided by the worker from the results it already holds. */
  diagnostics: ReadonlyArray<{ planId: NamedCommand; revisions: ExecutionRevision[] }>;
};

export function firstExecutionSegment(): ExecutionSegment {
  return { stage: "prepare", index: 0 };
}

// Every stage is walked, in order, even when it has nothing to do. Jumping over an empty one is the
// tempting shape and applyExecutionCheckpoint refuses it - advancing by more than a single stage is
// execution_stage_order_invalid - so a repository with no package manager, or one whose install
// failed, would checkpoint its way into a job it can never finish, leaving two sandboxes running
// because `compare` is where they are torn down.
export function nextExecutionSegment(current: ExecutionSegment, state: SegmentPlanState): ExecutionSegment | null {
  switch (current.stage) {
    case "prepare": return { stage: "scanners", index: 0 };
    case "scanners": return { stage: "install", index: 0 };
    case "install": return { stage: "checks", index: 0, ...checkWork(0, state) };
    case "checks": return checkWork(current.index + 1, state).planId
      ? { stage: "checks", index: current.index + 1, ...checkWork(current.index + 1, state) }
      : { stage: "diagnostics", index: 0, ...diagnosticWork(0, state) };
    case "diagnostics": return diagnosticWork(current.index + 1, state).planId
      ? { stage: "diagnostics", index: current.index + 1, ...diagnosticWork(current.index + 1, state) }
      : { stage: "compare", index: 0 };
    case "compare": return null;
  }
}

function checkWork(index: number, state: SegmentPlanState) {
  const plan = state.installable && state.installed.length ? state.checks[index] : undefined;
  return plan ? { planId: plan.planId as NamedCommand, revisions: [...state.installed] } : {};
}

function diagnosticWork(index: number, state: SegmentPlanState) {
  const target = state.diagnostics[index];
  return target && target.revisions.length ? { planId: target.planId, revisions: [...target.revisions] } : {};
}

/**
 * Whether this segment needs the broker at all.
 *
 * A failed install leaves every check not_run, and a repository with no package manager has no
 * checks to run, but both still have to walk `checks` and `diagnostics` to reach `compare`. Those
 * are checkpoints the worker writes on its own; sending them to the broker would resume two
 * sandboxes to do nothing.
 */
export function segmentRunsInSandbox(segment: ExecutionSegment, state: SegmentPlanState): boolean {
  if (segment.stage === "install") return state.installable;
  if (segment.stage === "checks" || segment.stage === "diagnostics") return Boolean(segment.planId);
  return true;
}

/**
 * The cursor written when this segment checkpoints. It must differ from the previous one whenever
 * the stage repeats, which is the whole loop guard in applyExecutionCheckpoint, so the index is in
 * it even for the stages that run once.
 */
export function executionSegmentCursor(segment: ExecutionSegment) {
  return `${segment.stage}:${segment.index}:${segment.planId ?? "none"}`;
}

/**
 * Names the sandbox a segment resumes.
 *
 * Derived rather than passed, so a caller cannot address a sandbox belonging to another review: the
 * job key is bound by the execution grant and everything downstream of it is a hash.
 */
export function executionSandboxName(jobKey: string, revision: ExecutionRevision) {
  if (!jobKey || jobKey.length > 200 || !executionRevisions.includes(revision)) throw new Error("execution_job_key_invalid");
  return `buildit-${createHash("sha256").update(`${jobKey} ${revision}`).digest("hex").slice(0, 32)}`;
}

type SegmentPlans = { install?: Pick<CommandPlan, "planId" | "timeoutMs">; checks: ReadonlyArray<Pick<CommandPlan, "planId" | "timeoutMs">> };

/**
 * The sandbox wall-clock this segment schedules on one revision, which is also what it costs: both
 * revisions run the same unit of work concurrently in two sandboxes. `diagnostics` reruns the plan
 * it names, so it costs what the check cost.
 */
export function segmentWorkMs(segment: ExecutionSegment, plans: SegmentPlans, scannerTimeoutMs: number) {
  switch (segment.stage) {
    case "prepare": return SANDBOX_ENV_PROBE_TIMEOUT_MS;
    case "scanners": return scannerTimeoutMs;
    case "install": return plans.install?.timeoutMs ?? 0;
    case "checks":
    case "diagnostics": return plans.checks.find(plan => plan.planId === segment.planId)?.timeoutMs ?? 0;
    case "compare": return 0;
  }
}

/** Refuses a segment the function ceiling cannot hold, or one the signed plan does not describe. */
export function assertExecutionSegment(segment: ExecutionSegment, plans: SegmentPlans, scannerTimeoutMs: number) {
  if (!segment || !segmentStages.includes(segment.stage)) throw new Error("invalid_execution_segment");
  if (!Number.isSafeInteger(segment.index) || segment.index < 0 || segment.index > 64) throw new Error("invalid_execution_segment");
  if (segment.stage === "install" && !plans.install) throw new Error("invalid_execution_segment");
  const carriesPlan = segment.stage === "checks" || segment.stage === "diagnostics";
  if (carriesPlan) {
    if (!segment.planId || !plans.checks.some(plan => plan.planId === segment.planId)) throw new Error("invalid_execution_segment");
    const revisions = segment.revisions ?? [];
    if (!revisions.length || revisions.length > executionRevisions.length || new Set(revisions).size !== revisions.length || revisions.some(revision => !executionRevisions.includes(revision))) throw new Error("invalid_execution_segment");
  } else if (segment.planId !== undefined || segment.revisions !== undefined) throw new Error("invalid_execution_segment");
  if (segmentWorkMs(segment, plans, scannerTimeoutMs) > SERVERLESS_SEGMENT_WORK_BUDGET_MS) throw new Error("sandbox_segment_budget_exceeded");
  return segment;
}

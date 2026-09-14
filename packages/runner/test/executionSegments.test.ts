import { describe, expect, it } from "vitest";
import { executionStages } from "@buildit/contracts";
import { defaultExecutionPlans, SANDBOX_SCANNER_TIMEOUT_MS, SERVERLESS_SEGMENT_WORK_BUDGET_MS } from "../src/index.js";
import { assertExecutionSegment, executionSandboxName, executionSegmentCursor, firstExecutionSegment, nextExecutionSegment, segmentRunsInSandbox, segmentStages, type ExecutionSegment, type SegmentPlanState } from "../src/executionSegments.js";

const plans = defaultExecutionPlans("pnpm");
const bothRevisions: Array<"base" | "head"> = ["base", "head"];

function walk(state: SegmentPlanState, onSegment: (segment: ExecutionSegment) => void = () => {}) {
  const walked: Array<{ segment: ExecutionSegment; ran: boolean }> = [];
  for (let segment: ExecutionSegment | null = firstExecutionSegment(); segment; segment = nextExecutionSegment(segment, state)) {
    const ran = segmentRunsInSandbox(segment, state);
    walked.push({ segment, ran });
    if (ran) onSegment(segment);
    if (walked.length > 32) throw new Error("segment_walk_did_not_terminate");
  }
  return walked;
}

const healthy = (): SegmentPlanState => ({ checks: plans.checks, installable: true, installed: [...bothRevisions], diagnostics: [] });

describe("the order a segmented review is walked in", () => {
  // applyExecutionCheckpoint refuses a jump of more than one stage, so a plan that skips an empty
  // stage checkpoints its way into a job it can never finish - and `compare` is where the two
  // sandboxes are torn down, so the cost of never reaching it is two live sandboxes per review.
  it("walks every declared stage even when a stage has nothing to do", () => {
    for (const state of [
      healthy(),
      { checks: [], installable: false, installed: [], diagnostics: [] } satisfies SegmentPlanState,
      { checks: plans.checks, installable: true, installed: [], diagnostics: [] } satisfies SegmentPlanState,
    ]) {
      const stages = walk(state).map(item => item.segment.stage);
      expect([...new Set(stages)]).toEqual([...segmentStages]);
      // The same order the durable record advances through, which is what the state machine enforces.
      expect([...new Set(stages)]).toEqual(executionStages.filter(stage => stage !== "complete"));
    }
  });

  it("asks the broker only for the segments that have work, and ends at compare", () => {
    const empty = walk({ checks: [], installable: false, installed: [], diagnostics: [] });
    expect(empty.filter(item => item.ran).map(item => item.segment.stage)).toEqual(["prepare", "scanners", "compare"]);
    const failedInstall = walk({ checks: plans.checks, installable: true, installed: [], diagnostics: [] });
    expect(failedInstall.filter(item => item.ran).map(item => item.segment.stage)).toEqual(["prepare", "scanners", "install", "compare"]);
  });

  it("gives each check pair and each rerun its own segment", () => {
    const state = healthy();
    state.diagnostics = [{ planId: "test", revisions: ["head"] }];
    const ran = walk(state).filter(item => item.ran).map(item => `${item.segment.stage}:${item.segment.planId ?? ""}`);
    expect(ran).toEqual(["prepare:", "scanners:", "install:", "checks:test", "checks:lint", "checks:typecheck", "diagnostics:test", "compare:"]);
  });

  // The cursor is the whole loop guard: applyExecutionCheckpoint allows a stage to repeat only when
  // the cursor moved, so two check pairs that produced the same cursor would be refused as a stalled
  // job and a review of three checks could never get past its first.
  it("gives every segment of a review a distinct cursor", () => {
    const state = healthy();
    state.diagnostics = [{ planId: "test", revisions: bothRevisions }];
    const cursors = walk(state).map(item => executionSegmentCursor(item.segment));
    expect(new Set(cursors).size).toBe(cursors.length);
  });

  // A revision whose install failed has every check recorded not_run by the install segment itself;
  // the other revision still runs them. Skipping both is the tempting simplification and it throws
  // away evidence the report has always shown.
  it("keeps running checks on the revision that did install", () => {
    const state: SegmentPlanState = { checks: plans.checks, installable: true, installed: ["head"], diagnostics: [] };
    const checks = walk(state).filter(item => item.ran && item.segment.stage === "checks");
    expect(checks).toHaveLength(plans.checks.length);
    for (const item of checks) expect(item.segment.revisions).toEqual(["head"]);
  });
});

describe("what a segment is allowed to address", () => {
  // The sandbox name is derived, never passed, so a caller holding a valid grant for one review
  // cannot resume another review's filesystem - and base and head must never share one.
  it("derives one opaque sandbox name per job and revision", () => {
    const first = executionSandboxName("validation:review-a:0:abc", "base");
    expect(first).toMatch(/^buildit-[0-9a-f]{32}$/);
    expect(first).not.toBe(executionSandboxName("validation:review-a:0:abc", "head"));
    expect(first).not.toBe(executionSandboxName("validation:review-b:0:abc", "base"));
    expect(first).toBe(executionSandboxName("validation:review-a:0:abc", "base"));
    expect(() => executionSandboxName("", "base")).toThrow("execution_job_key_invalid");
  });

  it("refuses a segment naming work the signed plan does not contain", () => {
    const signed = { install: plans.install, checks: plans.checks };
    expect(() => assertExecutionSegment({ stage: "checks", index: 0, planId: "build", revisions: bothRevisions }, signed, SANDBOX_SCANNER_TIMEOUT_MS)).toThrow("invalid_execution_segment");
    expect(() => assertExecutionSegment({ stage: "checks", index: 0, revisions: bothRevisions }, signed, SANDBOX_SCANNER_TIMEOUT_MS)).toThrow("invalid_execution_segment");
    expect(() => assertExecutionSegment({ stage: "diagnostics", index: 0, planId: "test", revisions: [] }, signed, SANDBOX_SCANNER_TIMEOUT_MS)).toThrow("invalid_execution_segment");
    expect(() => assertExecutionSegment({ stage: "prepare", index: 0, planId: "test" }, signed, SANDBOX_SCANNER_TIMEOUT_MS)).toThrow("invalid_execution_segment");
    expect(() => assertExecutionSegment({ stage: "install", index: 0 }, { checks: [] }, SANDBOX_SCANNER_TIMEOUT_MS)).toThrow("invalid_execution_segment");
  });

  // The ceiling the split exists for. A plan whose total fits the job budget can still hold one
  // check no 300-second function can run, and that is precisely the state the single pre-split
  // budget could not express.
  it("refuses a single segment the function ceiling cannot hold", () => {
    const heavy = { ...plans.checks[0]!, timeoutMs: SERVERLESS_SEGMENT_WORK_BUDGET_MS + 1 };
    expect(() => assertExecutionSegment({ stage: "checks", index: 0, planId: "test", revisions: bothRevisions }, { install: plans.install, checks: [heavy] }, SANDBOX_SCANNER_TIMEOUT_MS)).toThrow("sandbox_segment_budget_exceeded");
    expect(assertExecutionSegment({ stage: "checks", index: 0, planId: "test", revisions: bothRevisions }, { install: plans.install, checks: [{ ...heavy, timeoutMs: SERVERLESS_SEGMENT_WORK_BUDGET_MS }] }, SANDBOX_SCANNER_TIMEOUT_MS).stage).toBe("checks");
  });
});

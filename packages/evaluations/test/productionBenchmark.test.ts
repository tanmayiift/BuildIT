import { describe, expect, it } from "vitest";
import { findDetection } from "../src/detection";
import { historicalCases, historicalLabelDigest, historicalSetVersion } from "../src/historicalCases";
import { asReviewedFinding, recordFinding, runIsSettled, scoreRuns, type PublishedFinding, type RecordedFinding, type RunRecord, type RunsFile } from "../src/productionBenchmark";

const zod = historicalCases.find(item => item.id === "hist-zod-int16-off-by-one")!;
const clean = historicalCases.find(item => item.kind === "clean")!;
const found: PublishedFinding = { title: "int16 upper bound is 32768", severity: "high", blocking: true, resolution: "accepted",
  path: "packages/zod/src/v4/core/util.ts", startLine: 744, endLine: 747, impact: "Accepts a value outside int16.", explanation: "Fix NUMBER_FORMAT_RANGES." };
const warning: RecordedFinding = { title: "Style", path: "lib/utils.js", startLine: 1, endLine: 1, severity: "warning", blocking: true, resolution: "accepted", mentions: [] };

let at = 0;
const valid = (caseId: string, findings: RecordedFinding[], extra: Partial<RunRecord> = {}): RunRecord =>
  ({ caseId, run: ++at, attempt: 1, at: "t", validity: "valid", status: "inconclusive", promptVersions: { findings: "findings-v6" }, reviewId: `r${at}`, costUsd: 0.1, findings, ...extra });
const file = (runs: RunRecord[]): RunsFile => ({ kind: "buildit-production-benchmark-runs", setVersion: historicalSetVersion, labelDigest: historicalLabelDigest(), label: "R0", provider: "openai", runsPerCase: 3, startedAt: "t", runs });
const outcome = (scored: ReturnType<typeof scoreRuns>, caseId: string) => scored.cases.find(item => item.caseId === caseId)?.outcome;

describe("recording a finding", () => {
  it("scores the same recorded as it did live, without keeping the model's prose", () => {
    const variants: PublishedFinding[] = [found, { ...found, path: "packages/zod/src/v4/core/compile.ts" }, { ...found, path: "packages/zod/src/v4/core/checks.ts" },
      { ...found, severity: "warning" }, { ...found, blocking: false }, { ...found, title: "Unrelated", impact: "Nothing.", explanation: "Nothing." }, { ...found, resolution: "uncertain" }];
    for (const finding of variants) {
      const recorded = recordFinding(zod, finding);
      expect(recorded).not.toHaveProperty("impact");
      expect(recorded).not.toHaveProperty("explanation");
      expect(Boolean(findDetection(zod, [asReviewedFinding(recorded, "published")]))).toBe(Boolean(findDetection(zod, [finding])));
    }
  });
});

describe("scoring production runs", () => {
  it("counts a defect detected only when most valid runs found it", () => {
    const hit = recordFinding(zod, found);
    expect(outcome(scoreRuns(file([valid(zod.id, [hit]), valid(zod.id, [hit]), valid(zod.id, [])]), "published"), zod.id)).toBe("detected");
    expect(outcome(scoreRuns(file([valid(zod.id, [hit]), valid(zod.id, []), valid(zod.id, [])]), "published"), zod.id)).toBe("missed");
  });

  it("never scores a platform failure as a miss", () => {
    const failed: RunRecord = { caseId: zod.id, run: 9, attempt: 1, at: "t", validity: "invalid_platform", because: "review ended platform_failed" };
    const scored = scoreRuns(file([valid(zod.id, []), failed, { ...failed, attempt: 2 }]), "published");
    expect(outcome(scored, zod.id)).toBeUndefined();
    expect(scored.excluded).toEqual([{ caseId: zod.id, because: "only 1 valid run; not scored" }]);
    expect(scored.details[0]).toMatchObject({ validRuns: 1, invalidPlatform: 2 });
  });

  it("calls the clean control blocked if any one run blocked it, by a finding or by a check", () => {
    expect(outcome(scoreRuns(file([valid(clean.id, []), valid(clean.id, []), valid(clean.id, [])]), "published"), clean.id)).toBe("clean_pass");
    expect(outcome(scoreRuns(file([valid(clean.id, []), valid(clean.id, [warning]), valid(clean.id, [])]), "published"), clean.id)).toBe("false_blocking");
    expect(outcome(scoreRuns(file([valid(clean.id, []), valid(clean.id, [], { status: "changes_requested" }), valid(clean.id, [])]), "published"), clean.id)).toBe("false_blocking");
  });

  it("rescores the same runs as if only critical and high could block", () => {
    // The warning that blocked the clean control under the published policy is advisory under the new one.
    const runs = file([valid(clean.id, []), valid(clean.id, [warning], { status: "changes_requested" }), valid(clean.id, [])]);
    expect(outcome(scoreRuns(runs, "critical-high"), clean.id)).toBe("clean_pass");
    // And a defect found only at warning severity was never a blocking detection.
    const low = recordFinding(zod, { ...found, severity: "warning" });
    expect(outcome(scoreRuns(file([valid(zod.id, [low]), valid(zod.id, [low])]), "critical-high"), zod.id)).toBe("missed");
  });

  it("refuses runs scored against different labels or straddling two prompt versions", () => {
    expect(() => scoreRuns({ ...file([]), labelDigest: "0".repeat(64) }, "published")).toThrow(/eval_production_labels_changed/);
    expect(() => scoreRuns(file([valid(zod.id, []), valid(zod.id, [], { promptVersions: { findings: "findings-v7" } })]), "published")).toThrow(/eval_production_prompt_mixed:findings/);
  });

  it("writes the shape pnpm eval:compare reads", () => {
    const scored = scoreRuns(file([valid(zod.id, []), valid(zod.id, [])]), "published");
    expect(scored).toMatchObject({ setVersion: historicalSetVersion, promptVersion: "findings-v6", cases: [{ caseId: zod.id, outcome: "missed" }] });
  });
});

describe("resuming a run", () => {
  it("retries a platform failure twice, then stops", () => {
    const failed = (attempt: number): RunRecord => ({ caseId: "c", run: 1, attempt, at: "t", validity: "invalid_platform" });
    expect(runIsSettled([], "c", 1)).toBe(false);
    expect(runIsSettled([failed(1), failed(2)], "c", 1)).toBe(false);
    expect(runIsSettled([failed(1), failed(2), failed(3)], "c", 1)).toBe(true);
    expect(runIsSettled([failed(1), { ...failed(2), validity: "valid" }], "c", 1)).toBe(true);
  });
});

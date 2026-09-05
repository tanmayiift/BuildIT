import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeReviewDecision } from "@buildit/contracts";

// Three times now, one review has published a GitHub check run that contradicted the comment
// printed beside it, and every time the cause was the same: the verdict was derived twice.
//
//   1. reportChecks excluded checks already failing on the base commit; finalizeDecision did not.
//      zod#1 posted "Ready for human review" with a red "Changes need review" badge next to it,
//      written one second apart.
//   2. pairExecutionEvidence reclassifies a check that failed then passed on rerun as "flaky", and
//      that only reached checkRuns. The report read raw broker output and still saw "failed".
//   3. finalizeDecision escalated a twice-uncertain finding to a person and treated an unscoped
//      prompt-injection signal as a missing required check; computeReviewDecision had no branch
//      for the first and called the second what it was.
//
// Each was fixed by teaching one of the two derivations a rule the other already knew, which is
// why there was a next one. finalizeDecision now calls computeReviewDecision instead of restating
// the ladder, and these tests exist to keep it that way: the first pins the property that matters
// to a reader, the second pins the structure that delivers it.

const convexRoot = join(import.meta.dirname, "../../convex");
const finalize = readFileSync(join(convexRoot, "reviewValidationData.ts"), "utf8");
const validationWorker = readFileSync(join(convexRoot, "reviewValidationWorker.ts"), "utf8");

describe("the verdict is decided in exactly one place", () => {
  it("routes finalizeDecision through the orchestrator's decision", () => {
    // @buildit/contracts and not @buildit/orchestrator: the orchestrator is Node-only, and a
    // default-runtime Convex mutation importing it is what forced the second copy to exist.
    expect(finalize).toContain('import { computeReviewDecision } from "@buildit/contracts"');
    expect(finalize).toContain("const decision = computeReviewDecision({");
    expect(finalize).toContain("const statusReasonCode = decision.reason;");
    expect(finalize).toContain("const nextActionCode = decision.nextAction;");
  });

  it("does not re-derive the ladder beside the call", () => {
    // The shapes the three shipped bugs actually took. Each is a condition computeReviewDecision
    // already decides, restated locally so the two answers could drift.
    const body = finalize.slice(finalize.indexOf("export const finalizeDecision"));
    const code = body.split("\n").filter(line => !line.trim().startsWith("//")).join("\n");
    expect(code).not.toContain('"changes_requested" as const :');
    expect(code).not.toMatch(/failed \|\| blocking \? "inspect_findings"/);
  });

  it("hands the report the same conclusions the database gets", () => {
    // pairExecutionEvidence mutates conclusions; storing the raw broker response beside a paired
    // fingerprint is what let the two readers disagree about whether a check failed.
    expect(validationWorker).toContain("output: reconciledOutput");
    expect(validationWorker).toContain("const pairedConclusions = new Map(paired.summaries.map");
  });
});

describe("the conditions that used to disagree", () => {
  const passing = { name: "test", required: true, conclusion: "passed" as const, evidenceComplete: true };

  it("escalates a finding the critic could not resolve twice, rather than passing it", () => {
    const decision = computeReviewDecision({
      isStale: false, environmentAvailable: true, uncertainEscalated: true,
      checks: [passing], findings: [],
    });
    expect(decision).toMatchObject({ status: "inconclusive", reason: "human_review_required", nextAction: "inspect_findings" });
  });

  it("calls an unscoped injection signal what it is, not a missing check", () => {
    const decision = computeReviewDecision({
      isStale: false, environmentAvailable: true, injectionUnscoped: true,
      checks: [passing], findings: [],
    });
    // "retry_review" was the old answer here, and retrying is the one response that cannot help:
    // the same planted text is still in the same diff on the next run.
    expect(decision).toMatchObject({ status: "inconclusive", reason: "prompt_injection_unscoped", nextAction: "human_merge" });
  });

  it("refuses to pass a review that ran no required check at all", () => {
    const decision = computeReviewDecision({
      isStale: false, environmentAvailable: true,
      checks: [{ name: "lint", required: false, conclusion: "passed", evidenceComplete: true }], findings: [],
    });
    expect(decision.status).toBe("inconclusive");
  });

  it("still passes an ordinary green review", () => {
    // The negative control. Without it every assertion above is satisfied by a function that
    // always returns inconclusive.
    const decision = computeReviewDecision({
      isStale: false, environmentAvailable: true, checks: [passing], findings: [],
    });
    expect(decision).toMatchObject({ status: "checks_passed", reason: "checks_complete", nextAction: "none" });
  });
});

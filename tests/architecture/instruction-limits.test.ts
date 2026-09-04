import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyInjectionPolicy } from "../../packages/orchestrator/src/promptChain";

// Per-path instructions are text a repository controls, arriving in a model prompt. They may steer
// attention and nothing else, and the reason they cannot do more is structural rather than a rule
// somebody remembered to write:
//
//   the evidence gate runs on evidence after the model has spoken, and never reads a prompt;
//   scanners are processes in a sandbox and never see a prompt at all;
//   the verdict is computed from checks and gated findings, not from prompt text.
//
// What could go wrong is attribution. If an injection signal inside an instruction came back
// "unknown" instead of "narrative", one instruction containing instruction-like text would fail
// the entire review closed - the false alarm that was fixed once already.
const read = (path: string) => readFileSync(join(import.meta.dirname, "../..", path), "utf8");

describe("what a path instruction can reach", () => {
  it("is attributed as narrative, so it cannot fail a review closed on its own", () => {
    const chain = read("packages/orchestrator/src/promptChain.ts");
    const narrative = chain.split("\n").find(line => line.includes("const narrativeSignal="));
    expect(narrative).toContain("reviewInstructions");
  });

  it("leaves a finding about other code alone when the signal came from configuration", () => {
    // A signal in the instructions is scoped to the instruction surface. A finding about a file the
    // signal has nothing to do with must keep its confidence, or configuration text could quietly
    // downgrade findings about code it never mentioned.
    const value = applyInjectionPolicy(
      "findings",
      { findings: [{ id: "f1", path: "src/a.ts", confidence: 0.9 }] },
      [{ path: "$.pull.reviewInstructions[0]", pattern: "instruction_override", excerptHash: "x" }] as never,
      { unscoped: false, paths: new Set(["src/other.ts"]), surfaces: new Set(["narrative" as const]) },
      [],
    );
    expect((value.findings as Array<{ confidence: number }>)[0]!.confidence).toBe(0.9);
  });

  it("is bounded before it reaches the prompt", () => {
    const config = read("packages/orchestrator/src/repositoryConfig.ts");
    expect(config).toContain("maxInstructionBudget");
    const worker = read("convex/reviewAnalysisWorker.ts");
    expect(worker).toContain("reviewInstructions: (pull.reviewInstructions ?? []).slice(0, 20)");
    expect(worker).toContain("redactForModel");
  });

  it("never reaches a scanner, which runs in a sandbox with no prompt", () => {
    expect(read("packages/scanners/src/index.ts")).not.toContain("instruction");
  });
});

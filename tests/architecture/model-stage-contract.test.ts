import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { modelStages, nonChainStages, promptChainStages } from "../../packages/security/src/model-grant";
import { promptStages } from "../../packages/orchestrator/src/promptChain";
import { uncertainEscalationLimit } from "@buildit/orchestrator";

it("binds model grants to the exact executable prompt-chain stages", () => {
  expect(promptChainStages).toEqual(promptStages);
});

// A grant may only be minted for a stage that can actually run. Chain stages are checked above; a
// stage outside the chain has to be declared deliberately, so a typo cannot invent one and a real
// addition cannot arrive unnoticed.
it("grants nothing outside the chain except what was declared on purpose", () => {
  expect(modelStages).toEqual([...promptChainStages, ...nonChainStages]);
  expect(nonChainStages).toEqual(["ask"]);
});

// The escalation limit lives in two runtimes: the planner decides it, and the verdict enforces it.
// The orchestrator is a Node-only package and cannot be imported into the default Convex runtime,
// so the number is restated - and a restated number drifts unless something says it must not.
describe("the escalation limit is one number", () => {
  it("matches between the planner and the verdict", () => {
    const source = readFileSync(join(import.meta.dirname, "../../convex/reviewValidationData.ts"), "utf8");
    expect(source).toContain(`const uncertainEscalationLimit = ${uncertainEscalationLimit};`);
  });
});

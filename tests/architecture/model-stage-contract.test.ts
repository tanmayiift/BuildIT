import { expect, it } from "vitest";
import { modelStages } from "../../packages/security/src/model-grant";
import { promptStages } from "../../packages/orchestrator/src/promptChain";

it("binds model grants to the exact executable prompt-chain stages", () => {
  expect(modelStages).toEqual(promptStages);
});

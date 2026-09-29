import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { selectCriticModel, selectFindingsModel } from "../reviewAnalysisWorker";

// The escalation ladder compared the critic against scope.model. criticRoute is derived from
// findingsModel, and selectFindingsModel can move the findings stage off scope.model - so the one
// configuration with a genuinely independent second model was the one that refused to use it.
describe("the critic is independent of the model that produced the findings", () => {
  it("is a different model from findings on a dual-model OpenAI credential", () => {
    const available = ["gpt-5.4", "gpt-5.4-mini"];
    const findingsModel = selectFindingsModel("openai", "gpt-5.4-mini", available);
    const critic = selectCriticModel("openai", findingsModel, available);
    expect(critic.independent).toBe(true);
    // The gate must compare against this, not against the review's configured model.
    expect(critic.model).not.toBe(findingsModel);
    // And on this credential the critic *equals* scope.model, which is what the old gate compared
    // against - so comparing there is what switched the ladder off.
    expect(critic.model).toBe("gpt-5.4-mini");
  });

  it("gates on findingsModel in the analysis worker, not on the review's configured model", () => {
    const source = readFileSync(join(process.cwd(), "convex/reviewAnalysisWorker.ts"), "utf8");
    expect(source).toContain("criticRoute.model === findingsModel");
    expect(source, "comparing the critic against scope.model is the defect").not.toContain("criticRoute.model === scope.model");
  });

  it("reports no independence when the credential exposes one model", () => {
    const critic = selectCriticModel("openai", "gpt-5.4-mini", ["gpt-5.4-mini"]);
    expect(critic.independent).toBe(false);
  });
});

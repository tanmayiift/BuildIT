import { describe, expect, it } from "vitest";
import { summarizeActivation } from "./activation.js";

describe("activation timing", () => {
  it("reports source-free durations and outcomes", () => {
    expect(summarizeActivation({ identityAt: 100, repositoryAt: 200, previewAt: 400, reviewAt: 450, evidenceAt: 700, humanDecisionAt: 900 }, ["delivered", "platform_failed", "analyzing"])).toEqual({
      times: { identityAt: 100, repositoryAt: 200, previewAt: 400, reviewAt: 450, evidenceAt: 700, humanDecisionAt: 900 }, chronologyValid: true,
      durationMs: { identityToRepository: 100, repositoryToPreview: 200, previewToReview: 50, reviewToFirstEvidence: 250, identityToFirstEvidence: 600, firstEvidenceToHumanDecision: 200 },
      outcomes: { started: 3, completed: 1, failed: 1, active: 1 },
    });
  });
  it("does not invent missing durations and exposes invalid clock order", () => {
    const result = summarizeActivation({ identityAt: 200, repositoryAt: 100, evidenceAt: 300 }, ["cancelled"]);
    expect(result.chronologyValid).toBe(false);
    expect(result.durationMs.identityToRepository).toBeUndefined();
    expect(result.durationMs.firstEvidenceToHumanDecision).toBeUndefined();
    expect(result.outcomes).toEqual({ started: 1, completed: 0, failed: 1, active: 0 });
  });
});

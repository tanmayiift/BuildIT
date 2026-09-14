import { describe, expect, it } from "vitest";
import { summarizeActivation } from "./activation.js";

describe("activation timing", () => {
  it("reports source-free durations and outcomes", () => {
    expect(summarizeActivation({ identityAt: 100, repositoryAt: 200, previewAt: 400, reviewAt: 450, evidenceAt: 700, humanDecisionAt: 900 }, ["delivered", "platform_failed", "analyzing"])).toEqual({
      times: { identityAt: 100, repositoryAt: 200, previewAt: 400, reviewAt: 450, evidenceAt: 700, humanDecisionAt: 900 }, chronologyValid: true,
      durationMs: { identityToRepository: 100, repositoryToPreview: 200, previewToReview: 50, reviewToFirstEvidence: 250, identityToFirstEvidence: 600, firstEvidenceToHumanDecision: 200 },
      outcomes: { started: 3, completed: 1, concluded: 1, decisive: 1, failed: 1, active: 1 },
    });
  });
  // The reason concluded and decisive are separate numbers. An inconclusive review finished and
  // reported back - the funnel completed - and told the author nothing about their code, so it is
  // not a successful QA review. Counting it as one is what made activation.ts and publicProof.ts
  // publish different answers to the same question.
  it("counts an inconclusive review as concluded but not decisive", () => {
    const result = summarizeActivation({ identityAt: 1, evidenceAt: 2 }, ["inconclusive", "checks_passed", "platform_failed"]);
    expect(result.outcomes).toEqual({ started: 3, completed: 2, concluded: 2, decisive: 1, failed: 1, active: 0 });
  });

  // failed_after_bounds was in one set in this file and missing from the count beside it, so the
  // funnel reported it as neither concluded nor failed - it silently vanished into "active".
  it("counts a run that exhausted its bounds as concluded, and never as still running", () => {
    const result = summarizeActivation({ identityAt: 1 }, ["failed_after_bounds"]);
    expect(result.outcomes.concluded).toBe(1);
    expect(result.outcomes.decisive).toBe(0);
    expect(result.outcomes.active).toBe(0);
  });

  it("does not invent missing durations and exposes invalid clock order", () => {
    const result = summarizeActivation({ identityAt: 200, repositoryAt: 100, evidenceAt: 300 }, ["cancelled"]);
    expect(result.chronologyValid).toBe(false);
    expect(result.durationMs.identityToRepository).toBeUndefined();
    expect(result.durationMs.firstEvidenceToHumanDecision).toBeUndefined();
    expect(result.outcomes).toEqual({ started: 1, completed: 0, concluded: 0, decisive: 0, failed: 1, active: 0 });
  });
});

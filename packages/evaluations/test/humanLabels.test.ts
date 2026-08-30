import { describe, expect, it } from "vitest";
import { createBlindAssignments, reviewerAgreement } from "../src/humanLabels.js";
import type { HumanLabelManifest } from "../src/releaseEvidence.js";

const a = "a".repeat(64), b = "b".repeat(64), c = "c".repeat(64);
describe("blind human label workflow", () => {
  it("assigns Critical cases to two independent reviewers and a separate adjudicator", () => {
    const result = createBlindAssignments({ version: "labels-v1", cases: [{ caseId: "critical-1", severity: "critical" }, { caseId: "low-1", severity: "low" }], reviewerHashes: [a, b], adjudicatorHashes: [c] });
    expect(result.assignments[0]).toMatchObject({ reviewerHashes: [a, b], adjudicatorHash: c });
    expect(result.assignments[1]?.reviewerHashes).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("expected");
  });
  it("rejects duplicate identities and cases", () => {
    expect(() => createBlindAssignments({ version: "v1", cases: [{ caseId: "one", severity: "critical" }], reviewerHashes: [a, a], adjudicatorHashes: [c] })).toThrow("blind_assignment_input_invalid");
    expect(() => createBlindAssignments({ version: "v1", cases: [{ caseId: "one", severity: "critical" }, { caseId: "one", severity: "low" }], reviewerHashes: [a, b], adjudicatorHashes: [c] })).toThrow("blind_assignment_case_invalid");
  });
  it("reports agreement and Cohen's kappa from overlapping blinded votes", () => {
    const labels: HumanLabelManifest = { version: "v1", modelRunStartedAt: 10, blindToModelOutput: true, hiddenHoldout: true, cases: [
      { caseId: "one", severity: "critical", finalExpected: true, votes: [{ reviewerHash: a, expected: true }, { reviewerHash: b, expected: true }], labelledAt: 1, synthetic: false },
      { caseId: "two", severity: "critical", finalExpected: false, votes: [{ reviewerHash: a, expected: false }, { reviewerHash: b, expected: false }], labelledAt: 1, synthetic: false },
    ] };
    expect(reviewerAgreement(labels)).toEqual({ overlappingCases: 2, agreedCases: 2, percentAgreement: 1, cohenKappa: 1 });
  });
});

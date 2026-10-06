import { describe, expect, it } from "vitest";
import { blockingSeverities, severityBlocks } from "../../packages/contracts/src/severityPolicy.js";
import { detectionCases } from "../../packages/evaluations/src/detectionCases.js";
import { historicalCases } from "../../packages/evaluations/src/historicalCases.js";
import { arbitrateFindings, type FindingCandidate } from "../../packages/orchestrator/src/findings.js";

// One rule decides what blocks a merge. These pin that arbitration applies it and that no evaluation
// label expects a block the rule cannot produce - a label like that scores every reviewer as missing it.
describe("only critical and high findings block", () => {
  it("is the rule arbitration applies to every severity", () => {
    const candidate: FindingCandidate = { id: "f-1", title: "t", category: "logic", severity: "info", confidence: 0.9, path: "a.ts", startLine: 1, endLine: 1, evidenceIds: ["ev-1"], impact: "i", explanation: "e", origin: "model" };
    for (const severity of ["critical", "high", "warning", "info"] as const) {
      const [arbitrated] = arbitrateFindings([{ ...candidate, severity }], [{ findingId: "f-1", verdict: "supported", missingEvidenceIds: [], injectionDetected: false }]);
      expect(arbitrated?.blocking, severity).toBe(severityBlocks(severity));
    }
    expect([...blockingSeverities]).toEqual(["critical", "high"]);
  });

  it("is what every evaluation label that expects a block asks for", () => {
    const labels = [...detectionCases, ...historicalCases].filter(item => item.expect?.blocking);
    expect(labels.length).toBeGreaterThan(10);
    for (const item of labels) expect(severityBlocks(item.expect!.severityAtLeast), item.id).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import { detectionCases } from "../src/detectionCases.js";
import { runDetectionCase, runDetectionSuite } from "../src/detectionRunner.js";

// The runner puts model output through the same validation and arbitration a production review
// uses, so a finding the validator drops or the critic disproves cannot count as a detection here
// either. These tests script the model so the pipeline is what is under test, not a provider.

const rounding = detectionCases.find(item => item.id === "det-round-half-cent")!;
const evidenceIdFor = (files: readonly { path: string }[], path: string) => {
  void files;
  void path;
  return undefined;
};

function scripted(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (request: { stage: string; input: string }) => {
    const evidenceId = /"evidenceId":"([^"]+)"/.exec(request.input)?.[1] ?? "missing";
    const byStage: Record<string, unknown> = {
      requirements: { requirements: [] },
      review_plan: { checks: [], evidenceOperations: [], riskAreas: [], exclusions: [] },
      findings: {
        findings: [{
          id: "f1", title: "Half-cent values like 1.005 round down incorrectly", category: "correctness",
          severity: "high", confidence: 0.9, path: "src/currency.js", startLine: 3, endLine: 3,
          evidenceIds: [evidenceId], impact: "Money is understated by a paisa on half-cent values.",
          explanation: "Math.round on a binary float mis-rounds 1.005.", criterionId: "",
        }],
      },
      critic: { decisions: [{ findingId: "f1", verdict: "supported", missingEvidenceIds: [], injectionDetected: false, explanation: "evidence supports it" }] },
      arbitration: { findings: [] },
      report: { claims: [] },
      ...overrides,
    };
    return {
      value: byStage[request.stage] ?? {}, provider: "anthropic" as const, model: "claude-sonnet-4-5",
      finishReason: "stop", inputTokens: 10, outputTokens: 5,
    };
  });
}

describe("detection runner", () => {
  it("credits a finding that survives validation and the critic", async () => {
    const result = await runDetectionCase(rounding, scripted());
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ path: "src/currency.js", blocking: true, resolution: "accepted" });
  });

  // A finding citing evidence it was never given is a hallucination; production drops it, so the
  // eval must not reward it.
  it("drops a finding that cites evidence it was not given", async () => {
    const invoke = scripted({
      findings: {
        findings: [{
          id: "f1", title: "Half-cent values like 1.005 round down incorrectly", category: "correctness",
          severity: "high", confidence: 0.9, path: "src/currency.js", startLine: 3, endLine: 3,
          evidenceIds: ["source-invented"], impact: "x", explanation: "y", criterionId: "",
        }],
      },
    });
    const result = await runDetectionCase(rounding, invoke);
    expect(result.findings).toHaveLength(0);
  });

  it("does not credit a finding the critic disproved", async () => {
    const invoke = scripted({
      critic: { decisions: [{ findingId: "f1", verdict: "unsupported", missingEvidenceIds: [], injectionDetected: false, explanation: "the cited lines do not show it" }] },
    });
    const result = await runDetectionCase(rounding, invoke);
    expect(result.findings.every(finding => finding.resolution === "rejected")).toBe(true);
  });

  it("scores a whole suite and names what was missed", async () => {
    const empty: Record<string, unknown> = {
      requirements: { requirements: [] },
      review_plan: { checks: [], evidenceOperations: [], riskAreas: [], exclusions: [] },
      findings: { findings: [] },
      critic: { decisions: [] },
      arbitration: { findings: [] },
      report: { claims: [] },
    };
    const silent = vi.fn(async (request: { stage: string }) => ({
      value: empty[request.stage] ?? {},
      provider: "anthropic" as const, model: "claude-sonnet-4-5", finishReason: "stop", inputTokens: 1, outputTokens: 1,
    }));
    const report = await runDetectionSuite({ invoke: silent, cases: detectionCases });
    // A reviewer that says nothing passes the clean control and fails every defect.
    expect(report.detected).toBe(0);
    expect(report.missed).toContain("det-round-half-cent");
    expect(report.falseBlocking).toEqual([]);
    expect(report.passed).toBe(false);
  });

  // One broken case must not hide the rest of the run.
  it("counts a case that throws as a miss and keeps going", async () => {
    let calls = 0;
    const flaky = vi.fn(async (request: { stage: string }) => {
      calls += 1;
      if (calls === 1) throw new Error("provider_unavailable");
      const shapes: Record<string, unknown> = { requirements: { requirements: [] }, review_plan: { checks: [], evidenceOperations: [], riskAreas: [], exclusions: [] }, findings: { findings: [] }, critic: { decisions: [] }, arbitration: { findings: [] }, report: { claims: [] } };
      return { value: shapes[request.stage] ?? {}, provider: "anthropic" as const, model: "m", finishReason: "stop", inputTokens: 1, outputTokens: 1 };
    });
    const report = await runDetectionSuite({ invoke: flaky, cases: detectionCases });
    expect(report.total).toBe(detectionCases.length);
    expect(report.outcomes).toHaveLength(detectionCases.length);
  });
});

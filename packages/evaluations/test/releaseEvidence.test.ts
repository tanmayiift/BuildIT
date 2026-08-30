import { describe, expect, it } from "vitest";
import { humanLabelFailures, officialPopulation, populationFailures, releaseEvidenceGate, type HumanLabelManifest } from "../src/releaseEvidence.js";
import type { EvaluationRun } from "../src/score.js";

const reviewer = "a".repeat(64), second = "b".repeat(64), adjudicator = "c".repeat(64);
const run: EvaluationRun = { setVersion: "holdout-v1", promptVersion: "prompt-v1", findings: [{ caseId: "case-1", language: "typescript", risk: "critical", defectFamily: "regression", expected: true, surfaced: true, expectedSeverity: "critical", predictedSeverity: "critical", evidenceSupported: true, repeatGroup: "case-1", repetition: 0 }], patches: [], latencyMs: [1], costUsd: [0] };
const labels: HumanLabelManifest = { version: "labels-v1", modelRunStartedAt: 200, blindToModelOutput: true, hiddenHoldout: true, cases: [{ caseId: "case-1", severity: "critical", finalExpected: true, votes: [{ reviewerHash: reviewer, expected: true }, { reviewerHash: second, expected: true }], labelledAt: 100, synthetic: false }] };

describe("release evidence governance", () => {
  it("pins the complete official populations and contamination boundary", () => { expect(populationFailures(officialPopulation)).toEqual([]); expect(officialPopulation.artifacts.map(item => item.cases)).toEqual([196, 155, 500]); expect(Object.keys(officialPopulation.languages)).toHaveLength(10); });
  it("accepts blind pre-run labels with two independent Critical reviewers", () => expect(humanLabelFailures(labels, run)).toEqual([]));
  it("rejects post-run, synthetic, single-reviewer, mismatched and unadjudicated labels", () => {
    const broken = { ...labels, cases: [{ ...labels.cases[0]!, finalExpected: false, labelledAt: 300, synthetic: true as false, votes: [{ reviewerHash: reviewer, expected: true }] }] };
    expect(humanLabelFailures(broken, run)).toEqual(expect.arrayContaining(["synthetic_label_forbidden", "label_created_after_model_run", "critical_requires_two_reviewers", "run_label_mismatch"]));
    const disagreement = { ...labels, cases: [{ ...labels.cases[0]!, votes: [{ reviewerHash: reviewer, expected: true }, { reviewerHash: second, expected: false }] }] };
    expect(humanLabelFailures(disagreement, run)).toContain("label_disagreement_unadjudicated");
    expect(humanLabelFailures({ ...disagreement, cases: [{ ...disagreement.cases[0]!, adjudicatorHash: adjudicator }] }, run)).not.toContain("label_disagreement_unadjudicated");
  });
  it("cannot pass release merely because governance is valid when population metrics are weak", () => expect(releaseEvidenceGate({ run, population: officialPopulation, labels, modelGrader: { used: false, humanLabelledCases: 0, falseAccepts: 0, falseRejects: 0, maximumFalseAcceptRate: 0 } })).toMatchObject({ passed: false, deterministicGrader: { passed: true } }));
  it("rejects an uncalibrated model judge instead of letting it overrule deterministic evidence", () => { const result = releaseEvidenceGate({ run, population: officialPopulation, labels, modelGrader: { used: true, humanLabelledCases: 10, falseAccepts: 1, falseRejects: 0, maximumFalseAcceptRate: .01 } }); expect(result.failures).toContain("model_grader_uncalibrated"); });
});

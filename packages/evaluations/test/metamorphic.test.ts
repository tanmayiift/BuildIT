import { describe, expect, it } from "vitest";
import { metamorphicReleaseGate, type MetamorphicObservation, type NeutralTransformation } from "../src/metamorphic.js";

const transformations: NeutralTransformation[] = ["comments", "whitespace", "formatter", "file_order", "harmless_rename", "equivalent_requirement"];
const finding = { defectId: "daily-limit-boundary", severity: "high" as const, evidenceSupported: true };
const baseline: MetamorphicObservation = { caseId: "transfer-limit", variantId: "original", transformation: "baseline", findings: [finding], status: "changes_requested" };
const passing = (): MetamorphicObservation[] => [
  baseline,
  ...transformations.map((transformation, index) => ({ ...baseline, variantId: `neutral-${index}`, transformation })),
  { ...baseline, variantId: "operator-fixed", transformation: "semantic_mutation", findings: [], status: "pass" },
];

describe("metamorphic accuracy gate", () => {
  it("requires harmless changes to preserve the decision and supported finding", () => {
    const result = metamorphicReleaseGate(passing());
    expect(result).toEqual({ passed: true, failures: [], score: { neutralVariants: 6, neutralAgreement: 1, semanticMutations: 1, semanticSensitivity: 1 } });
  });

  it("rejects severity drift caused by comment-only input", () => {
    const observations = passing();
    observations[1] = { ...observations[1]!, findings: [{ ...finding, severity: "critical" }] };
    const result = metamorphicReleaseGate(observations);
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining(["transfer-limit_neutral-0_neutral_drift", "neutral_agreement_below_threshold"]));
  });

  it("rejects a harness where a real semantic fix changes nothing", () => {
    const observations = passing();
    observations[observations.length - 1] = { ...baseline, variantId: "operator-fixed", transformation: "semantic_mutation" };
    const result = metamorphicReleaseGate(observations);
    expect(result.failures).toEqual(expect.arrayContaining(["transfer-limit_operator-fixed_semantic_mutation_ignored", "semantic_sensitivity_below_threshold"]));
  });

  it("fails closed without one baseline, six neutral transformations, and a semantic mutation", () => {
    expect(metamorphicReleaseGate([baseline])).toMatchObject({
      passed: false,
      failures: expect.arrayContaining(["neutral_variant_coverage_below_threshold", "neutral_agreement_below_threshold", "semantic_mutation_coverage_missing"]),
    });
    expect(metamorphicReleaseGate(passing().slice(1)).failures).toContain("transfer-limit_baseline_count_invalid");
  });
});

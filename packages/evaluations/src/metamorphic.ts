export type NeutralTransformation =
  | "comments"
  | "whitespace"
  | "formatter"
  | "file_order"
  | "harmless_rename"
  | "equivalent_requirement";

export type MetamorphicFinding = {
  defectId: string;
  severity: "low" | "medium" | "high" | "critical";
  evidenceSupported: boolean;
};

export type MetamorphicObservation = {
  caseId: string;
  variantId: string;
  transformation: "baseline" | NeutralTransformation | "semantic_mutation";
  findings: MetamorphicFinding[];
  status: "pass" | "changes_requested" | "inconclusive";
};

export type MetamorphicThresholds = {
  minimumNeutralVariants: number;
  minimumNeutralAgreement: number;
  requireSemanticSensitivity: boolean;
};

export const metamorphicReleaseThresholds: MetamorphicThresholds = {
  minimumNeutralVariants: 6,
  minimumNeutralAgreement: 1,
  requireSemanticSensitivity: true,
};

const findingFingerprint = (finding: MetamorphicFinding) =>
  `${finding.defectId}\u0000${finding.severity}\u0000${finding.evidenceSupported}`;

const observationFingerprint = (observation: MetamorphicObservation) =>
  `${observation.status}\u0001${observation.findings.map(findingFingerprint).sort().join("\u0002")}`;

export function metamorphicReleaseGate(
  observations: MetamorphicObservation[],
  thresholds: MetamorphicThresholds = metamorphicReleaseThresholds,
) {
  const failures: string[] = [];
  const groups = new Map<string, MetamorphicObservation[]>();
  for (const observation of observations) {
    groups.set(observation.caseId, [...(groups.get(observation.caseId) ?? []), observation]);
  }

  let neutralVariants = 0;
  let neutralMatches = 0;
  let semanticMutations = 0;
  let semanticChanges = 0;

  for (const [caseId, rows] of groups) {
    const baselines = rows.filter(row => row.transformation === "baseline");
    if (baselines.length !== 1) {
      failures.push(`${caseId}_baseline_count_invalid`);
      continue;
    }
    const baselineFingerprint = observationFingerprint(baselines[0]!);
    for (const row of rows) {
      if (row.transformation === "baseline") continue;
      const matches = observationFingerprint(row) === baselineFingerprint;
      if (row.transformation === "semantic_mutation") {
        semanticMutations += 1;
        if (!matches) semanticChanges += 1;
        else failures.push(`${caseId}_${row.variantId}_semantic_mutation_ignored`);
      } else {
        neutralVariants += 1;
        if (matches) neutralMatches += 1;
        else failures.push(`${caseId}_${row.variantId}_neutral_drift`);
      }
    }
  }

  if (neutralVariants < thresholds.minimumNeutralVariants) failures.push("neutral_variant_coverage_below_threshold");
  const neutralAgreement = neutralVariants ? neutralMatches / neutralVariants : 0;
  if (neutralAgreement < thresholds.minimumNeutralAgreement) failures.push("neutral_agreement_below_threshold");
  if (thresholds.requireSemanticSensitivity && semanticMutations === 0) failures.push("semantic_mutation_coverage_missing");
  if (thresholds.requireSemanticSensitivity && semanticChanges < semanticMutations) failures.push("semantic_sensitivity_below_threshold");

  return {
    passed: failures.length === 0,
    failures: [...new Set(failures)].sort(),
    score: { neutralVariants, neutralAgreement, semanticMutations, semanticSensitivity: semanticMutations ? semanticChanges / semanticMutations : 0 },
  };
}

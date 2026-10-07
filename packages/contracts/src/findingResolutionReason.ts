// Why a model finding ended accepted or uncertain, as the orchestrator decided it
// (arbitrateFindings, then reconcileArbitration). Stored as this closed code and never as text.
//
// It exists to answer one question the stored rows could not: arbitration can only take a finding
// the critic supported and mark it uncertain, so whether that second model call earns its cost - 7%
// of model spend and a median 3 s of a 14 s analysis in the R0 benchmark - turns on how often it
// does so and to which findings. The reason was computed for every finding and dropped before
// storage.
export const findingResolutionReasons = [
  "deterministic_scanner_evidence",
  "critic_missing",
  "prompt_injection_detected",
  "critic_disproved",
  "critic_uncertain",
  "critic_supported",
  "arbitration_duplicate",
  "arbitration_disagreed",
  "critic_and_arbitration_supported",
] as const;
export type FindingResolutionReason = typeof findingResolutionReasons[number];

const known = new Set<string>(findingResolutionReasons);
export function isFindingResolutionReason(value: string | undefined): value is FindingResolutionReason {
  return value !== undefined && known.has(value);
}

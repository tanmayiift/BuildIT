import type { HumanLabelManifest, HumanVote } from "./releaseEvidence.js";

export type BlindCase = { caseId: string; severity: "low" | "medium" | "high" | "critical" };
export type BlindAssignment = { version: string; hiddenHoldout: true; assignments: Array<{ caseId: string; severity: BlindCase["severity"]; reviewerHashes: string[]; adjudicatorHash: string }> };
const hash = /^[0-9a-f]{64}$/;

export function createBlindAssignments(input: { version: string; cases: BlindCase[]; reviewerHashes: string[]; adjudicatorHashes: string[] }): BlindAssignment {
  if (!input.version || !input.cases.length || input.reviewerHashes.length < 2 || !input.adjudicatorHashes.length || [...input.reviewerHashes, ...input.adjudicatorHashes].some(value => !hash.test(value)) || new Set([...input.reviewerHashes, ...input.adjudicatorHashes]).size !== input.reviewerHashes.length + input.adjudicatorHashes.length) throw new Error("blind_assignment_input_invalid");
  if (new Set(input.cases.map(item => item.caseId)).size !== input.cases.length || input.cases.some(item => !item.caseId)) throw new Error("blind_assignment_case_invalid");
  return { version: input.version, hiddenHoldout: true, assignments: input.cases.map((item, index) => ({ caseId: item.caseId, severity: item.severity, reviewerHashes: item.severity === "critical" ? [input.reviewerHashes[index % input.reviewerHashes.length]!, input.reviewerHashes[(index + 1) % input.reviewerHashes.length]!] : [input.reviewerHashes[index % input.reviewerHashes.length]!], adjudicatorHash: input.adjudicatorHashes[index % input.adjudicatorHashes.length]! })) };
}

const pairKey = (vote: HumanVote) => vote.reviewerHash;
export function reviewerAgreement(labels: HumanLabelManifest) {
  const overlapping = labels.cases.filter(item => item.votes.length >= 2), pairs = overlapping.flatMap(item => {
    const sorted = [...item.votes].sort((a, b) => pairKey(a).localeCompare(pairKey(b)));
    return [{ first: sorted[0]!.expected, second: sorted[1]!.expected }];
  });
  const agreed = pairs.filter(item => item.first === item.second).length, observed = pairs.length ? agreed / pairs.length : 0;
  if (!pairs.length) return { overlappingCases: 0, agreedCases: 0, percentAgreement: 0, cohenKappa: 0 };
  const firstTrue = pairs.filter(item => item.first).length / pairs.length, secondTrue = pairs.filter(item => item.second).length / pairs.length;
  const expected = firstTrue * secondTrue + (1 - firstTrue) * (1 - secondTrue), kappa = expected === 1 ? (observed === 1 ? 1 : 0) : (observed - expected) / (1 - expected);
  return { overlappingCases: pairs.length, agreedCases: agreed, percentAgreement: observed, cohenKappa: kappa };
}

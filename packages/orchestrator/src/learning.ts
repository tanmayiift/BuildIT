// A learning loop that can quiet a real defect is worse than no learning loop, so this one may do
// exactly one thing: stop putting a shape of finding on the diff. The finding is still found, still
// in the summary comment, still evidence-gated. Nothing here relaxes evidence, touches a scanner
// result, or makes anything louder.
//
// Three dismissals, not one. One is a person disagreeing once; three of the same shape in the same
// part of the same repository is a team saying this does not apply to their code.
export const dismissalsBeforeDemotion = 3;

type FeedbackRecord = { ruleKey: string; pathPrefixHmac: string; verdict: "accepted" | "dismissed" };
type CandidateFinding = {
  ruleKey: string;
  pathPrefixHmac: string;
  severity: "info" | "warning" | "high" | "critical";
  blocking: boolean;
  origin: "model" | "scanner";
};

export function demotedByLearning(finding: CandidateFinding, feedback: ReadonlyArray<FeedbackRecord>) {
  // A blocking finding is one the evidence says stops a merge. No amount of dismissal may take it
  // off the diff - a team that disagrees can change the check policy, which is a decision they make
  // deliberately rather than one that accumulates.
  if (finding.blocking) return false;
  // Critical is the same argument one step earlier.
  if (finding.severity === "critical") return false;
  // A scanner result came from a process in a sandbox, not from a judgement that could be wrong in
  // the way dismissals are evidence of.
  if (finding.origin === "scanner") return false;

  const dismissals = feedback.filter(record =>
    record.verdict === "dismissed"
    && record.ruleKey === finding.ruleKey
    && record.pathPrefixHmac === finding.pathPrefixHmac).length;
  return dismissals >= dismissalsBeforeDemotion;
}

// Which findings a delivered autofix actually fixed.
//
// `findingResolution: "fixed"` was declared in the validators and written by nothing, so the
// changelog's fixed-findings list matched zero rows on every run. The obvious fix - mark the
// review's accepted findings fixed when `deliver` succeeds - is the specific over-claim BuildIT
// exists not to make: the patch stage is fed accepted findings and is not required to address all
// of them, and "the candidate commit passes its checks" is not evidence that any particular finding
// was resolved. A review whose patch fixed one of four would have reported four.
//
// A scanner finding has a test the model findings do not: run the same scanners on the candidate
// commit and see whether the rule still matches the file. If it does not, that finding is fixed -
// verified, not inferred. So only scanner-origin findings are eligible, which is exactly the subset
// that can be checked, and model findings stay unmarked rather than guessed at.
//
// Identity is `ruleId` plus `pathHmac`, deliberately not the stored `fingerprintHmac`: that one is
// built from `scanner-${index}-${ruleId}` and the line range, so it moves when an earlier finding
// is removed or a line is inserted above. Rule-and-file is stable across exactly the edits an
// autofix makes.

/** A finding row, reduced to what deciding "fixed" needs. */
export type ResolvableFinding = { id: string; ruleId?: string; pathHmac: string; resolution: string };
/** One scanner match on the candidate commit, hashed the same way the finding rows are. */
export type CandidateScannerFinding = { ruleId: string; pathHmac: string };

const eligible = new Set(["open", "accepted"]);
const identity = (ruleId: string, pathHmac: string) => `${ruleId}\0${pathHmac}`;

export function resolvedScannerFindings(
  findings: readonly ResolvableFinding[],
  candidate: readonly CandidateScannerFinding[],
): string[] {
  const present = new Set(candidate.map(item => identity(item.ruleId, item.pathHmac)));
  return findings
    // No ruleId means no scanner produced it, and nothing here can check a model's claim.
    .filter(item => typeof item.ruleId === "string" && item.ruleId.length > 0)
    // `uncertain` is excluded on purpose. The critic could not confirm it was real, and "we could
    // not tell, and now it is gone" is not the same statement as "it was there and we fixed it".
    // `dismissed` is excluded because a person already said it was not a problem.
    .filter(item => eligible.has(item.resolution))
    .filter(item => !present.has(identity(item.ruleId!, item.pathHmac)))
    .map(item => item.id);
}

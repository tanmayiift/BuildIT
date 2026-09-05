// "No version comparison showing whether review judgment improves" was a fair reading of this
// package. score.ts grades one run against absolute thresholds, and detection.ts grades one run
// against a floor. Neither answers the question a maintainer actually asks before shipping a prompt
// change: is this better or worse than what is in production?
//
// A single run cannot answer it. Detection varies between runs on identical input - the repository
// documents that in docs/evaluations/detection-suite.md, which is why the live suite is deliberately
// not a CI gate - so "we found 5 last time and 4 this time" is noise, not a regression. What matters
// is which cases changed direction, and whether more changed for the better than the worse.
//
// So this compares two runs case by case and reports the movement, never a single blended score:
// a number that goes from 0.83 to 0.81 tells you nothing about whether the thing you fixed is fixed.

export type CaseOutcome = {
  caseId: string;
  // "detected" for a defect case the run found; "missed" for one it did not; "false_blocking" for a
  // clean case the run blocked. Deliberately the same three outcomes detection.ts already produces.
  outcome: "detected" | "missed" | "false_blocking" | "clean_pass";
};

export type VersionRun = {
  promptVersion: string;
  setVersion: string;
  cases: readonly CaseOutcome[];
};

export type CaseMovement = {
  caseId: string;
  before: CaseOutcome["outcome"];
  after: CaseOutcome["outcome"];
  direction: "improved" | "regressed" | "unchanged";
};

// A case is better when it moves toward being right and worse when it moves away. Ranking the
// outcomes makes that a comparison rather than a table of special cases: finding a real defect is
// the best outcome, blocking a clean change is the worst, and missing a defect sits between them -
// a miss costs a bug, a false block costs the reviewer's trust in every future finding.
const rank: Record<CaseOutcome["outcome"], number> = {
  detected: 3,
  clean_pass: 3,
  missed: 2,
  false_blocking: 1,
};

export function compareVersions(before: VersionRun, after: VersionRun) {
  if (before.setVersion !== after.setVersion) {
    // Comparing runs of different corpora produces a number that looks like a judgment change and
    // is actually a change of question. Refused rather than reported with a caveat nobody reads.
    throw new Error(`eval_version_set_mismatch:${before.setVersion}:${after.setVersion}`);
  }
  if (before.promptVersion === after.promptVersion) {
    throw new Error(`eval_version_identical:${before.promptVersion}`);
  }

  const beforeById = new Map(before.cases.map(item => [item.caseId, item]));
  const afterById = new Map(after.cases.map(item => [item.caseId, item]));
  // Only cases both runs actually attempted. A case added with the new prompt has no "before" to
  // improve on, and counting it as an improvement would let a version look better by growing the
  // corpus rather than by judging better.
  const shared = [...afterById.keys()].filter(caseId => beforeById.has(caseId)).sort();

  const movements: CaseMovement[] = shared.map(caseId => {
    const from = beforeById.get(caseId)!.outcome;
    const to = afterById.get(caseId)!.outcome;
    return { caseId, before: from, after: to, direction: rank[to] > rank[from] ? "improved" : rank[to] < rank[from] ? "regressed" : "unchanged" };
  });

  const improved = movements.filter(item => item.direction === "improved");
  const regressed = movements.filter(item => item.direction === "regressed");
  // A new false block is the one movement worth naming on its own. It is the outcome that teaches
  // people to stop reading findings, and it is invisible in a detection rate that went up.
  const newFalseBlocking = movements.filter(item => item.after === "false_blocking" && item.before !== "false_blocking");

  return {
    setVersion: before.setVersion,
    from: before.promptVersion,
    to: after.promptVersion,
    comparedCases: shared.length,
    onlyInBefore: [...beforeById.keys()].filter(caseId => !afterById.has(caseId)).sort(),
    onlyInAfter: [...afterById.keys()].filter(caseId => !beforeById.has(caseId)).sort(),
    improved,
    regressed,
    unchanged: movements.filter(item => item.direction === "unchanged").length,
    newFalseBlocking,
    movements,
  };
}

// The release question, kept separate from the report so a caller can show the movement without
// being told what to conclude from it.
export function versionRegressed(comparison: ReturnType<typeof compareVersions>) {
  // Any new false block blocks, regardless of arithmetic: a run that finds one more real defect and
  // also starts blocking a clean change is not an improvement, it is a trade nobody agreed to.
  if (comparison.newFalseBlocking.length) {
    return { regressed: true, because: `${comparison.newFalseBlocking.length} clean ${comparison.newFalseBlocking.length === 1 ? "case is" : "cases are"} now blocked that were not before` };
  }
  if (comparison.regressed.length > comparison.improved.length) {
    return { regressed: true, because: `${comparison.regressed.length} cases got worse against ${comparison.improved.length} better` };
  }
  return { regressed: false, because: comparison.improved.length ? `${comparison.improved.length} improved, ${comparison.regressed.length} regressed` : "no case changed direction" };
}

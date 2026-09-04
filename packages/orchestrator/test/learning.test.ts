import { describe, expect, it } from "vitest";
import { demotedByLearning, dismissalsBeforeDemotion } from "../src/learning.js";

// A learning loop that can quiet a real defect is worse than no learning loop, so this one may do
// exactly one thing: stop putting a shape of finding on the diff. It never stops finding it, never
// relaxes evidence, never touches a scanner result, and never promotes anything.
//
// The count is what makes it a signal rather than a reaction. One dismissal is a person disagreeing
// once; three of the same shape is a team saying this does not apply to their code.

const dismissals = (count: number, over: Record<string, unknown> = {}) =>
  Array.from({ length: count }, () => ({ ruleKey: "buildit-dynamic-eval", pathPrefixHmac: "p1", verdict: "dismissed" as const, ...over }));

const finding = (over: Record<string, unknown> = {}) => ({
  ruleKey: "buildit-dynamic-eval", pathPrefixHmac: "p1", severity: "warning" as const,
  blocking: false, origin: "model" as const, ...over,
});

describe("what repeated dismissals may change", () => {
  it("leaves a shape alone until a team has said it three times", () => {
    expect(demotedByLearning(finding(), dismissals(2))).toBe(false);
    expect(demotedByLearning(finding(), dismissals(3))).toBe(true);
  });

  it("counts only this rule in this part of this repository", () => {
    expect(demotedByLearning(finding(), dismissals(3, { ruleKey: "buildit-sql-interpolation" }))).toBe(false);
    expect(demotedByLearning(finding(), dismissals(3, { pathPrefixHmac: "elsewhere" }))).toBe(false);
  });

  it("does not count acceptances towards silence", () => {
    const mixed = [...dismissals(2), { ruleKey: "buildit-dynamic-eval", pathPrefixHmac: "p1", verdict: "accepted" as const }];
    expect(demotedByLearning(finding(), mixed)).toBe(false);
  });

  // The three things it must never do, one test each.
  it("never demotes a blocking finding, whatever was dismissed", () => {
    expect(demotedByLearning(finding({ blocking: true }), dismissals(50))).toBe(false);
  });

  it("never demotes a scanner result, which no prompt and no opinion produced", () => {
    expect(demotedByLearning(finding({ origin: "scanner" }), dismissals(50))).toBe(false);
    expect(demotedByLearning(finding({ origin: "scanner", severity: "critical" }), dismissals(50))).toBe(false);
  });

  it("never promotes: an accepted shape is not made louder", () => {
    const accepted = Array.from({ length: 50 }, () => ({ ruleKey: "buildit-dynamic-eval", pathPrefixHmac: "p1", verdict: "accepted" as const }));
    expect(demotedByLearning(finding(), accepted)).toBe(false);
  });

  it("never demotes a critical finding either, dismissed or not", () => {
    expect(demotedByLearning(finding({ severity: "critical" }), dismissals(50))).toBe(false);
  });

  it("takes an empty history in its stride", () => {
    expect(demotedByLearning(finding(), [])).toBe(false);
  });

  // The three refusals above are examples, and the review page now carries a dismiss control that
  // states them to a person as a promise: dismissing never silences a finding that blocks merge, a
  // Critical finding, or a scanner result. An example can still be true while a fourth shape starts
  // being demoted, so this pins the complete set instead - every severity against every origin,
  // blocking and advisory, at a dismissal count far past the threshold. Adding a demotable shape
  // now fails here, which is where the promise on that page can be checked.
  it("demotes model findings that are advisory and not critical, and nothing else at any count", () => {
    const demotable: string[] = [];
    for (const severity of ["info", "warning", "high", "critical"] as const)
      for (const blocking of [false, true])
        for (const origin of ["model", "scanner"] as const)
          if (demotedByLearning(finding({ severity, blocking, origin }), dismissals(dismissalsBeforeDemotion * 10)))
            demotable.push(`${severity} ${blocking ? "blocking" : "advisory"} ${origin}`);
    expect(demotable).toEqual(["info advisory model", "warning advisory model", "high advisory model"]);
  });
});

import { describe, expect, it } from "vitest";
import { abandonedStatuses, concludedStatuses, decisiveStatuses, isAbandoned, isConcluded, isDecisive } from "./reviewOutcome";

// "How many reviews succeeded" had three answers. activation.ts counted inconclusive as completed,
// publicProof.ts excluded it from decisive verdicts, and activation.ts disagreed with itself about
// failed_after_bounds - one set in the file carried it, the count below did not. All three were
// published. This pins the distinction so the next reader cannot re-spell any of them by hand.
describe("what counts as a successful review", () => {
  it("separates reaching a judgement from merely stopping", () => {
    expect(isDecisive("checks_passed")).toBe(true);
    expect(isDecisive("changes_requested")).toBe(true);
    expect(isDecisive("delivered")).toBe(true);
    // The one that caused the disagreement: BuildIT finished and said nothing about the code.
    expect(isDecisive("inconclusive")).toBe(false);
    expect(isConcluded("inconclusive")).toBe(true);
  });

  it("treats every decisive outcome as concluded, never the reverse", () => {
    for (const status of decisiveStatuses) expect(isConcluded(status)).toBe(true);
    expect(concludedStatuses.size).toBeGreaterThan(decisiveStatuses.size);
  });

  it("counts abandoned outcomes explicitly rather than by subtraction, because a running review is neither", () => {
    for (const status of abandonedStatuses) {
      expect(isConcluded(status)).toBe(false);
      expect(isDecisive(status)).toBe(false);
    }
    for (const status of ["queued", "analyzing", "validating"]) {
      expect(isConcluded(status)).toBe(false);
      expect(isAbandoned(status)).toBe(false);
    }
  });

  it("keeps the three sets disjoint where they must be", () => {
    for (const status of abandonedStatuses) expect(concludedStatuses.has(status)).toBe(false);
  });
});

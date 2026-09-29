import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyAutofixStop } from "./autofixBounds";

describe("a bounded stop is not an outage", () => {
  it("maps each named bound to the value the schema has always declared", () => {
    expect(classifyAutofixStop("autofix_round_limit")).toMatchObject({ kind: "bound", terminationBound: "round_limit" });
    expect(classifyAutofixStop("autofix_attempt_limit")).toMatchObject({ kind: "bound", terminationBound: "attempt_limit" });
    expect(classifyAutofixStop("autofix_time_limit")).toMatchObject({ kind: "bound", terminationBound: "wall_clock_limit" });
    expect(classifyAutofixStop("autofix_repeated_patch")).toMatchObject({ kind: "bound", terminationBound: "repeated_patch" });
  });

  // The loop guard is the reason this exists: it fired correctly and reported an outage.
  it("treats a refusal to deliver a worse candidate as a bound without inventing a name for it", () => {
    expect(classifyAutofixStop("autofix_worsened:required_check_failed")).toMatchObject({ kind: "bound", terminationBound: undefined });
  });

  // One cause, one answer - whichever code path notices first.
  it("routes the spend ceiling to budget, not to a bound", () => {
    expect(classifyAutofixStop("autofix_spend_limit")).toEqual({ kind: "budget" });
  });

  it("leaves a genuine platform failure alone", () => {
    for (const code of ["validation_runner_failed", "autofix_failed", "something_unexpected"]) {
      expect(classifyAutofixStop(code), code).toEqual({ kind: "platform" });
    }
  });
});

// The three values that had no writer anywhere. This is the assertion that would have caught the
// original defect: a schema declaring an outcome the code cannot produce.
describe("every declared terminationBound is reachable", () => {
  it("has a code that produces it", () => {
    const produced = new Set(["autofix_round_limit", "autofix_attempt_limit", "autofix_time_limit", "autofix_repeated_patch"]
      .map(code => { const stop = classifyAutofixStop(code); return stop.kind === "bound" ? stop.terminationBound : undefined; }));
    for (const bound of ["round_limit", "attempt_limit", "wall_clock_limit", "repeated_patch"]) {
      expect(produced, `${bound} is declared in validators.ts and must be writable`).toContain(bound);
    }
  });

  it("is wired into failPlatform, not merely defined", () => {
    const source = readFileSync(join(process.cwd(), "convex/reviewAutofixData.ts"), "utf8");
    expect(source, "a classifier nothing calls leaves the bug in place").toContain("classifyAutofixStop(args.code)");
    expect(source).toContain('status:"failed_after_bounds"');
  });
});

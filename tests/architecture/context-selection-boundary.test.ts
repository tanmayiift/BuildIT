import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Fetching only the code under review nearly shipped a silent security regression. The sandbox
// scans dependency manifests from the head snapshot, so a `keep` predicate that covered only the
// changed files and the documents requirements come from would have stopped dependency scanning on
// any repository past the threshold - and produced a green review while doing it.
//
// packages/github/test/repository-content.test.ts proves the fetcher honours whatever predicate it
// is given. That is the wrong half: the bug would have been the caller composing the predicate
// wrongly, which no unit test of the fetcher can see. This pins the composition.
//
// It pinned the composition and still missed the sequel, because it pinned the wrong invariant.
// This file used to assert that base was "the changed files alone" and treat that as a virtue.
// Head kept `package.json` and the lockfile; base kept neither; detectPackageManager reads both
// revisions and refuses when they disagree. Every repository above the threshold whose pull request
// did not happen to touch its manifests died with `package_manager_changed` before a single check
// ran, and the author was told "a required platform step failed". It reached production and killed
// this repository's own pull request #46.
//
// So the invariant is not "base is narrow". It is that the two revisions never disagree about the
// execution plan. convex/lib/executionPlanSelection.test.ts asserts that behaviourally by
// reconstructing both predicates; this file asserts the worker actually composes them that way.
const worker = readFileSync(join(import.meta.dirname, "../../convex/reviewContextWorker.ts"), "utf8");
const selection = (name: "headSelect" | "baseSelect") =>
  worker.match(new RegExp(`const ${name} = \\{[\\s\\S]*?\\};`))?.[0];

describe("what a large repository still reads", () => {
  it("selects the same paths on both revisions", () => {
    const head = selection("headSelect");
    const base = selection("baseSelect");
    expect(head, "headSelect not found - if the selection moved, move this assertion with it").toBeTruthy();
    expect(base, "baseSelect not found - if the selection moved, move this assertion with it").toBeTruthy();
    expect(head, "head must reach the manifests the sandbox scans and the plan is derived from")
      .toContain("executionPlanInput(path)");
    // Base defers to head rather than restating the rule, because two copies of it drift and every
    // drift so far has produced the same bug in a new place.
    expect(base, "base must select exactly what head selects").toContain("headSelect.keep(path)");
  });

  it("keeps the changed files and the requirement documents in the head selection", () => {
    const select = selection("headSelect") ?? "";
    expect(select).toContain("changedPaths.has(path)");
    expect(select).toContain("isRequirementSourcePath(path)");
  });

  // The old invariant here was that base stayed the narrowest selection of the three, and it read
  // as thrift. It was the bug. The scanners run over whatever each revision fetched, so every
  // "did this change introduce it" comparison silently compared different file sets: it broke
  // package-manager detection first, and then reported three of zod's own long-standing test
  // fixtures as secrets introduced by a pull request that never opened the file.
  it("keeps base and head from drifting apart again", () => {
    const base = selection("baseSelect") ?? "";
    expect(base, "base must not restate head's rule - it must reuse it").not.toContain("isRequirementSourcePath");
    expect(base, "base must not narrow itself back to the changed files alone")
      .not.toMatch(/changedPaths\.has\(path\) && allowedByRepository\(path\)\), relevantOnlyAbove/);
  });

  it("only narrows above a threshold, so small repositories keep full context", () => {
    expect(worker).toContain("relevantOnlyAbove");
  });
});

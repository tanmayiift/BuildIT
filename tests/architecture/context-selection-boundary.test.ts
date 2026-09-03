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
const worker = readFileSync(join(import.meta.dirname, "../../convex/reviewContextWorker.ts"), "utf8");

describe("what a large repository still reads", () => {
  it("keeps dependency manifests in the head selection", () => {
    const select = worker.match(/const headSelect = \{[\s\S]*?\};/)?.[0];
    expect(select, "headSelect not found - if the selection moved, move this assertion with it").toBeTruthy();
    expect(select, "a narrowed selection must still reach the manifests the sandbox scans").toContain("dependencyManifest");
  });

  it("keeps the changed files and the requirement documents in the head selection", () => {
    const select = worker.match(/const headSelect = \{[\s\S]*?\};/)?.[0] ?? "";
    expect(select).toContain("changedPaths.has(path)");
    expect(select).toContain("isRequirementSourcePath(path)");
  });

  // Base contributes no file content to the model - reviewAnalysisWorker filters
  // revision !== "base" - so it is deliberately the narrowest selection of the three. Pinned so
  // nobody "fixes" it back to a full fetch and restores 1,373 pointless blob requests.
  it("keeps the base selection to the changed files alone", () => {
    const select = worker.match(/const baseSelect = \{[\s\S]*?\};/)?.[0];
    expect(select).toBeTruthy();
    expect(select).toContain("changedPaths.has(path)");
    expect(select, "base file content never reaches the model").not.toContain("isRequirementSourcePath");
  });

  it("only narrows above a threshold, so small repositories keep full context", () => {
    expect(worker).toContain("relevantOnlyAbove");
  });
});

import { describe, expect, it } from "vitest";
import { historicalCases, historicalCleanCount, historicalDefectCount, historicalSetVersion } from "../src/historicalCases";
import { compareVersions, versionRegressed, type VersionRun } from "../src/versionComparison";

// The set is only worth anything if every case is real and openable. These assert the properties
// that make it an evaluation set rather than a list of opinions.
describe("the historical pull request set", () => {
  it("is ten real pull requests a reader can open", () => {
    expect(historicalCases).toHaveLength(10);
    for (const item of historicalCases) {
      expect(item.url, item.id).toMatch(/^https:\/\/github\.com\/[\w-]+\/[\w.-]+\/pull\/\d+$/);
      expect(item.upstreamSha, item.id).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("carries a clean case, so a reviewer that flags everything cannot score well", () => {
    expect(historicalCleanCount).toBeGreaterThanOrEqual(1);
    expect(historicalDefectCount).toBe(historicalCases.length - historicalCleanCount);
  });

  it("spans four languages and does not repeat a defect family", () => {
    expect(new Set(historicalCases.map(item => item.language)).size).toBe(4);
    const families = historicalCases.filter(item => item.kind === "defect").map(item => item.defectFamily);
    // A set of nine defects that are all logic edge cases would measure one skill nine times.
    expect(new Set(families).size).toBeGreaterThanOrEqual(5);
  });

  it("says what a correct finding must understand, not just which file to name", () => {
    for (const item of historicalCases.filter(entry => entry.kind === "defect")) {
      expect(item.mustUnderstand, item.id).toBeTruthy();
      expect(item.expect?.anyOf.length, item.id).toBeGreaterThan(1);
      // Naming the right file with the wrong reasoning is not detection, which is the whole reason
      // the expectation carries required vocabulary alongside a path.
      expect(item.expect?.path, item.id).toBeTruthy();
    }
  });

  it("records why each added test passes despite the defect", () => {
    // Every one of these shipped with a test that goes green on the broken code. That is what the
    // real failures looked like, and a set without it would be easier than production.
    for (const item of historicalCases.filter(entry => entry.kind === "defect")) {
      expect(item.testBlindSpot, item.id).toBeTruthy();
    }
  });

  it("keeps its unique ids unique", () => {
    expect(new Set(historicalCases.map(item => item.id)).size).toBe(historicalCases.length);
  });
});

// "No version comparison showing whether review judgment improves" was the other half of the
// finding. These pin what comparison means here.
describe("comparing two prompt versions", () => {
  const run = (promptVersion: string, cases: VersionRun["cases"]): VersionRun => ({ promptVersion, setVersion: historicalSetVersion, cases });

  it("reports which cases moved, in which direction", () => {
    const before = run("findings-v1", [{ caseId: "a", outcome: "missed" }, { caseId: "b", outcome: "detected" }, { caseId: "c", outcome: "detected" }]);
    const after = run("findings-v2", [{ caseId: "a", outcome: "detected" }, { caseId: "b", outcome: "missed" }, { caseId: "c", outcome: "detected" }]);
    const comparison = compareVersions(before, after);
    expect(comparison.improved.map(item => item.caseId)).toEqual(["a"]);
    expect(comparison.regressed.map(item => item.caseId)).toEqual(["b"]);
    expect(comparison.unchanged).toBe(1);
  });

  it("treats a new false block as a regression even when detection went up", () => {
    // The trade this refuses: two more real defects found, one clean change now blocked. A blended
    // score calls that an improvement; a person whose correct pull request was blocked does not.
    const before = run("findings-v1", [{ caseId: "a", outcome: "missed" }, { caseId: "b", outcome: "missed" }, { caseId: "clean", outcome: "clean_pass" }]);
    const after = run("findings-v2", [{ caseId: "a", outcome: "detected" }, { caseId: "b", outcome: "detected" }, { caseId: "clean", outcome: "false_blocking" }]);
    const comparison = compareVersions(before, after);
    expect(comparison.improved).toHaveLength(2);
    expect(versionRegressed(comparison).regressed).toBe(true);
    expect(versionRegressed(comparison).because).toContain("now blocked");
  });

  it("compares only cases both runs attempted, so growing the set cannot look like improvement", () => {
    const before = run("findings-v1", [{ caseId: "a", outcome: "missed" }]);
    const after = run("findings-v2", [{ caseId: "a", outcome: "missed" }, { caseId: "new", outcome: "detected" }]);
    const comparison = compareVersions(before, after);
    expect(comparison.comparedCases).toBe(1);
    expect(comparison.onlyInAfter).toEqual(["new"]);
    expect(versionRegressed(comparison).regressed).toBe(false);
    expect(versionRegressed(comparison).because).toBe("no case changed direction");
  });

  it("refuses to compare runs of different corpora or the same version twice", () => {
    const a = run("findings-v1", []);
    expect(() => compareVersions(a, { ...a, promptVersion: "findings-v1" })).toThrow(/eval_version_identical/);
    expect(() => compareVersions(a, { ...a, promptVersion: "findings-v2", setVersion: "other" })).toThrow(/eval_version_set_mismatch/);
  });
});

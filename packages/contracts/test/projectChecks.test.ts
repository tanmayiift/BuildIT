import { describe, expect, it } from "vitest";
import { computeReviewDecision, consentRuns, declaresTestScript, lockfileManager, projectTests, testCounts, testCountsSummary } from "../src/index.js";

describe("what BuildIT can run for a JavaScript project", () => {
  it("reads the package manager from exactly one root lockfile", () => {
    expect(lockfileManager(new Set(["package.json", "pnpm-lock.yaml"]))).toBe("pnpm");
    expect(lockfileManager(new Set(["package.json", "package-lock.json"]))).toBe("npm");
    expect(lockfileManager(new Set(["package.json"]))).toBeUndefined();
    expect(lockfileManager(new Set(["package-lock.json", "yarn.lock"]))).toBe("ambiguous");
  });

  it("counts a test script, but not npm init's placeholder, an empty one, or a broken package.json", () => {
    expect(declaresTestScript('{"scripts":{"test":"xo && node --test"}}')).toBe(true);
    expect(declaresTestScript('{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}')).toBe(false);
    expect(declaresTestScript('{"scripts":{"test":"  "}}')).toBe(false);
    expect(declaresTestScript('{"scripts":{"build":"tsc"}}')).toBe(false);
    expect(declaresTestScript("{not json")).toBe(false);
    expect(declaresTestScript(undefined)).toBe(false);
  });

  it("separates a project it can test, one missing a lockfile, and one with no package.json", () => {
    expect(projectTests(new Set(["package.json", "yarn.lock"]), undefined)).toEqual({ runnable: true, manager: "yarn" });
    expect(projectTests(new Set(["package.json"]), '{"scripts":{"test":"ava"}}')).toEqual({ runnable: false, reason: "no_lockfile", declaresTests: true });
    expect(projectTests(new Set(["go.mod"]), undefined)).toEqual({ runnable: false, reason: "no_package_json" });
    expect(() => projectTests(new Set(["package.json", "package-lock.json", "pnpm-lock.yaml"]), undefined)).toThrow("package_manager_unsupported_or_ambiguous");
  });
});

// The consent panel promised "dependency install, test, lint, typecheck" to every repository.
describe("the consent panel's list of what will run", () => {
  it("promises the project's own checks only when a lockfile makes them runnable", () => {
    expect(consentRuns({ runnable: true, manager: "pnpm" })).toEqual(expect.arrayContaining(["dependency install with scripts disabled", "test", "lint", "typecheck"]));
    for (const tests of [{ runnable: false as const, reason: "no_lockfile" as const, declaresTests: true }, { runnable: false as const, reason: "no_package_json" as const }, undefined]) {
      const runs = consentRuns(tests);
      expect(runs).not.toContain("test");
      expect(runs).not.toContain("dependency install with scripts disabled");
      expect(runs).toEqual(expect.arrayContaining(["Gitleaks 8.28.0", "BuildIT static rules 1.0.0"]));
    }
  });

  it("says plainly that a project with tests but no lockfile will end inconclusive", () => {
    const line = consentRuns({ runnable: false, reason: "no_lockfile", declaresTests: true }).at(-1)!;
    expect(line).toMatch(/no lockfile/);
    expect(line).toMatch(/inconclusive/);
  });
});

describe("the verdict for tests that could not run", () => {
  const scanner = { name: "gitleaks", required: true, conclusion: "passed" as const, evidenceComplete: true };
  const untestable = { name: "test", required: true, conclusion: "not_run" as const, evidenceComplete: true, notRunReason: "no_lockfile" as const };

  it("names the lockfile when that is the only thing missing", () => {
    expect(computeReviewDecision({ isStale: false, environmentAvailable: true, findings: [], checks: [scanner, untestable] }))
      .toMatchObject({ status: "inconclusive", reason: "tests_need_lockfile", nextAction: "add_lockfile" });
  });

  it("does not let the lockfile reason hide another missing check", () => {
    const truncated = { name: "lint", required: true, conclusion: "truncated" as const, evidenceComplete: false };
    expect(computeReviewDecision({ isStale: false, environmentAvailable: true, findings: [], checks: [scanner, untestable, truncated] }))
      .toMatchObject({ status: "inconclusive", reason: "required_check_missing", nextAction: "retry_review" });
  });

  it("still ranks a stale commit above it", () => {
    expect(computeReviewDecision({ isStale: true, environmentAvailable: true, findings: [], checks: [scanner, untestable] }))
      .toMatchObject({ reason: "stale_commit" });
  });
});

// buildit-demo-zod#1: the required test suite failed on both commits - all 194 tests failing to load,
// with no summary line - and the pre-existing rule turned that into checks_passed. A suite failing on
// both commits is excused only when its own output shows tests passing.
describe("reading how many tests passed", () => {
  it("reads the common JavaScript runners' summaries", async () => {
    const { passedTestCount } = await import("../src/index.js");
    expect(passedTestCount(" Test Files  1 failed | 11 passed (12)\n      Tests  2 failed | 192 passed (194)")).toBe(192);
    expect(passedTestCount("Tests:       1 failed, 193 passed, 194 total")).toBe(193);
    expect(passedTestCount("  12 passing (30ms)\n  1 failing")).toBe(12);
    expect(passedTestCount("# tests 13\n# pass 12\n# fail 1")).toBe(12);
    expect(passedTestCount("ℹ tests 13\nℹ pass 12")).toBe(12);
    expect(passedTestCount("  12 tests passed\n  1 test failed")).toBe(12);
    expect(passedTestCount("\u001b[32m      Tests \u001b[39m \u001b[31m2 failed\u001b[39m | \u001b[32m40 passed\u001b[39m")).toBe(40);
  });

  it("finds no pass count where none is shown, rather than assuming one", async () => {
    const { passedTestCount } = await import("../src/index.js");
    expect(passedTestCount("      Tests  194 failed (194)")).toBeUndefined();
    expect(passedTestCount("      Tests  no tests")).toBeUndefined();
    expect(passedTestCount('   const z = await import("../../index.js");\n⎯⎯⎯[194/194]⎯')).toBeUndefined();
    expect(passedTestCount(undefined)).toBeUndefined();
  });
});

describe("recording what a test runner's summary said", () => {
  it("keeps tests and test files apart", () => {
    expect(testCounts(" Test Files  1 failed | 11 passed (12)\n      Tests  2 failed | 192 passed (194)")).toEqual({ filesFailed: 1, filesPassed: 11, failed: 2, passed: 192 });
    expect(testCounts("Test Suites: 1 failed, 5 passed, 6 total\nTests:       1 failed, 193 passed, 194 total")).toEqual({ filesFailed: 1, filesPassed: 5, failed: 1, passed: 193 });
    expect(testCounts("  12 passing (30ms)\n  1 failing")).toEqual({ passed: 12, failed: 1 });
    expect(testCounts("# tests 13\n# pass 12\n# fail 1")).toEqual({ passed: 12, failed: 1 });
    expect(testCounts("Total:   13\nPassed:  12\nFailed:  1")).toEqual({ passed: 12, failed: 1 });
  });

  it("reads through a workspace runner's line prefix", () => {
    expect(testCounts("packages/core test:       Tests  3 failed | 40 passed (43)")).toEqual({ failed: 3, passed: 40 });
    expect(testCounts("@acme/core:test:  Test Files  2 passed (2)")).toEqual({ filesPassed: 2 });
  });

  it("does not read a count out of ordinary prose or a code frame", () => {
    expect(testCounts("The 3 passed arguments are validated\n   const tests = 12 passed")).toEqual({});
    expect(testCounts('   const z = await import("../../index.js");\n⎯⎯⎯[194/194]⎯')).toEqual({});
    expect(testCounts(undefined)).toEqual({});
  });

  it("says one line a person can read, naming which unit was counted", () => {
    expect(testCountsSummary({ passed: 194, filesPassed: 12 })).toBe("Tests: 194 passed");
    expect(testCountsSummary({ passed: 192, failed: 2, filesPassed: 11, filesFailed: 1 })).toBe("Tests: 192 passed, 2 failed · Test files: 11 passed, 1 failed");
    expect(testCountsSummary({ failed: 194 })).toBe("Tests: 194 failed");
    expect(testCountsSummary({ filesPassed: 3, filesFailed: 194 })).toBe("Test files: 3 passed, 194 failed");
    expect(testCountsSummary({})).toBeUndefined();
  });

  // Recorded live on 4 Oct 2026 (review nx7avqsnya9qe09nwghhw9m3s18fnm7t). Showing only the tests made
  // a suite where 192 of 198 files failed to load read as twelve tests, seven passing.
  it("does not let the few tests that loaded hide the files that did not", () => {
    expect(testCountsSummary({ passed: 7, failed: 5, filesPassed: 6, filesFailed: 192 })).toBe("Tests: 7 passed, 5 failed · Test files: 6 passed, 192 failed");
    expect(testCountsSummary(undefined)).toBeUndefined();
  });
});

describe("the verdict for a test suite failing on both commits", () => {
  const scanner = { name: "gitleaks", required: true, conclusion: "passed" as const, evidenceComplete: true };
  const suite = (over: object) => ({ name: "test", required: true, conclusion: "failed" as const, evidenceComplete: true, preExisting: true, ...over });

  it("is inconclusive when the suite shows no test passing", () => {
    expect(computeReviewDecision({ isStale: false, environmentAvailable: true, findings: [], checks: [scanner, suite({ noPassingTests: true })] }))
      .toMatchObject({ status: "inconclusive", reason: "test_suite_failing", nextAction: "repair_test_suite" });
  });

  it("keeps the pre-existing rule for a suite that otherwise ran", () => {
    expect(computeReviewDecision({ isStale: false, environmentAvailable: true, findings: [], checks: [scanner, suite({})] }).status).toBe("checks_passed");
  });

  it("still requests changes when this pull request broke something", () => {
    const introduced = { name: "lint", required: true, conclusion: "failed" as const, evidenceComplete: true };
    expect(computeReviewDecision({ isStale: false, environmentAvailable: true, findings: [], checks: [scanner, suite({ noPassingTests: true }), introduced] }).status)
      .toBe("changes_requested");
  });
});

import { describe, expect, it } from "vitest";
import { computeReviewDecision, consentRuns, declaresTestScript, lockfileManager, projectTests } from "../src/index.js";

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

// What BuildIT can run for a JavaScript project, decided once from the repository root at the pinned
// commit. The consent panel and the validation worker both read this, because they used to disagree:
// the panel promised "dependency install, test, lint, typecheck" to every repository, while validation
// installs only from a lockfile and, finding none, ran nothing but the scanners - and the verdict then
// read "All required checks passed" for a project whose own test suite never ran.

export type ProjectPackageManager = "npm" | "pnpm" | "yarn";

const lockfiles = [["package-lock.json", "npm"], ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"]] as const;

/** The package manager a root lockfile pins, "ambiguous" when more than one is present, or undefined. */
export function lockfileManager(paths: ReadonlySet<string>): ProjectPackageManager | "ambiguous" | undefined {
  const found = lockfiles.filter(([path]) => paths.has(path)).map(([, manager]) => manager);
  if (found.length > 1) return "ambiguous";
  return found[0];
}

/** Whether a package.json declares a test script worth running. `npm init` writes a placeholder that
 *  only prints "Error: no test specified" and exits 1; that is a repository without tests. */
export function declaresTestScript(packageJson: string | undefined) {
  if (!packageJson) return false;
  try {
    const test = (JSON.parse(packageJson) as { scripts?: Record<string, unknown> }).scripts?.test;
    return typeof test === "string" && test.trim().length > 0 && !/no test specified/i.test(test);
  } catch {
    return false;
  }
}

export type ProjectTests =
  | { runnable: true; manager: ProjectPackageManager }
  | { runnable: false; reason: "no_lockfile"; declaresTests: boolean }
  | { runnable: false; reason: "no_package_json" };

export function projectTests(paths: ReadonlySet<string>, packageJson: string | undefined): ProjectTests {
  if (!paths.has("package.json")) return { runnable: false, reason: "no_package_json" };
  const manager = lockfileManager(paths);
  if (manager === "ambiguous") throw new Error("package_manager_unsupported_or_ambiguous");
  return manager ? { runnable: true, manager } : { runnable: false, reason: "no_lockfile", declaresTests: declaresTestScript(packageJson) };
}

const scanners = ["Gitleaks 8.28.0", "OSV-Scanner 2.2.3", "BuildIT static rules 1.0.0"];

/** The consent panel's "BuildIT will run" list: only what will actually run for this repository.
 *  `undefined` means the repository root could not be read, so nothing about tests is promised. */
export function consentRuns(tests: ProjectTests | undefined): string[] {
  if (!tests) return [...scanners, "the project's test, lint and typecheck scripts only if the commit has a lockfile BuildIT can install from"];
  if (tests.runnable) return ["dependency install with scripts disabled", "test", "lint", "typecheck", ...scanners];
  if (tests.reason === "no_package_json") return [...scanners, "no project tests: this repository has no package.json BuildIT can install from"];
  return [...scanners, tests.declaresTests
    ? "not the project's tests: package.json has a test script, but there is no lockfile (package-lock.json, pnpm-lock.yaml or yarn.lock) at this commit and BuildIT installs only from one, so this review will end inconclusive"
    : "no project tests: there is no lockfile at this commit, and package.json declares no test script"];
}

// How many tests a runner's own output says passed, or undefined when it says nothing readable. Used for
// one decision only: whether a required test suite that fails on both commits still ran well enough to
// count its failures as pre-existing. Absence of a pass count is never read as a pass.
const passPatterns = [
  /Tests?\s*:?\s+(?:[^\n]*?[|,]\s*)?(\d+)\s+passed/gi,   // vitest "Tests  2 failed | 192 passed", jest "Tests: 1 failed, 193 passed"
  /^\s*(\d+)\s+passing\b/gim,                            // mocha "12 passing"
  /^\s*[#\u2139]\s*pass\s+(\d+)/gim,                       // node:test / tap "# pass 12", "\u2139 pass 12"
  /\b(\d+)\s+tests?\s+passed\b/gi,                        // ava "12 tests passed"
  /^\s*Passed:\s+(\d+)/gim,                                // uvu "Passed: 12"
];
export function passedTestCount(output: string | undefined): number | undefined {
  if (!output) return undefined;
  const text = output.replace(/\u001b\[[0-9;]*m/g, "");
  let best: number | undefined;
  for (const pattern of passPatterns) for (const match of text.matchAll(pattern)) {
    const count = Number(match[1]);
    if (Number.isSafeInteger(count)) best = Math.max(best ?? 0, count);
  }
  return best;
}

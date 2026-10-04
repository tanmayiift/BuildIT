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

// How many tests a runner's own output says passed and failed, read only from summary lines anchored
// at the start of a line - "Tests  2 failed | 192 passed (194)", not any sentence containing "test".
// Test files are kept apart from tests: vitest's "Test Files  194 failed | 3 passed" says three files
// ran clean, which does mean tests passed, but not how many. Absence of a count is never a pass. A
// workspace runner's prefix - pnpm's "packages/a test: ", turbo's "a:test: " - is removed first.
export type TestCounts = { passed?: number; failed?: number; filesPassed?: number; filesFailed?: number };

const workspacePrefix = /^(?:(?:\S*\/\S*|\.) [\w:.-]+|[\w@/.-]+:[\w:.-]+):\s+/;  // a path, so never "Test Suites: "
const count = (line: string, word: string) => { const match = new RegExp(`(\\d+)\\s+${word}`, "i").exec(line); return match ? Number(match[1]) : undefined; };

export function testCounts(output: string | undefined): TestCounts {
  if (!output) return {};
  const counts: TestCounts = {};
  const keep = (key: keyof TestCounts, value: number | undefined) => { if (value !== undefined && Number.isSafeInteger(value)) counts[key] = Math.max(counts[key] ?? 0, value); };
  for (const raw of output.replace(/\u001b\[[0-9;]*m/g, "").split(/\r?\n/)) {
    const line = raw.trim().replace(workspacePrefix, "");
    let match: RegExpExecArray | null;
    if ((match = /^Test (?:Files|Suites):?\s+(.*)$/i.exec(line))) { keep("filesPassed", count(match[1]!, "passed")); keep("filesFailed", count(match[1]!, "failed")); continue; }
    if ((match = /^Tests:?\s+(.*)$/i.exec(line))) { keep("passed", count(match[1]!, "passed")); keep("failed", count(match[1]!, "failed")); continue; }  // vitest, jest
    if ((match = /^(\d+)\s+passing\b/i.exec(line))) { keep("passed", Number(match[1])); continue; }                                      // mocha
    if ((match = /^(\d+)\s+failing\b/i.exec(line))) { keep("failed", Number(match[1])); continue; }
    if ((match = /^[#\u2139]\s*pass\s+(\d+)$/i.exec(line))) { keep("passed", Number(match[1])); continue; }                             // node:test, tap
    if ((match = /^[#\u2139]\s*fail\s+(\d+)$/i.exec(line))) { keep("failed", Number(match[1])); continue; }
    if ((match = /^[\u2714\u2716]?\s*(\d+)\s+tests?\s+(passed|failed)$/i.exec(line))) { keep(match[2]!.toLowerCase() === "passed" ? "passed" : "failed", Number(match[1])); continue; } // ava
    if ((match = /^(Passed|Failed):\s+(\d+)$/i.exec(line))) keep(match[1]!.toLowerCase() === "passed" ? "passed" : "failed", Number(match[2])); // uvu
  }
  return counts;
}

/** The counts as one line - "Tests: 192 passed, 2 failed" - or undefined when the output showed none.
 *  Test files are added whenever one failed, or when they are all there is. buildit-demo-zod printed
 *  "Tests 5 failed | 7 passed" beside "Test Files 192 failed | 6 passed": the twelve tests were the few
 *  that loaded, and showing only those made a suite that barely ran look like a small one. */
export function testCountsSummary(counts: TestCounts | undefined): string | undefined {
  if (!counts) return undefined;
  const line = (unit: string, passed: number | undefined, failed: number | undefined) => {
    const parts = [passed === undefined ? "" : `${passed} passed`, failed === undefined ? "" : `${failed} failed`].filter(Boolean);
    return parts.length ? `${unit}: ${parts.join(", ")}` : "";
  };
  const tests = line("Tests", counts.passed, counts.failed);
  const files = !tests || (counts.filesFailed ?? 0) > 0 ? line("Test files", counts.filesPassed, counts.filesFailed) : "";
  return [tests, files].filter(Boolean).join(" · ") || undefined;
}

/** Whether a failed test suite ran too little for its failures to be excused as pre-existing: no test
 *  passed, or more than half of its test files failed. The second clause was decided on 4 Oct 2026,
 *  after the counts showed buildit-demo-zod loading 6 of 198 files; seven passing tests from six files
 *  say nothing about the 192 that never ran. A suite with a few failing files still counts as having run. */
export function testSuiteRanTooLittle(output: string | undefined): boolean {
  const passed = passedTestCount(output);
  if (passed === undefined || passed === 0) return true;
  const { filesPassed, filesFailed } = testCounts(output);
  return filesFailed !== undefined && filesFailed > (filesPassed ?? 0);
}

/** Tests the output shows passing: the test count, or at least the number of clean test files. */
export function passedTestCount(output: string | undefined): number | undefined {
  const counts = testCounts(output);
  if (counts.passed !== undefined || counts.filesPassed !== undefined) return Math.max(counts.passed ?? 0, counts.filesPassed ?? 0);
  return undefined;
}

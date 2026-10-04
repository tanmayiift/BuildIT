import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A project with a test script but no lockfile ran only the scanners and passed. The fix is a chain:
// validation records the test as a required check that did not run, the stored verdict and the
// pull-request comment both read that reason, and the consent panel stops promising tests. Each link
// is a few characters a refactor could drop without any unit test noticing, so each is pinned here.
const read = (path: string) => readFileSync(path, "utf8");

describe("the not-run test reaches every reader", () => {
  it("is injected by validation only for a project with no lockfile that declares tests", () => {
    const worker = read("convex/reviewValidationWorker.ts");
    expect(worker).toMatch(/const untestable = !manager && declaresTestScript\(packageJson\.head\) \? "no_lockfile" as const : undefined;/);
    expect(worker).toMatch(/withUntestableProject\(buildExecutionResponse\(driven\), untestable\)/);
    expect(worker).toMatch(/file\.path === "package\.json" && typeof file\.content === "string"\) packageJson\[revision\] = file\.content/);
  });

  it("carries its reason into the stored verdict and the stored check", () => {
    const data = read("convex/reviewValidationData.ts");
    expect(data).toMatch(/\.\.\.\(check\.notRunReason \? \{ notRunReason: check\.notRunReason \} : \{\}\)/);
    expect(data).toMatch(/\.\.\.\(item\.notRunReason \? \{ notRunReason: item\.notRunReason \} : \{\}\)/);
  });

  it("carries its reason into the pull-request comment's decision", () => {
    expect(read("convex/reviewReportWorker.ts")).toMatch(/\.\.\.\(item\.notRunReason \? \{ notRunReason: item\.notRunReason \} : \{\}\)/);
  });

  it("lets the consent panel promise only what will run", () => {
    const prepare = read("convex/dashboardReviews.ts");
    expect(prepare).toMatch(/runs: consentRuns\(pull\.projectTests\)/);
    expect(prepare).not.toMatch(/runs: \["dependency install/);
  });
});

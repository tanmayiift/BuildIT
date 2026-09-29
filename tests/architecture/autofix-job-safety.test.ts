import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Both drivers of the shared segment loop must treat a claimed job the same way. They did not:
// validation refused a non-resumable job and released its lease on failure, autofix did neither.
//
// The consequences were paid in sandbox minutes. A retry of a round that had passed `prepare`
// re-ran prepare in a fresh sandbox and then checkpointed a stage jump the state machine rejects,
// repeating until the attempt budget was gone; and a failed round left the job `running` with a
// lease reconcileWorker's by_lease sweep (lt(leaseUntil, now)) could never see.
const validation = readFileSync(join(process.cwd(), "convex/reviewValidationWorker.ts"), "utf8");
const autofix = readFileSync(join(process.cwd(), "convex/reviewAutofixWorker.ts"), "utf8");

describe("both segment-loop drivers protect the job the same way", () => {
  it("refuses a job that cannot be resumed", () => {
    for (const [name, source] of [["validation", validation], ["autofix", autofix]] as const) {
      expect(source, `${name} must refuse a claimed job past prepare`).toContain('!== "prepare") throw new Error("execution_segments_not_resumable")');
    }
  });

  it("releases the lease when the run fails", () => {
    for (const [name, source] of [["validation", validation], ["autofix", autofix]] as const) {
      expect(source, `${name} must fail the job so the sweeper can reclaim its sandboxes`).toMatch(/executionJobsData\.fail/);
    }
  });
});

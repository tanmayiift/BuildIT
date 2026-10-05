import { describe, expect, it } from "vitest";
import { autofixDeclineReason, isSafeAutofixDecline } from "./durableReview";

describe("Autofix terminal classification", () => {
  it("turns the absence of independently accepted findings into a safe review handoff", () => {
    expect(isSafeAutofixDecline(new Error("autofix_no_accepted_findings"))).toBe(true);
  });

  it("keeps genuine service and execution errors on the platform-failure path", () => {
    expect(isSafeAutofixDecline(new Error("autofix_artifact_download_503"))).toBe(false);
    expect(isSafeAutofixDecline("autofix_no_accepted_findings")).toBe(false);
  });

  // The workflow hands a worker's error back with its prefix and stack. Every case below uses that
  // exact shape, because tests written against the bare code are how this never matched in production.
  const fromWorkflow = (code: string) => new Error(`Uncaught Error: ${code}\n    at handler (../convex/reviewAutofixWorker.ts:464:12)\n`);

  it("reads the decline out of the message the workflow actually receives", () => {
    expect(autofixDeclineReason(fromWorkflow("autofix_no_accepted_findings"))).toBe("no_accepted_findings");
    expect(autofixDeclineReason(fromWorkflow("autofix_checks_fail_on_base"))).toBe("checks_fail_on_base");
    expect(autofixDeclineReason(fromWorkflow("patch_empty"))).toBe("no_safe_patch");
    expect(autofixDeclineReason(fromWorkflow("patch_path_protected"))).toBe("no_safe_patch");
    expect(autofixDeclineReason(fromWorkflow("autofix_patch_unavailable"))).toBe("no_safe_patch");
  });

  it("leaves bounded stops and real faults to their own paths", () => {
    expect(autofixDeclineReason(fromWorkflow("autofix_repeated_patch"))).toBeUndefined();
    expect(autofixDeclineReason(fromWorkflow("autofix_worsened:required_check_regressed"))).toBeUndefined();
    expect(autofixDeclineReason(fromWorkflow("execution_failed"))).toBeUndefined();
    expect(autofixDeclineReason(fromWorkflow("autofix_artifact_conflict"))).toBeUndefined();
  });
});

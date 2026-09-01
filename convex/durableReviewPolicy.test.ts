import { describe, expect, it } from "vitest";
import { isSafeAutofixDecline } from "./durableReview";

describe("Autofix terminal classification", () => {
  it("turns the absence of independently accepted findings into a safe review handoff", () => {
    expect(isSafeAutofixDecline(new Error("autofix_no_accepted_findings"))).toBe(true);
  });

  it("keeps genuine service and execution errors on the platform-failure path", () => {
    expect(isSafeAutofixDecline(new Error("autofix_artifact_download_503"))).toBe(false);
    expect(isSafeAutofixDecline("autofix_no_accepted_findings")).toBe(false);
  });
});

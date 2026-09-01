import { describe, expect, it } from "vitest";
import { previewErrorMessage } from "./dashboard-review-start";

describe("dashboard preview copy", () => {
  it("gives a person a safe next step for each preview failure", () => {
    expect(previewErrorMessage(new Error("github_app_access_unavailable"))).toContain("GitHub App");
    expect(previewErrorMessage(new Error("pull_request_unavailable"))).toContain("PR number");
    expect(previewErrorMessage(new Error("github_timeout"))).toContain("did not respond");
    expect(previewErrorMessage(new Error("unknown"))).toContain("No source was read");
  });
});

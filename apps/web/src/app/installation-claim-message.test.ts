import { describe, expect, it } from "vitest";
import { installationClaimErrorMessage } from "./installation-claim-message";

describe("installation claim recovery", () => {
  it.each([
    ["account_installation_mismatch", "different GitHub account"],
    ["organization_installation_requires_admin_verification", "organization owner"],
    ["github_identity_incomplete", "session is incomplete"],
    ["authentication_required", "session is incomplete"],
    ["installation_already_claimed", "another BuildIT workspace"],
    ["github_installation_token_404", "Confirm the App is active"],
  ])("maps %s to a stable recovery action", (code, expected) => {
    expect(installationClaimErrorMessage(new Error(code))).toContain(expected);
  });

  it("does not expose arbitrary thrown data", () => {
    const message = installationClaimErrorMessage(new Error("provider leaked-secret-value"));
    expect(message).not.toContain("leaked-secret-value");
  });
});

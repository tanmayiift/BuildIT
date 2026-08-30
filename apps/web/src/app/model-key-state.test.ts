import { describe, expect, it } from "vitest";
import { credentialErrorCode, credentialErrorMessage, credentialNeedsIdentityRecovery, credentialReauthenticationHref, needsFreshCredentialAuthentication } from "./model-key-state";

describe("model-key recovery", () => {
  it("expires the entry form at the exact server-provided time", () => {
    expect(needsFreshCredentialAuthentication(10_000, 9_999)).toBe(false);
    expect(needsFreshCredentialAuthentication(10_000, 10_000)).toBe(true);
    expect(needsFreshCredentialAuthentication(undefined, 1)).toBe(true);
  });

  it("keeps safe provider and repository choices through reauthentication", () => {
    expect(credentialReauthenticationHref("gemini", "repo-1")).toBe("/sign-in?reauth=1&returnTo=%2Fsetup%2Fmodel%3Fprovider%3Dgemini%26repository%3Drepo-1");
  });

  it("states that an expired or forbidden submission was not stored", () => {
    for (const code of ["recent_reauthentication_required", "not_found_or_forbidden"] as const) {
      expect(credentialErrorMessage(code)).toContain("No key was stored");
    }
  });

  it("offers fresh identity proof for both stale-login and changed-scope failures", () => {
    expect(credentialNeedsIdentityRecovery("recent_reauthentication_required")).toBe(true);
    expect(credentialNeedsIdentityRecovery("not_found_or_forbidden")).toBe(true);
    expect(credentialNeedsIdentityRecovery("invalid_key")).toBe(false);
    expect(credentialNeedsIdentityRecovery(undefined)).toBe(false);
  });

  it("does not expose an arbitrary broker error", () => {
    const code = credentialErrorCode(new Error("provider leaked-secret-value"));
    expect(code).toBe("credential_save_failed");
    expect(credentialErrorMessage(code)).not.toContain("leaked-secret-value");
  });

  it("separates an existing key from a stale service deployment", () => {
    expect(credentialErrorMessage("credential_scope_already_exists")).toContain("Use Replace");
    expect(credentialErrorMessage("service_update_required")).toContain("being updated");
    expect(credentialNeedsIdentityRecovery("service_update_required")).toBe(false);
  });
});

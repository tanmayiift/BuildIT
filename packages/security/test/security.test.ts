import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { credentialAad, decryptSecret, encryptSecret, fingerprint, redact, sanitizeGitHub } from "../src/index.js";

describe("security", () => {
  it("binds ciphertext to the exact organization, repository, credential, and purpose", () => {
    const key = randomBytes(32);
    const scope = { organizationId: "org-a", repositoryId: "repo-a", credentialId: "cred-a", purpose: "model-provider" } as const;
    const ciphertext = encryptSecret("sk-ant-secretvalue", key, credentialAad(scope));
    expect(decryptSecret(ciphertext, key, credentialAad(scope))).toBe("sk-ant-secretvalue");
    for (const changed of [
      { ...scope, organizationId: "org-b" },
      { ...scope, repositoryId: "repo-b" },
      { ...scope, credentialId: "cred-b" },
      { ...scope, purpose: "tracker" as const },
    ]) expect(() => decryptSecret(ciphertext, key, credentialAad(changed))).toThrow();
  });

  it("redacts and neutralizes output", () => {
    expect(sanitizeGitHub("@buildit use ghp_abcdefghijk <img src=x>")).toBe("＠buildit use [REDACTED] ");
  });

  it("uses keyed stable fingerprints", () => {
    const key = randomBytes(32);
    expect(fingerprint("x", key)).toBe(fingerprint("x", key));
    expect(fingerprint("x", key)).not.toBe(fingerprint("y", key));
  });

  it("redacts provider keys", () => expect(redact("token sk-proj_abcdefghijk")).not.toContain("abcdefghijk"));
});

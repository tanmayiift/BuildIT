import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { credentialAad, decryptSecret, encryptSecret, envelopeDecryptSecret, envelopeEncryptSecret, fingerprint, type KmsClient, redact, redactForModel, rotateEnvelope, sanitizeGitHub } from "../src/index.js";

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

  it("redacts provider keys", () => {
    expect(redact("token sk-proj_abcdefghijk")).not.toContain("abcdefghijk");
    const gemini = ["AI", "za", "SyA", "1234567890", "1234567890", "1234567890"].join("");
    expect(redact(`gemini ${gemini}`)).toBe("gemini [REDACTED]");
  });

  it("redacts model-bound credentials without shifting evidence lines", () => {
    const input = "first\npassword='super-secret-value-123'\n-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----\nlast";
    const output = redactForModel(input);
    expect(output).not.toContain("super-secret-value-123");
    expect(output).not.toContain("abc123");
    expect(output.split("\n")).toHaveLength(input.split("\n").length);
  });

  it("uses a separate wrapped data key and binds KMS unwrap to the tenant scope", async () => {
    const wrappingKeys=new Map([["kms-v1",randomBytes(32)],["kms-v2",randomBytes(32)]]),contexts=new Map<string,string>();
    const kms:KmsClient={
      async generateDataKey({keyId,encryptionContext}){const plaintextKey=randomBytes(32),id=randomBytes(16).toString("hex"),mask=wrappingKeys.get(keyId)!;contexts.set(id,JSON.stringify(encryptionContext));return{plaintextKey,encryptedKey:Buffer.concat([Buffer.from(id),Buffer.from(plaintextKey.map((byte,index)=>byte^mask[index]!))])}},
      async decryptDataKey({keyId,encryptedKey,encryptionContext}){const id=Buffer.from(encryptedKey).subarray(0,32).toString(),wrapped=Buffer.from(encryptedKey).subarray(32),mask=wrappingKeys.get(keyId)!;if(contexts.get(id)!==JSON.stringify(encryptionContext))throw new Error("kms_context_mismatch");return Buffer.from(wrapped.map((byte,index)=>byte^mask[index]!))},
      async rewrapDataKey({sourceKeyId,destinationKeyId,encryptedKey,encryptionContext}){const plain=await this.decryptDataKey({keyId:sourceKeyId,encryptedKey,encryptionContext}),id=Buffer.from(encryptedKey).subarray(0,32),mask=wrappingKeys.get(destinationKeyId)!;return Buffer.concat([id,Buffer.from(plain.map((byte,index)=>byte^mask[index]!))])},
    };
    const scope={organizationId:"org-a",repositoryId:"repo-a",credentialId:"cred-a",purpose:"model-provider"} as const;
    const encrypted=await envelopeEncryptSecret("provider-secret",scope,kms,"kms-v1",1);
    expect(await envelopeDecryptSecret(encrypted,scope,kms,"kms-v1")).toBe("provider-secret");
    await expect(envelopeDecryptSecret(encrypted,{...scope,organizationId:"org-b"},kms,"kms-v1")).rejects.toThrow("kms_context_mismatch");
    // The stored row names the key to decrypt with, and an org admin supplied that row, so
    // nothing but this deployment's own key is accepted.
    await expect(envelopeDecryptSecret({...encrypted,kmsKeyId:"arn:aws:kms:eu-west-1:999999999999:key/attacker"},scope,kms,"kms-v1")).rejects.toThrow("kms_key_id_refused");
    const rotated=await rotateEnvelope(encrypted,scope,kms,"kms-v2",2);
    expect(rotated).toMatchObject({kmsKeyId:"kms-v2",keyVersion:2,ciphertext:encrypted.ciphertext});
    expect(await envelopeDecryptSecret(rotated,scope,kms,"kms-v2")).toBe("provider-secret");
    await expect(rotateEnvelope(rotated,scope,kms,"kms-v2",2)).rejects.toThrow("key_version_must_increase");
  });
});

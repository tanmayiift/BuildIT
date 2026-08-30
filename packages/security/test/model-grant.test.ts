import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { issueModelInvocationGrant, verifyModelInvocationGrant } from "../src/model-grant";

const secret = new Uint8Array(32).fill(4), now = 10_000;
const scope = { organizationId: "org-a", repositoryId: "repo-a", reviewId: "review-a", credentialScopeId: "credential-a", provider: "gemini" as const, model: "gemini-2.5-pro", stage: "findings" as const, requestHash: createHash("sha256").update("request").digest("hex") };

describe("one-use model invocation grants", () => {
  it("accepts one exact tenant, credential, model, stage, and request", async () => {
    const consume = vi.fn(async () => true), token = issueModelInvocationGrant(scope, secret, now);
    await expect(verifyModelInvocationGrant(token, secret, { now: now + 1, consume })).resolves.toMatchObject(scope);
    expect(consume).toHaveBeenCalledOnce();
  });

  it("rejects tampering, replay, expiry, invalid hashes, and long grants", async () => {
    const token = issueModelInvocationGrant(scope, secret, now);
    await expect(verifyModelInvocationGrant(`${token}x`, secret, { now, consume: async () => true })).rejects.toThrow("model_grant_invalid");
    await expect(verifyModelInvocationGrant(token, secret, { now, consume: async () => false })).rejects.toThrow("model_grant_replayed");
    await expect(verifyModelInvocationGrant(token, secret, { now: now + 121_000, consume: async () => true })).rejects.toThrow("model_grant_expired");
    expect(() => issueModelInvocationGrant({ ...scope, requestHash: "bad" }, secret, now)).toThrow("model_grant_scope_invalid");
    expect(() => issueModelInvocationGrant({ ...scope, ttlMs: 120_001 }, secret, now)).toThrow("model_grant_ttl_invalid");
  });

  it("does not place provider credentials in the signed grant", () => {
    const token = issueModelInvocationGrant(scope, secret, now);
    const claims = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8")) as Record<string, unknown>;
    expect(claims).not.toHaveProperty("apiKey");
    expect(claims).not.toHaveProperty("encryptedCiphertext");
  });
});

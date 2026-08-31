import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { issueModelInvocationGrant } from "@buildit/security";
import { handleModelInvocation, type StoredCredential } from "../src/index";
import { ProviderError } from "@buildit/providers";

const secret = new Uint8Array(32).fill(6), now = 10_000;
const credential: StoredCredential = { id: "credential-a", organizationId: "org-a", repositoryId: "repo-a", provider: "gemini", ciphertext: "cipher", nonce: "nonce", tag: "tag", wrappedDataKey: "wrapped", kmsKeyId: "kms", envelopeVersion: 1, keyVersion: 1, aadDigest: "a".repeat(64), maskedSuffix: "1234", status: "valid", createdBy: "owner-a", createdAt: 1, lastValidatedAt: 1 };
const providerRequest = { model: "gemini-2.5-pro", system: "Return evidence only", input: "pinned context", schemaName: "result", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false }, maxOutputTokens: 100 };
function fixture(changes: Record<string, unknown> = {}) {
  const body = JSON.stringify({ organizationId: "org-a", repositoryId: "repo-a", reviewId: "review-a", stage: "findings", credential, request: providerRequest, ...changes });
  const token = issueModelInvocationGrant({ organizationId: "org-a", repositoryId: "repo-a", reviewId: "review-a", credentialScopeId: "credential-a", provider: "gemini", model: "gemini-2.5-pro", stage: "findings", requestHash: createHash("sha256").update(body).digest("hex") }, secret, now);
  return { body, token };
}

describe("model broker HTTP boundary", () => {
  it("uses a credential once for one exact structured provider call", async () => {
    const { body, token } = fixture(), withCredential = vi.fn(async (_id, access, use) => use("gemini", "raw-provider-key"));
    const generateWithRetry = vi.fn(async (_provider, key) => { expect(key).toBe("raw-provider-key"); return { value: { ok: true }, provider: "gemini", model: "gemini-2.5-pro", finishReason: "STOP", inputTokens: 12, outputTokens: 2 }; });
    const response = await handleModelInvocation(new Request("https://broker/api/model", { method: "POST", body, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } }), { grantSecret: secret, consume: async () => true, broker: { withCredential } as never, providers: { generateWithRetry } as never, now });
    expect(response.status).toBe(200);
    expect(withCredential).toHaveBeenCalledWith("credential-a", { actorId: "review-worker", organizationId: "org-a", repositoryId: "repo-a" }, expect.any(Function));
    const output = await response.json();
    expect(output).toEqual({ result: expect.objectContaining({ value: { ok: true }, inputTokens: 12 }) });
    expect(JSON.stringify(output)).not.toContain("raw-provider-key");
  });

  it("rejects tenant swaps and request changes before decrypting", async () => {
    const original = fixture(), withCredential = vi.fn();
    for (const body of [fixture({ organizationId: "org-b" }).body, original.body.replace("pinned context", "changed context")]) {
      const response = await handleModelInvocation(new Request("https://broker/api/model", { method: "POST", body, headers: { authorization: `Bearer ${original.token}` } }), { grantSecret: secret, consume: async () => true, broker: { withCredential } as never, now });
      expect(response.status).toBe(403);
    }
    expect(withCredential).not.toHaveBeenCalled();
  });

  it("rejects replay and unsupported models with redacted errors", async () => {
    const replay = fixture();
    expect((await handleModelInvocation(new Request("https://broker/api/model", { method: "POST", body: replay.body, headers: { authorization: `Bearer ${replay.token}` } }), { grantSecret: secret, consume: async () => false, broker: {} as never, now })).status).toBe(410);
    const unsupported = fixture({ request: { ...providerRequest, model: "unapproved-model" } }), withCredential = vi.fn(async (_id, _access, use) => use("gemini", "secret"));
    const response = await handleModelInvocation(new Request("https://broker/api/model", { method: "POST", body: unsupported.body, headers: { authorization: `Bearer ${unsupported.token}` } }), { grantSecret: secret, consume: async () => true, broker: { withCredential } as never, now });
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });

  it("returns only a provider HTTP status for a malformed structured response", async () => {
    const { body, token } = fixture();
    const response = await handleModelInvocation(new Request("https://broker/api/model", { method: "POST", body, headers: { authorization: `Bearer ${token}` } }), { grantSecret: secret, consume: async () => true, broker: { withCredential: async (_id: string, _access: unknown, use: (provider: "gemini", key: string) => Promise<unknown>) => use("gemini", "raw-provider-key") } as never, providers: { generateWithRetry: async () => { throw new ProviderError("malformed_response", 400); } } as never, now });
    await expect(response.json()).resolves.toEqual({ error: "malformed_response", providerStatus: 400 });
  });
});

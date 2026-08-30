import { afterEach, describe, expect, it, vi } from "vitest";
import { ConvexCredentialGateway } from "../src/convex-gateway";

afterEach(() => vi.unstubAllGlobals());

describe("user-authorized Convex credential gateway", () => {
  it("forwards only the user bearer token and encrypted fields", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { path: string; args: Record<string, unknown> };
      return Response.json(body.path.includes("authorize") ? { status: "success", value: { actorId: "user-a" } } : { status: "success", value: { id: "doc-a" } });
    });
    vi.stubGlobal("fetch", fetch);
    const gateway = new ConvexCredentialGateway("https://tenant.convex.cloud", "signed-user-token");
    await expect(gateway.authorize({ token: "signed-user-token", organizationId: "org-a", repositoryId: "repo-a" })).resolves.toEqual({ actorId: "user-a" });
    await gateway.insert({ id: "123e4567-e89b-12d3-a456-426614174000", organizationId: "org-a", repositoryId: "repo-a", provider: "gemini",
      ciphertext: "cipher", nonce: "nonce", tag: "tag", wrappedDataKey: "wrapped", kmsKeyId: "kms", envelopeVersion: 1,
      keyVersion: 1, aadDigest: "a".repeat(64), maskedSuffix: "1234", status: "valid", createdBy: "user-a", createdAt: 1, lastValidatedAt: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of fetch.mock.calls) expect((init.headers as Record<string, string>).authorization).toBe("Bearer signed-user-token");
    const stored = JSON.parse(String(fetch.mock.calls[1]![1].body)) as { args: Record<string, unknown> };
    expect(stored.args).toMatchObject({ encryptedCiphertext: "cipher", authTag: "tag", organizationId: "org-a", repositoryId: "repo-a" });
    expect(JSON.stringify(stored)).not.toContain("provider-key");
  });

  it("rejects a changed bearer token and redacts unknown Convex errors", async () => {
    const gateway = new ConvexCredentialGateway("https://tenant.convex.cloud", "signed-user-token");
    await expect(gateway.authorize({ token: "other-token", organizationId: "org-a" })).rejects.toThrow("authentication_required");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "error", errorMessage: "database secret detail" }, { status: 400 })));
    await expect(gateway.authorize({ token: "signed-user-token", organizationId: "org-a" })).rejects.toThrow("credential_store_unavailable");
  });

  it("preserves the safe recent-login recovery code from nested Convex errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "error", errorMessage: "Server Error", errorData: { code: "ConvexError", data: "recent_reauthentication_required" } }, { status: 500 })));
    const gateway = new ConvexCredentialGateway("https://tenant.convex.cloud", "signed-user-token");
    await expect(gateway.authorize({ token: "signed-user-token", organizationId: "org-a" })).rejects.toThrow("recent_reauthentication_required");
  });

  it("accepts Ireland deployment URLs but rejects lookalike hosts", () => {
    expect(() => new ConvexCredentialGateway("https://tacit-coyote-455.eu-west-1.convex.cloud", "token")).not.toThrow();
    expect(() => new ConvexCredentialGateway("https://convex.cloud.evil.example", "token")).toThrow("credential_gateway_configuration_invalid");
  });
});

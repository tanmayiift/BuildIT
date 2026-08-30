import { describe, expect, it, vi } from "vitest";
import type { CredentialStore, StoredCredential } from "../src/index";
import { CredentialBroker } from "../src/index";
import type { KmsClient } from "@buildit/security";

function fixtures() {
  let saved: StoredCredential | null = null;
  const store: CredentialStore = {
    insert: vi.fn(async value => { saved = value; }),
    get: vi.fn(async () => saved),
    markUsed: vi.fn(async () => undefined),
    revoke: vi.fn(async () => undefined),
  };
  const key = new Uint8Array(32).fill(7);
  const kms: KmsClient = {
    generateDataKey: vi.fn(async () => ({ plaintextKey: key.slice(), encryptedKey: new Uint8Array([8, 9]) })),
    decryptDataKey: vi.fn(async () => key.slice()),
    rewrapDataKey: vi.fn(async () => new Uint8Array([10])),
  };
  const providers = { validateKey: vi.fn(async () => true) };
  return { store, kms, providers, getSaved: () => saved };
}

describe("credential broker", () => {
  it("validates and stores only a tenant-bound encrypted value", async () => {
    const f = fixtures();
    const broker = new CredentialBroker(f.store, f.kms, "kms-key", f.providers as never, () => 100);
    const result = await broker.save({ actorId: "user-a", organizationId: "org-a", repositoryId: "repo-a", provider: "gemini", apiKey: "a-secret-provider-key" });
    expect(f.providers.validateKey).toHaveBeenCalledWith("gemini", "a-secret-provider-key");
    expect(result).toMatchObject({ provider: "gemini", maskedSuffix: "-key", status: "valid" });
    expect(f.getSaved()).not.toHaveProperty("apiKey");
    expect(f.getSaved()!.ciphertext).not.toContain("a-secret-provider-key");
    expect(f.getSaved()!.repositoryId).toBe("repo-a");
  });

  it("decrypts for exactly one authorized provider callback", async () => {
    const f = fixtures();
    const broker = new CredentialBroker(f.store, f.kms, "kms-key", f.providers as never, () => 100);
    const saved = await broker.save({ actorId: "user-a", organizationId: "org-a", provider: "openai", apiKey: "a-secret-provider-key" });
    const use = vi.fn(async (_provider, apiKey) => apiKey.length);
    await expect(broker.withCredential(saved.id, { actorId: "user-a", organizationId: "org-a" }, use)).resolves.toBe(21);
    expect(use).toHaveBeenCalledOnce();
    expect(f.store.markUsed).toHaveBeenCalledWith(saved.id, 100);
  });

  it("rejects cross-organization and cross-repository access before decrypting", async () => {
    const f = fixtures();
    const broker = new CredentialBroker(f.store, f.kms, "kms-key", f.providers as never);
    const saved = await broker.save({ actorId: "user-a", organizationId: "org-a", repositoryId: "repo-a", provider: "anthropic", apiKey: "a-secret-provider-key" });
    await expect(broker.withCredential(saved.id, { actorId: "user-b", organizationId: "org-b", repositoryId: "repo-a" }, vi.fn())).rejects.toThrow("credential_not_found_or_forbidden");
    await expect(broker.withCredential(saved.id, { actorId: "user-a", organizationId: "org-a", repositoryId: "repo-b" }, vi.fn())).rejects.toThrow("credential_not_found_or_forbidden");
    expect(f.kms.decryptDataKey).not.toHaveBeenCalled();
  });

  it("does not persist a key that fails live provider validation", async () => {
    const f = fixtures();
    f.providers.validateKey.mockRejectedValueOnce(new Error("invalid_key") as never);
    const broker = new CredentialBroker(f.store, f.kms, "kms-key", f.providers as never);
    await expect(broker.save({ actorId: "user-a", organizationId: "org-a", provider: "gemini", apiKey: "invalid-provider-key" })).rejects.toThrow("invalid_key");
    expect(f.store.insert).not.toHaveBeenCalled();
    expect(f.kms.generateDataKey).not.toHaveBeenCalled();
  });
});

import { createHash, randomUUID } from "node:crypto";
import { ProviderClient, type ProviderName } from "@buildit/providers";
import {
  credentialAad,
  envelopeDecryptSecret,
  envelopeEncryptSecret,
  type CredentialAadScope,
  type EnvelopeCiphertext,
  type KmsClient,
} from "@buildit/security";

export type StoredCredential = EnvelopeCiphertext & {
  id: string;
  organizationId: string;
  repositoryId?: string;
  provider: ProviderName;
  aadDigest: string;
  maskedSuffix: string;
  status: "valid" | "invalid" | "revoked";
  createdBy: string;
  createdAt: number;
  lastValidatedAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
};

export type CredentialStore = {
  insert(value: StoredCredential): Promise<void>;
  get(id: string): Promise<StoredCredential | null>;
  markUsed(id: string, at: number): Promise<void>;
  revoke(id: string, organizationId: string, actorId: string, at: number): Promise<void>;
};

export type CredentialAccess = {
  actorId: string;
  organizationId: string;
  repositoryId?: string;
};

function scopeFor(value: Pick<StoredCredential, "id" | "organizationId" | "repositoryId">): CredentialAadScope {
  return {
    organizationId: value.organizationId,
    ...(value.repositoryId ? { repositoryId: value.repositoryId } : {}),
    credentialId: value.id,
    purpose: "model-provider",
  };
}

function assertAccess(credential: StoredCredential, access: CredentialAccess) {
  if (credential.organizationId !== access.organizationId) throw new Error("credential_not_found_or_forbidden");
  if (credential.repositoryId && credential.repositoryId !== access.repositoryId) throw new Error("credential_not_found_or_forbidden");
  if (credential.status !== "valid") throw new Error("credential_unavailable");
}

export class CredentialBroker {
  constructor(
    private readonly store: CredentialStore,
    private readonly kms: KmsClient,
    private readonly kmsKeyId: string,
    private readonly providers = new ProviderClient(),
    private readonly now = () => Date.now(),
  ) {}

  async save(input: CredentialAccess & { provider: ProviderName; apiKey: string }) {
    await this.providers.validateKey(input.provider, input.apiKey);
    const id = randomUUID();
    const scope = scopeFor({ id, organizationId: input.organizationId, ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}) });
    const envelope = await envelopeEncryptSecret(input.apiKey, scope, this.kms, this.kmsKeyId);
    const timestamp = this.now();
    const stored: StoredCredential = {
      ...envelope,
      id,
      organizationId: input.organizationId,
      ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
      provider: input.provider,
      aadDigest: createHash("sha256").update(credentialAad(scope)).digest("hex"),
      maskedSuffix: input.apiKey.slice(-4),
      status: "valid",
      createdBy: input.actorId,
      createdAt: timestamp,
      lastValidatedAt: timestamp,
    };
    await this.store.insert(stored);
    return { id, provider: stored.provider, maskedSuffix: stored.maskedSuffix, status: stored.status, lastValidatedAt: timestamp };
  }

  async withCredential<T>(credentialId: string, access: CredentialAccess, use: (provider: ProviderName, apiKey: string) => Promise<T>) {
    const credential = await this.store.get(credentialId);
    if (!credential) throw new Error("credential_not_found_or_forbidden");
    assertAccess(credential, access);
    const plaintext = await envelopeDecryptSecret(credential, scopeFor(credential), this.kms);
    try {
      const result = await use(credential.provider, plaintext);
      await this.store.markUsed(credential.id, this.now());
      return result;
    } finally {
      // JavaScript strings cannot be reliably zeroed. The value is scoped to this call and is never returned or logged.
    }
  }

  async revoke(credentialId: string, access: CredentialAccess) {
    const credential = await this.store.get(credentialId);
    if (!credential) throw new Error("credential_not_found_or_forbidden");
    assertAccess(credential, access);
    await this.store.revoke(credential.id, access.organizationId, access.actorId, this.now());
  }
}
export * from "./artifacts.js";
export * from "./http.js";

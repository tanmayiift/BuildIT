import { randomUUID } from "node:crypto";
import type { CredentialAuthorization } from "./http.js";
import type { CredentialStore, StoredCredential } from "./index.js";

type ConvexResult = { status?: unknown; value?: unknown; errorMessage?: unknown; errorData?: unknown };

function stableConvexError(result: ConvexResult): Error {
  const text = `${String(result.errorMessage ?? "")} ${JSON.stringify(result.errorData ?? "")}`;
  for (const code of ["authentication_required", "not_found_or_forbidden", "recent_reauthentication_required", "credential_scope_already_exists"])
    if (text.includes(code)) return new Error(code);
  return new Error("credential_store_unavailable");
}

async function callConvex(url: string, token: string, operation: "query" | "mutation", path: string, args: Record<string, unknown>) {
  const response = await fetch(`${url.replace(/\/$/, "")}/api/${operation}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }), signal: AbortSignal.timeout(8_000),
  });
  let result: ConvexResult;
  try { result = await response.json() as ConvexResult; } catch { throw new Error("credential_store_unavailable"); }
  if (!response.ok || result.status !== "success") throw stableConvexError(result);
  return result.value;
}

export class ConvexCredentialGateway implements CredentialStore {
  readonly authorize: CredentialAuthorization;

  constructor(private readonly convexUrl: string, private readonly token: string) {
    if (!/^https:\/\/[a-z0-9-]+\.convex\.cloud$/.test(convexUrl) || !token) throw new Error("credential_gateway_configuration_invalid");
    this.authorize = async input => {
      if (input.token !== this.token) throw new Error("authentication_required");
      const value = await callConvex(this.convexUrl, this.token, "query", "integrations:authorizeCredentialWrite", {
        organizationId: input.organizationId, ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
      });
      if (!value || typeof value !== "object" || typeof (value as { actorId?: unknown }).actorId !== "string") throw new Error("credential_store_unavailable");
      return value as { actorId: string };
    };
  }

  async insert(value: StoredCredential) {
    await callConvex(this.convexUrl, this.token, "mutation", "integrations:storeEncryptedCredential", {
      organizationId: value.organizationId, ...(value.repositoryId ? { repositoryId: value.repositoryId } : {}),
      credentialScopeId: value.id, provider: value.provider, encryptedCiphertext: value.ciphertext,
      nonce: value.nonce, authTag: value.tag, aadDigest: value.aadDigest, wrappedDataKey: value.wrappedDataKey,
      kmsKeyId: value.kmsKeyId, envelopeVersion: value.envelopeVersion, keyVersion: value.keyVersion,
      maskedSuffix: value.maskedSuffix, lastValidatedAt: value.lastValidatedAt,
      requestId: `credential-create:${randomUUID()}`,
    });
  }

  async get(): Promise<StoredCredential | null> { throw new Error("credential_read_not_configured"); }
  async markUsed(): Promise<void> { throw new Error("credential_use_not_configured"); }
  async revoke(): Promise<void> { throw new Error("credential_revoke_not_configured"); }
}

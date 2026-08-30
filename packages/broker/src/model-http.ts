import { createHash } from "node:crypto";
import { approvedProviderModels, ProviderClient, type ProviderRequest } from "@buildit/providers";
import { verifyModelInvocationGrant, type ModelStage } from "@buildit/security";
import type { CredentialBroker, StoredCredential } from "./index.js";

const maxBodyBytes = 400_000;

type InvocationBody = {
  organizationId: string; repositoryId: string; reviewId: string; stage: ModelStage;
  credential: StoredCredential;
  request: ProviderRequest;
};

function json(status: number, body: Record<string, unknown>) { return Response.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }
function bearer(request: Request) { const value = request.headers.get("authorization") ?? ""; if (!value.startsWith("Bearer ") || value.length > 8_200) throw new Error("authentication_required"); return value.slice(7); }
function safe(error: unknown) {
  const code = error instanceof Error ? error.message : "model_invocation_failed";
  if (code === "authentication_required") return { status: 401, code };
  if (code === "invalid_request") return { status: 400, code };
  if (["model_grant_invalid", "model_grant_scope_invalid"].includes(code)) return { status: 403, code: "model_grant_invalid" };
  if (["model_grant_expired", "model_grant_replayed"].includes(code)) return { status: 410, code };
  if (["invalid_key", "refused", "truncated", "malformed_response"].includes(code)) return { status: 422, code };
  if (code === "rate_limited") return { status: 429, code };
  return { status: 503, code: "model_invocation_failed" };
}
function validCredential(value: unknown): value is StoredCredential {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return ["id", "organizationId", "provider", "ciphertext", "nonce", "tag", "wrappedDataKey", "kmsKeyId", "aadDigest", "maskedSuffix", "status", "createdBy"].every(key => typeof item[key] === "string")
    && item.envelopeVersion === 1 && item.keyVersion === 1 && typeof item.createdAt === "number" && typeof item.lastValidatedAt === "number"
    && (item.repositoryId === undefined || typeof item.repositoryId === "string");
}
function validRequest(value: unknown): value is ProviderRequest {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.model === "string" && typeof item.system === "string" && typeof item.input === "string"
    && typeof item.schemaName === "string" && item.schema !== null && typeof item.schema === "object" && !Array.isArray(item.schema)
    && Number.isInteger(item.maxOutputTokens) && Number(item.maxOutputTokens) > 0 && Number(item.maxOutputTokens) <= 8_000;
}
function parse(raw: string): InvocationBody {
  let value: Record<string, unknown>;
  try { value = JSON.parse(raw) as Record<string, unknown>; } catch { throw new Error("invalid_request"); }
  const allowed = new Set(["organizationId", "repositoryId", "reviewId", "stage", "credential", "request"]);
  if (Object.keys(value).some(key => !allowed.has(key)) || typeof value.organizationId !== "string" || typeof value.repositoryId !== "string" || typeof value.reviewId !== "string"
    || typeof value.stage !== "string" || !validCredential(value.credential) || !validRequest(value.request)) throw new Error("invalid_request");
  return value as unknown as InvocationBody;
}

export async function handleModelInvocation(request: Request, input: {
  grantSecret: Uint8Array;
  consume: (grantId: string, expiresAt: number) => Promise<boolean>;
  broker: CredentialBroker | ((credential: StoredCredential) => CredentialBroker);
  providers?: ProviderClient;
  now?: number;
}) {
  try {
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    const token = bearer(request), declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > maxBodyBytes) return json(413, { error: "request_too_large" });
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > maxBodyBytes) return json(413, { error: "request_too_large" });
    const body = parse(raw), requestHash = createHash("sha256").update(raw).digest("hex");
    const grant = await verifyModelInvocationGrant(token, input.grantSecret, { ...(input.now === undefined ? {} : { now: input.now }), consume: input.consume });
    if (grant.organizationId !== body.organizationId || grant.repositoryId !== body.repositoryId || grant.reviewId !== body.reviewId
      || grant.stage !== body.stage || grant.credentialScopeId !== body.credential.id || grant.provider !== body.credential.provider
      || grant.model !== body.request.model || grant.requestHash !== requestHash) throw new Error("model_grant_scope_invalid");
    const broker = typeof input.broker === "function" ? input.broker(body.credential) : input.broker;
    const result = await broker.withCredential(body.credential.id, { actorId: "review-worker", organizationId: body.organizationId, repositoryId: body.repositoryId },
      (provider, apiKey) => (input.providers ?? new ProviderClient()).generateWithRetry(provider, apiKey, body.request, approvedProviderModels[provider]));
    return json(200, { result });
  } catch (error) {
    const mapped = safe(error);
    return json(mapped.status, { error: mapped.code });
  }
}

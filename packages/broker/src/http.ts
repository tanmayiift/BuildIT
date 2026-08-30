import type { ProviderName } from "@buildit/providers";
import type { CredentialBroker } from "./index.js";

const providers = new Set<ProviderName>(["anthropic", "openai", "gemini"]);
const maxBodyBytes = 16 * 1024;

export type CredentialAuthorization = (input: {
  token: string; organizationId: string; repositoryId?: string;
}) => Promise<{ actorId: string }>;

function json(status: number, body: Record<string, unknown>, origin?: string) {
  return new Response(JSON.stringify(body), { status, headers: {
    "content-type": "application/json", "cache-control": "no-store",
    "x-content-type-options": "nosniff", ...(origin ? { "access-control-allow-origin": origin, vary: "origin" } : {}),
  } });
}

export async function handleCredentialSave(request: Request, input: {
  allowedOrigin: string; authorize: CredentialAuthorization; broker: CredentialBroker;
}) {
  const origin = request.headers.get("origin");
  if (origin !== input.allowedOrigin) return json(403, { error: "origin_not_allowed" });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
    "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type", "access-control-max-age": "600", vary: "origin",
  } });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, origin);
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maxBodyBytes) return json(413, { error: "request_too_large" }, origin);
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || authorization.length > 8_200) return json(401, { error: "authentication_required" }, origin);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBodyBytes) return json(413, { error: "request_too_large" }, origin);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw) as Record<string, unknown>; } catch { return json(400, { error: "invalid_request" }, origin); }
  const allowed = new Set(["organizationId", "repositoryId", "provider", "apiKey", "replacesCredentialId"]);
  if (Object.keys(body).some(key => !allowed.has(key)) || typeof body.organizationId !== "string"
    || body.organizationId.length < 5 || typeof body.apiKey !== "string" || body.apiKey.length < 16
    || !providers.has(body.provider as ProviderName)
    || (body.repositoryId !== undefined && typeof body.repositoryId !== "string")
    || (body.replacesCredentialId !== undefined && typeof body.replacesCredentialId !== "string")) {
    return json(400, { error: "invalid_request" }, origin);
  }
  const token = authorization.slice(7);
  const organizationId = body.organizationId as string;
  const repositoryId = body.repositoryId as string | undefined;
  const provider = body.provider as ProviderName;
  const apiKey = body.apiKey as string;
  try {
    const scope = { token, organizationId, ...(repositoryId ? { repositoryId } : {}) };
    const { actorId } = await input.authorize(scope);
    const saved = await input.broker.save({ actorId, organizationId,
      ...(repositoryId ? { repositoryId } : {}), provider, apiKey,
      ...(typeof body.replacesCredentialId === "string" ? { replacesCredentialId: body.replacesCredentialId } : {}) });
    return json(201, { credential: saved }, origin);
  } catch (error) {
    const code = error instanceof Error ? error.message : "credential_save_failed";
    const safe = code === "recent_reauthentication_required" || code === "rate_limited" ? code
      : code === "invalid_key" ? code
        : code === "not_found_or_forbidden" || code === "authentication_required" ? "not_found_or_forbidden"
          : "credential_save_failed";
    const status = safe === "invalid_key" ? 422 : safe === "rate_limited" ? 429 : safe === "recent_reauthentication_required" ? 401 : safe === "not_found_or_forbidden" ? 404 : 503;
    return json(status, { error: safe }, origin);
  }
}

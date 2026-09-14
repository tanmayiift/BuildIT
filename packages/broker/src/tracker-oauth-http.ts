import { trackerOAuthRequestHash, verifyTrackerOAuthGrant } from "@buildit/security";
import type { TrackerOAuthBroker, TrackerOAuthEnvelope, TrackerOAuthScope } from "./tracker-oauth.js";
const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
export async function handleTrackerOAuth(request: Request, input: { broker: TrackerOAuthBroker; grantSecret: Uint8Array; consume: (id: string, expiresAt: number) => Promise<boolean>; now?: number }) {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  try {
    const authorization = request.headers.get("authorization") ?? ""; if (!authorization.startsWith("Bearer ")) return json(401, { error: "authentication_required" });
    const raw = await request.text(); if (Buffer.byteLength(raw) > 150_000) return json(413, { error: "request_too_large" });
    const grant = await verifyTrackerOAuthGrant(authorization.slice(7), input.grantSecret, { consume: input.consume, ...(input.now === undefined ? {} : { now: input.now }) });
    if (trackerOAuthRequestHash(raw) !== grant.requestHash) return json(403, { error: "tracker_oauth_scope_refused" });
    const body = JSON.parse(raw) as { operation: string; scope: TrackerOAuthScope; state?: string; code?: string; envelope?: TrackerOAuthEnvelope; resourceId?: string; projectId?: string; cursor?: string };
    if (body.operation !== grant.operation || body.scope?.organizationId !== grant.organizationId || !["linear", "jira"].includes(body.scope.provider) || !/^[a-f0-9-]{36}$/i.test(body.scope.credentialScopeId) || (body.scope.repositoryId !== undefined && typeof body.scope.repositoryId !== "string")) return json(403, { error: "tracker_oauth_scope_refused" });
    let result: unknown;
    switch (grant.operation) {
      case "availability": result = input.broker.availability(); break;
      case "begin": result = { authorizationUrl: input.broker.begin(body.scope.provider, body.state ?? "") }; break;
      case "exchange": result = await input.broker.exchange(body.scope, { state: body.state ?? "", code: body.code ?? "" }); break;
      case "projects": result = await input.broker.projects(body.scope, body.envelope!, body.resourceId ?? "", body.cursor ?? ""); break;
      case "connect": result = await input.broker.connect(body.scope, body.envelope!, body.resourceId ?? "", body.projectId ?? ""); break;
      case "refresh": result = await input.broker.refresh(body.scope, body.envelope!); break;
      case "revoke": result = await input.broker.revoke(body.scope, body.envelope!); break;
    }
    return json(200, { result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "tracker_oauth_unavailable";
    const safe = ["tracker_oauth_not_configured", "tracker_oauth_configuration_missing", "tracker_oauth_state_invalid", "tracker_oauth_scope_refused", "tracker_oauth_permission_denied", "tracker_oauth_provider_invalid", "tracker_oauth_reconnect_required", "tracker_oauth_rate_limited", "tracker_oauth_grant_invalid", "tracker_oauth_grant_expired", "tracker_oauth_grant_replayed"].includes(code) ? code : "tracker_oauth_unavailable";
    return json(safe.includes("grant_") || safe.includes("scope_") ? 403 : safe === "tracker_oauth_permission_denied" ? 422 : 503, { error: safe });
  }
}

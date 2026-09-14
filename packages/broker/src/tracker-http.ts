import { createHash } from "node:crypto";
import { JiraContextClient, LinearContextClient } from "@buildit/github";
import { credentialAad, envelopeDecryptSecret, verifyTrackerGrant, type EnvelopeCiphertext, type KmsClient } from "@buildit/security";
type StoredTracker = EnvelopeCiphertext & { id: string; organizationId: string; repositoryId?: string; provider: "linear" | "jira"; workspaceId: string; aadDigest: string; status: "active"; createdBy: string; createdAt: number; credentialFormat?: "oauth_bundle_v1"; oauthResourceId?: string; projectKeys?: string[] };
const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
export async function handleTrackerFetch(request: Request, input: { grantSecret: Uint8Array; consume: (id: string, expiresAt: number) => Promise<boolean>; kms: KmsClient; kmsKeyId: string; http?: (input: string | URL, init?: RequestInit) => Promise<Response>; now?: number }) {
  try {
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) return json(401, { error: "authentication_required" });
    const raw = await request.text(); if (Buffer.byteLength(raw) > 400_000) return json(413, { error: "request_too_large" });
    const body = JSON.parse(raw) as { organizationId?: unknown; repositoryId?: unknown; reviewId?: unknown; url?: unknown; credential?: unknown }, credential = body.credential as StoredTracker;
    if (typeof body.organizationId !== "string" || typeof body.repositoryId !== "string" || typeof body.reviewId !== "string" || typeof body.url !== "string" || !credential || credential.status !== "active" || !credential.id || !credential.kmsKeyId || !credential.wrappedDataKey) return json(400, { error: "invalid_request" });
    const grant = await verifyTrackerGrant(authorization.slice(7), input.grantSecret, { ...(input.now === undefined ? {} : { now: input.now }), consume: input.consume });
    if (grant.organizationId !== body.organizationId || grant.repositoryId !== body.repositoryId || grant.reviewId !== body.reviewId || grant.credentialScopeId !== credential.id || grant.provider !== credential.provider || grant.workspaceId !== credential.workspaceId || grant.urlHash !== createHash("sha256").update(body.url).digest("hex") || credential.organizationId !== body.organizationId || (credential.repositoryId && credential.repositoryId !== body.repositoryId)) throw new Error("tracker_grant_scope_invalid");
    const scope = { organizationId: credential.organizationId, ...(credential.repositoryId ? { repositoryId: credential.repositoryId } : {}), credentialId: credential.id, purpose: "tracker" as const };
    if (createHash("sha256").update(credentialAad(scope)).digest("hex") !== credential.aadDigest) throw new Error("tracker_credential_aad_invalid");
    const secret = await envelopeDecryptSecret(credential, scope, input.kms, input.kmsKeyId);
    let token = secret, cloudId: string | undefined, projectKeys: string[] | undefined;
    if (credential.credentialFormat === "oauth_bundle_v1") {
      const bundle = JSON.parse(secret) as { format?: string; provider?: string; accessToken?: string; expiresAt?: number; resourceId?: string; projectKeys?: string[]; resources?: Array<{ id: string; workspaceId: string }> };
      if (bundle.format !== "oauth_bundle_v1" || bundle.provider !== credential.provider || typeof bundle.accessToken !== "string" || typeof bundle.expiresAt !== "number" || !Array.isArray(bundle.projectKeys) || bundle.projectKeys.length !== 1 || !bundle.resources?.some(resource => resource.id === bundle.resourceId && resource.workspaceId === credential.workspaceId)) throw new Error("tracker_grant_scope_invalid");
      if (bundle.expiresAt <= (input.now ?? Date.now())) return json(200, { result: { status: "inaccessible", version: "tracker_reconnect_required" } });
      token = bundle.accessToken; projectKeys = bundle.projectKeys; cloudId = credential.provider === "jira" ? bundle.resourceId : undefined;
    }
    const result = credential.provider === "linear"
      ? await new LinearContextClient(input.http).fetch({ token, url: body.url, workspaceSlug: credential.workspaceId, ...(credential.credentialFormat ? { oauth: true } : {}), ...(projectKeys ? { projectKeys } : {}) })
      : await new JiraContextClient(input.http).fetch({ token, url: body.url, siteHost: credential.workspaceId, ...(cloudId ? { cloudId } : {}), ...(projectKeys ? { projectKeys } : {}) });
    return json(200, { result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "tracker_fetch_failed";
    return json(["tracker_grant_invalid", "tracker_grant_scope_invalid"].includes(code) ? 403 : code === "tracker_grant_expired" || code === "tracker_grant_replayed" ? 410 : 503, { error: ["tracker_grant_invalid", "tracker_grant_scope_invalid", "tracker_grant_expired", "tracker_grant_replayed"].includes(code) ? code : "tracker_fetch_failed" });
  }
}

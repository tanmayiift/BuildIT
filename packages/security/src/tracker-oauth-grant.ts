import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
export const trackerOAuthOperations = ["availability", "begin", "exchange", "projects", "connect", "refresh", "revoke"] as const;
export type TrackerOAuthOperation = typeof trackerOAuthOperations[number];
export type TrackerOAuthGrant = { version: 1; audience: "buildit-tracker-oauth"; grantId: string; organizationId: string; actorId: string; operation: TrackerOAuthOperation; requestHash: string; issuedAt: number; expiresAt: number };
export const trackerOAuthRequestHash = (body: string) => createHash("sha256").update(body).digest("hex");
function signature(payload: string, secret: Uint8Array) { return createHmac("sha256", secret).update(payload).digest(); }
function valid(value: TrackerOAuthGrant) {
  return value && value.version === 1 && value.audience === "buildit-tracker-oauth" && trackerOAuthOperations.includes(value.operation)
    && [value.organizationId, value.actorId, value.grantId].every(item => typeof item === "string" && item.length > 0 && item.length <= 300)
    && /^[0-9a-f]{64}$/.test(value.requestHash) && Number.isFinite(value.issuedAt) && Number.isFinite(value.expiresAt) && value.expiresAt > value.issuedAt;
}
export function issueTrackerOAuthGrant(input: Pick<TrackerOAuthGrant, "organizationId" | "actorId" | "operation" | "requestHash">, secret: Uint8Array, now = Date.now()) {
  if (secret.byteLength < 32) throw new Error("tracker_oauth_configuration_missing");
  const grant: TrackerOAuthGrant = { ...input, version: 1, audience: "buildit-tracker-oauth", grantId: randomUUID(), issuedAt: now, expiresAt: now + 60_000 };
  if (!valid(grant)) throw new Error("tracker_oauth_grant_invalid");
  const payload = Buffer.from(JSON.stringify(grant)).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}
export async function verifyTrackerOAuthGrant(token: string, secret: Uint8Array, input: { now?: number; consume: (id: string, expiresAt: number) => Promise<boolean> }) {
  if (secret.byteLength < 32 || token.length > 8_000) throw new Error("tracker_oauth_grant_invalid");
  const [payload, encoded, extra] = token.split(".");
  if (!payload || !encoded || extra) throw new Error("tracker_oauth_grant_invalid");
  let grant: TrackerOAuthGrant, actual: Buffer;
  try { grant = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); actual = Buffer.from(encoded, "base64url"); } catch { throw new Error("tracker_oauth_grant_invalid"); }
  const expected = signature(payload, secret), now = input.now ?? Date.now();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected) || !valid(grant)) throw new Error("tracker_oauth_grant_invalid");
  if (grant.expiresAt <= now || grant.issuedAt > now + 5000 || grant.expiresAt - grant.issuedAt > 60_000) throw new Error("tracker_oauth_grant_expired");
  if (!await input.consume(grant.grantId, grant.expiresAt)) throw new Error("tracker_oauth_grant_replayed");
  return grant;
}

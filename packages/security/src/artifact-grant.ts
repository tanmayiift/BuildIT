import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type ArtifactGrant = {
  version: 1;
  audience: "buildit-content-broker";
  grantId: string;
  organizationId: string;
  repositoryId: string;
  reviewId: string;
  artifactId: string;
  storageKey: string;
  operation: "read" | "write" | "delete";
  issuedAt: number;
  expiresAt: number;
};

function encode(value: unknown) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function signature(payload: string, secret: Uint8Array) { return createHmac("sha256", secret).update(payload).digest(); }
function validStorageKey(grant: ArtifactGrant) {
  const prefix = `artifacts/${grant.organizationId}/${grant.repositoryId}/${grant.reviewId}/${grant.artifactId}/`;
  return grant.storageKey.startsWith(prefix) && !grant.storageKey.includes("..") && !grant.storageKey.includes("\\");
}

export function issueArtifactGrant(input: Omit<ArtifactGrant, "version" | "audience" | "grantId" | "issuedAt" | "expiresAt"> & { ttlMs?: number }, secret: Uint8Array, now = Date.now()) {
  const ttlMs = input.ttlMs ?? 60_000;
  if (secret.byteLength < 32) throw new Error("artifact_grant_secret_too_short");
  if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 300_000) throw new Error("artifact_grant_ttl_invalid");
  const { ttlMs: _, ...claims } = input;
  const grant: ArtifactGrant = { version: 1, audience: "buildit-content-broker", grantId: randomUUID(), issuedAt: now, expiresAt: now + ttlMs, ...claims };
  if (!validStorageKey(grant)) throw new Error("artifact_grant_scope_invalid");
  const payload = encode(grant);
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export async function verifyArtifactGrant(token: string, secret: Uint8Array, input: {
  operation: ArtifactGrant["operation"];
  now?: number;
  consume: (grantId: string, expiresAt: number) => Promise<boolean>;
}) {
  if (secret.byteLength < 32) throw new Error("artifact_grant_secret_too_short");
  const [payload, encodedSignature, extra] = token.split(".");
  if (!payload || !encodedSignature || extra) throw new Error("artifact_grant_invalid");
  let actual: Buffer, grant: ArtifactGrant;
  try { actual = Buffer.from(encodedSignature, "base64url"); grant = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ArtifactGrant; } catch { throw new Error("artifact_grant_invalid"); }
  const expected = signature(payload, secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("artifact_grant_invalid");
  const now = input.now ?? Date.now();
  if (grant.version !== 1 || grant.audience !== "buildit-content-broker" || grant.operation !== input.operation || !validStorageKey(grant)) throw new Error("artifact_grant_scope_invalid");
  if (!Number.isFinite(grant.issuedAt) || !Number.isFinite(grant.expiresAt) || grant.issuedAt > now + 5_000 || grant.expiresAt <= now || grant.expiresAt - grant.issuedAt > 300_000) throw new Error("artifact_grant_expired");
  if (!await input.consume(grant.grantId, grant.expiresAt)) throw new Error("artifact_grant_replayed");
  return grant;
}

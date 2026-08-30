import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type ExecutionGrant = { version: 1; audience: "buildit-execution-broker"; grantId: string; organizationId: string; repositoryId: string; reviewId: string; baseSha: string; headSha: string; artifactsHash: string; plansHash: string; issuedAt: number; expiresAt: number };
function signature(payload: string, secret: Uint8Array) { return createHmac("sha256", secret).update(payload).digest(); }
function valid(value: ExecutionGrant) { return value.version === 1 && value.audience === "buildit-execution-broker" && [value.organizationId, value.repositoryId, value.reviewId].every(item => typeof item === "string" && item.length > 0 && item.length <= 200) && /^[0-9a-f]{40}$/.test(value.baseSha) && /^[0-9a-f]{40}$/.test(value.headSha) && /^[0-9a-f]{64}$/.test(value.artifactsHash) && /^[0-9a-f]{64}$/.test(value.plansHash); }

export function issueExecutionGrant(input: Omit<ExecutionGrant, "version" | "audience" | "grantId" | "issuedAt" | "expiresAt"> & { ttlMs?: number }, secret: Uint8Array, now = Date.now()) {
  const ttlMs = input.ttlMs ?? 60_000;
  if (secret.byteLength < 32) throw new Error("execution_grant_secret_too_short");
  if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 120_000) throw new Error("execution_grant_ttl_invalid");
  const { ttlMs: _, ...claims } = input;
  const grant: ExecutionGrant = { version: 1, audience: "buildit-execution-broker", grantId: randomUUID(), issuedAt: now, expiresAt: now + ttlMs, ...claims };
  if (!valid(grant)) throw new Error("execution_grant_scope_invalid");
  const payload = Buffer.from(JSON.stringify(grant)).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export async function verifyExecutionGrant(token: string, secret: Uint8Array, input: { now?: number; consume: (grantId: string, expiresAt: number) => Promise<boolean> }) {
  if (secret.byteLength < 32) throw new Error("execution_grant_secret_too_short");
  const [payload, encodedSignature, extra] = token.split(".");
  if (!payload || !encodedSignature || extra) throw new Error("execution_grant_invalid");
  let grant: ExecutionGrant, actual: Buffer;
  try { grant = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ExecutionGrant; actual = Buffer.from(encodedSignature, "base64url"); } catch { throw new Error("execution_grant_invalid"); }
  const expected = signature(payload, secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("execution_grant_invalid");
  if (!valid(grant)) throw new Error("execution_grant_scope_invalid");
  const now = input.now ?? Date.now();
  if (!Number.isFinite(grant.issuedAt) || !Number.isFinite(grant.expiresAt) || grant.issuedAt > now + 5_000 || grant.expiresAt <= now || grant.expiresAt - grant.issuedAt > 120_000) throw new Error("execution_grant_expired");
  if (!await input.consume(grant.grantId, grant.expiresAt)) throw new Error("execution_grant_replayed");
  return grant;
}

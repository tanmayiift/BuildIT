import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const modelStages = ["requirements", "review_plan", "findings", "critic", "arbitration", "patch", "report"] as const;
export type ModelStage = typeof modelStages[number];
export type ModelInvocationGrant = {
  version: 1;
  audience: "buildit-model-broker";
  grantId: string;
  organizationId: string;
  repositoryId: string;
  reviewId: string;
  credentialScopeId: string;
  provider: "anthropic" | "openai" | "gemini";
  model: string;
  stage: ModelStage;
  requestHash: string;
  issuedAt: number;
  expiresAt: number;
};

function sign(payload: string, secret: Uint8Array) { return createHmac("sha256", secret).update(payload).digest(); }
function valid(value: ModelInvocationGrant) {
  return value.version === 1 && value.audience === "buildit-model-broker"
    && [value.organizationId, value.repositoryId, value.reviewId, value.credentialScopeId, value.model].every(item => typeof item === "string" && item.length > 0 && item.length <= 200)
    && ["anthropic", "openai", "gemini"].includes(value.provider)
    && modelStages.includes(value.stage)
    && /^[0-9a-f]{64}$/.test(value.requestHash);
}

export function issueModelInvocationGrant(input: Omit<ModelInvocationGrant, "version" | "audience" | "grantId" | "issuedAt" | "expiresAt"> & { ttlMs?: number }, secret: Uint8Array, now = Date.now()) {
  const ttlMs = input.ttlMs ?? 60_000;
  if (secret.byteLength < 32) throw new Error("model_grant_secret_too_short");
  if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 120_000) throw new Error("model_grant_ttl_invalid");
  const { ttlMs: _, ...claims } = input;
  const grant: ModelInvocationGrant = { version: 1, audience: "buildit-model-broker", grantId: randomUUID(), issuedAt: now, expiresAt: now + ttlMs, ...claims };
  if (!valid(grant)) throw new Error("model_grant_scope_invalid");
  const payload = Buffer.from(JSON.stringify(grant)).toString("base64url");
  return `${payload}.${sign(payload, secret).toString("base64url")}`;
}

export async function verifyModelInvocationGrant(token: string, secret: Uint8Array, input: { now?: number; consume: (grantId: string, expiresAt: number) => Promise<boolean> }) {
  if (secret.byteLength < 32) throw new Error("model_grant_secret_too_short");
  const [payload, encodedSignature, extra] = token.split(".");
  if (!payload || !encodedSignature || extra) throw new Error("model_grant_invalid");
  let grant: ModelInvocationGrant, actual: Buffer;
  try { grant = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ModelInvocationGrant; actual = Buffer.from(encodedSignature, "base64url"); } catch { throw new Error("model_grant_invalid"); }
  const expected = sign(payload, secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("model_grant_invalid");
  if (!valid(grant)) throw new Error("model_grant_scope_invalid");
  const now = input.now ?? Date.now();
  if (!Number.isFinite(grant.issuedAt) || !Number.isFinite(grant.expiresAt) || grant.issuedAt > now + 5_000 || grant.expiresAt <= now || grant.expiresAt - grant.issuedAt > 120_000) throw new Error("model_grant_expired");
  if (!await input.consume(grant.grantId, grant.expiresAt)) throw new Error("model_grant_replayed");
  return grant;
}

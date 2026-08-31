import { createHmac, timingSafeEqual } from "node:crypto";
import { operationNames, recordOperation, type OperationName, type ReviewStage, type SafeAttributes, type TelemetryOutcome } from "@buildit/telemetry";

const operations = new Set<string>(operationNames);
const stages = new Set<ReviewStage>(["activation", "context", "requirements", "analysis", "critic", "tests", "autofix", "delivery", "decision"]);
const outcomes = new Set<TelemetryOutcome>(["started", "succeeded", "failed", "cancelled", "blocked"]);
const providers = new Set(["anthropic", "openai", "gemini"]);
const modes = new Set(["review", "autofix"]);
const visibilities = new Set(["public", "private"]);
const errorCodes = new Set(["UnknownError", "cancelled", "stale_head", "budget_exhausted", "loop_guard", "provider_error", "runner_error", "upstream_unavailable", "configuration_missing", "timeout", "rate_limited"]);

export type TelemetryIngestEvent = SafeAttributes & { operation: OperationName; outcome: TelemetryOutcome };

function signature(secret: string, body: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export function signTelemetryEvent(secret: string, body: string) {
  return signature(secret, body);
}

export function verifyTelemetrySignature(secret: string, body: string, supplied: string | null) {
  if (!supplied) return false;
  const expected = Buffer.from(signature(secret, body)), received = Buffer.from(supplied);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function parseTelemetryEvent(value: unknown): TelemetryIngestEvent | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>, keys = Object.keys(input);
  if (!keys.length || keys.some(key => !["operation", "outcome", "stage", "provider", "reviewMode", "repositoryVisibility", "errorCode"].includes(key))) return undefined;
  if (typeof input.operation !== "string" || !operations.has(input.operation) || typeof input.outcome !== "string" || !outcomes.has(input.outcome as TelemetryOutcome)) return undefined;
  if (input.stage !== undefined && (typeof input.stage !== "string" || !stages.has(input.stage as ReviewStage))) return undefined;
  if (input.provider !== undefined && (typeof input.provider !== "string" || !providers.has(input.provider))) return undefined;
  if (input.reviewMode !== undefined && (typeof input.reviewMode !== "string" || !modes.has(input.reviewMode))) return undefined;
  if (input.repositoryVisibility !== undefined && (typeof input.repositoryVisibility !== "string" || !visibilities.has(input.repositoryVisibility))) return undefined;
  if (input.errorCode !== undefined && (typeof input.errorCode !== "string" || !errorCodes.has(input.errorCode))) return undefined;
  return input as TelemetryIngestEvent;
}

export async function handleTelemetryIngest(request: Request, secret: string): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > 1024) return Response.json({ error: "payload_too_large" }, { status: 413, headers: { "cache-control": "no-store" } });
  const supplied = request.headers.get("x-buildit-telemetry-signature");
  if (!supplied) return Response.json({ error: "telemetry_unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  const body = await request.text();
  if (Buffer.byteLength(body) > 1024 || !verifyTelemetrySignature(secret, body, supplied)) return Response.json({ error: "telemetry_unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return Response.json({ error: "telemetry_invalid" }, { status: 400, headers: { "cache-control": "no-store" } }); }
  const event = parseTelemetryEvent(parsed);
  if (!event) return Response.json({ error: "telemetry_invalid" }, { status: 400, headers: { "cache-control": "no-store" } });
  recordOperation(event);
  return Response.json({ accepted: true }, { status: 202, headers: { "cache-control": "no-store" } });
}

import { loopbackHttpUrl, type LocalEmailCaptureConfig } from "./emailCaptureConfig.js";
import type { EmailTransport } from "./email.js";
export async function captureEmail(config: LocalEmailCaptureConfig, message: Parameters<EmailTransport>[0], http: typeof fetch = fetch) {
  if (!loopbackHttpUrl(config.backendUrl) || !loopbackHttpUrl(config.captureUrl) || new URL(config.captureUrl).pathname !== "/capture") throw new Error("email_capture_not_local");
  const body = JSON.stringify(message);
  if (new TextEncoder().encode(body).byteLength > 512_000) throw new Error("email_capture_too_large");
  let response: Response;
  try { response = await http(config.captureUrl, { method: "POST", headers: { "content-type": "application/json" }, body, redirect: "error", signal: AbortSignal.timeout(8_000) }); }
  catch { throw new Error("email_capture_unavailable"); }
  if (!response.ok) throw new Error("email_capture_unavailable");
  let receipt: unknown;
  try { receipt = await response.json(); } catch { throw new Error("email_capture_invalid_receipt"); }
  const value = receipt as { kind?: unknown; captureId?: unknown; idempotencyKey?: unknown } | null;
  if (value?.kind !== "captured" || typeof value.captureId !== "string" || !/^[0-9a-f]{64}$/.test(value.captureId) || value.idempotencyKey !== message.idempotencyKey) throw new Error("email_capture_invalid_receipt");
  return { kind: "captured" as const, captureId: value.captureId };
}

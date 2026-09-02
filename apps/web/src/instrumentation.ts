import { registerOTel } from "@vercel/otel";
import { registerBuildITMetrics } from "@buildit/telemetry/register";
import { scrubUrlSpanProcessor } from "@buildit/telemetry/scrub";

export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    registerOTel({ serviceName: "buildit-web", spanProcessors: [scrubUrlSpanProcessor()] });
    registerBuildITMetrics("buildit-web");
  }
}

export async function onRequestError(
  error: { digest?: string } & Error,
  _request: { path: string; method: string; headers: Record<string, string> },
  _context: { routerKind: string; routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { safeLog } = await import("@buildit/telemetry");
  safeLog("next.request_error", {
    operation: "web.request",
    outcome: "failed",
    errorCode: error.name,
  });
}

import { registerOTel } from "@vercel/otel";
import { recordOperation, safeLog, traced, type OperationName } from "@buildit/telemetry";
import { flushBuildITMetrics, registerBuildITMetrics } from "@buildit/telemetry/register";
import { scrubUrlSpanProcessor } from "@buildit/telemetry/scrub";

let registered = false;

export function registerBrokerTelemetry() {
  if (registered) return;
  registered = true;
  registerOTel({ serviceName: "buildit-content-broker", spanProcessors: [scrubUrlSpanProcessor()] });
  registerBuildITMetrics("buildit-content-broker");
}

export function observedBrokerRoute(operation: OperationName, route: (request: Request) => Promise<Response>) {
  return async (request: Request) => traced(`broker.${operation}`, { operation }, async () => {
    const startedAt = Date.now();
    const response = await route(request);
    const outcome = response.status >= 500 ? "failed" : response.status >= 400 ? "blocked" : "succeeded";
    // A route may name its own failure when the status alone is misleading. An exhausted sandbox
    // plan and a crashed sandbox are both 503, and the paging alert could not tell them apart - so
    // a billing limit woke someone at 3am, nightly, until the reset date.
    const declared = response.headers.get("x-buildit-error-code");
    const failure = response.status >= 400 ? { errorCode: declared || `http_${response.status}` } : {};
    recordOperation({ operation, outcome, ...failure, durationMs: Date.now() - startedAt });
    safeLog("broker.request_completed", { operation, outcome, ...failure });
    await flushBuildITMetrics();
    return response;
  });
}

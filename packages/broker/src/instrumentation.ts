import { registerOTel } from "@vercel/otel";
import { recordOperation, safeLog, traced, type OperationName } from "@buildit/telemetry";
import { registerBuildITMetrics } from "@buildit/telemetry/register";

let registered = false;

export function registerBrokerTelemetry() {
  if (registered) return;
  registered = true;
  registerOTel({ serviceName: "buildit-content-broker" });
  registerBuildITMetrics("buildit-content-broker");
}

export function observedBrokerRoute(operation: OperationName, route: (request: Request) => Promise<Response>) {
  return async (request: Request) => traced(`broker.${operation}`, { operation }, async () => {
    const startedAt = Date.now();
    const response = await route(request);
    const outcome = response.status >= 500 ? "failed" : response.status >= 400 ? "blocked" : "succeeded";
    const failure = response.status >= 400 ? { errorCode: `http_${response.status}` } : {};
    recordOperation({ operation, outcome, ...failure, durationMs: Date.now() - startedAt });
    safeLog("broker.request_completed", { operation, outcome, ...failure });
    return response;
  });
}

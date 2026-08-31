import { handleTelemetryIngest } from "../src/telemetry-ingest.js";
import { registerBrokerTelemetry } from "../src/instrumentation.js";
import { flushBuildITMetrics } from "@buildit/telemetry/register";

registerBrokerTelemetry();

export async function POST(request: Request) {
  const secret = process.env.TELEMETRY_INGEST_SECRET;
  if (!secret) return Response.json({ error: "telemetry_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  const response = await handleTelemetryIngest(request, secret);
  // A serverless invocation can end before the periodic exporter interval. A
  // telemetry delivery failure must never turn a valid review event into an
  // application failure, so this is deliberately fail-open.
  await flushBuildITMetrics().catch(() => undefined);
  return response;
}

import { handleTelemetryIngest } from "../src/telemetry-ingest.js";
import { registerBrokerTelemetry } from "../src/instrumentation.js";

registerBrokerTelemetry();

export async function POST(request: Request) {
  const secret = process.env.TELEMETRY_INGEST_SECRET;
  if (!secret) return Response.json({ error: "telemetry_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  return handleTelemetryIngest(request, secret);
}

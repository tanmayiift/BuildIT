import { registerOTel } from "@vercel/otel";

let registered = false;

export function registerBrokerTelemetry() {
  if (registered) return;
  registered = true;
  registerOTel({ serviceName: "buildit-content-broker" });
}

import { metrics } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

let provider: MeterProvider | undefined;
let loggerProvider: LoggerProvider | undefined;

function metricEndpoint(environment: NodeJS.ProcessEnv) {
  if (environment.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT) return environment.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
  const base = environment.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/, "");
  return base ? `${base}/v1/metrics` : undefined;
}

function logEndpoint(environment: NodeJS.ProcessEnv) {
  if (environment.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT) return environment.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
  const base = environment.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/, "");
  return base ? `${base}/v1/logs` : undefined;
}

function headers(value: string | undefined) {
  if (!value) return undefined;
  return Object.fromEntries(value.split(",").map(item => item.split("=", 2).map(part => part.trim())).filter((item): item is [string, string] => Boolean(item[0] && item[1])));
}

export function registerBuildITMetrics(serviceName: "buildit-web" | "buildit-content-broker", environment: NodeJS.ProcessEnv = process.env) {
  if (provider) return provider;
  const url = metricEndpoint(environment);
  if (!url) return undefined;
  const configuredHeaders = headers(environment.OTEL_EXPORTER_OTLP_HEADERS);
  const exporter = new OTLPMetricExporter({ url, ...(configuredHeaders ? { headers: configuredHeaders } : {}) });
  provider = new MeterProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName, [ATTR_SERVICE_VERSION]: environment.VERCEL_GIT_COMMIT_SHA?.slice(0, 40) ?? "local" }),
    readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 15_000 })],
  });
  metrics.setGlobalMeterProvider(provider);
  const logsUrl = logEndpoint(environment);
  if (logsUrl) {
    const logExporter = new OTLPLogExporter({ url: logsUrl, ...(configuredHeaders ? { headers: configuredHeaders } : {}) });
    loggerProvider = new LoggerProvider({ resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName, [ATTR_SERVICE_VERSION]: environment.VERCEL_GIT_COMMIT_SHA?.slice(0, 40) ?? "local" }), processors: [new BatchLogRecordProcessor(logExporter)] });
    logs.setGlobalLoggerProvider(loggerProvider);
  }
  return provider;
}

export async function shutdownBuildITMetrics() {
  const current = provider;
  provider = undefined;
  const currentLogger = loggerProvider;
  loggerProvider = undefined;
  await Promise.all([current?.shutdown(), currentLogger?.shutdown()]);
}

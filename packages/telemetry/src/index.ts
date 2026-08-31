import { metrics, SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

export type ReviewStage = "context" | "requirements" | "analysis" | "critic" | "tests" | "autofix" | "delivery";
export type TelemetryOutcome = "started" | "succeeded" | "failed" | "cancelled" | "blocked";

export type SafeAttributes = {
  stage?: ReviewStage;
  outcome?: TelemetryOutcome;
  provider?: "anthropic" | "openai" | "gemini";
  reviewMode?: "review" | "autofix";
  repositoryVisibility?: "public" | "private";
  errorCode?: string;
  operation?: string;
};

const forbidden = /(api.?key|authorization|cookie|credential|diff|email|file|header|owner|path|prompt|repo.?name|secret|source|stdout|token)/i;
const allowed = new Set(["stage", "outcome", "provider", "reviewMode", "repositoryVisibility", "errorCode", "operation"]);

export function safeAttributes(input: SafeAttributes): Attributes {
  const output: Attributes = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key) || forbidden.test(key) || value === undefined) continue;
    output[`buildit.${key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}`] = String(value).slice(0, 80);
  }
  return output;
}

function instruments() {
  const meter = metrics.getMeter("buildit");
  return {
    operations: meter.createCounter("buildit.operations", { description: "Completed BuildIT operations" }),
    failures: meter.createCounter("buildit.failures", { description: "Failed BuildIT operations" }),
    duration: meter.createHistogram("buildit.operation.duration", { unit: "ms" }),
  };
}

export function recordOperation(attributes: SafeAttributes & { durationMs?: number }) {
  const { durationMs, ...rest } = attributes;
  const labels = safeAttributes(rest);
  const { operations, failures, duration } = instruments();
  operations.add(1, labels);
  if (rest.outcome === "failed" || rest.outcome === "blocked") failures.add(1, labels);
  if (durationMs !== undefined && Number.isFinite(durationMs) && durationMs >= 0) duration.record(durationMs, labels);
}

export async function traced<T>(name: string, attributes: SafeAttributes, task: () => Promise<T>): Promise<T> {
  const tracer = trace.getTracer("buildit");
  const startedAt = Date.now();
  return tracer.startActiveSpan(name, { attributes: safeAttributes({ ...attributes, outcome: "started" }) }, async span => {
    try {
      const result = await task();
      span.setStatus({ code: SpanStatusCode.OK });
      recordOperation({ ...attributes, outcome: "succeeded", durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      const errorCode = error instanceof Error ? error.name : "UnknownError";
      span.setAttributes(safeAttributes({ ...attributes, outcome: "failed", errorCode }));
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorCode });
      recordOperation({ ...attributes, outcome: "failed", errorCode, durationMs: Date.now() - startedAt });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function safeLog(event: string, attributes: SafeAttributes = {}) {
  const span = trace.getActiveSpan();
  const context = span?.spanContext();
  const safeEvent = event.replace(/[^a-z0-9_.-]/gi, "_").slice(0, 80);
  const safeFields = safeAttributes(attributes);
  logs.getLogger("buildit").emit({ body: safeEvent, severityNumber: SeverityNumber.INFO, attributes: safeFields });
  console.info(JSON.stringify({
    event: safeEvent,
    ...safeFields,
    ...(context?.traceId ? { traceId: context.traceId, spanId: context.spanId } : {}),
  }));
}

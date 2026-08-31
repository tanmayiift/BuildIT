import { metrics, SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

export type ReviewStage = "activation" | "context" | "requirements" | "analysis" | "critic" | "tests" | "autofix" | "delivery" | "decision";
export type TelemetryOutcome = "started" | "succeeded" | "failed" | "cancelled" | "blocked";
export const operationNames = [
  "activation.identity", "activation.repository", "activation.preview", "activation.review", "activation.evidence", "activation.decision",
  "artifact.get", "artifact.put", "artifact.delete", "credential.save", "credential.preflight", "credential.revoke", "credential.use",
  "github.check", "github.comment", "github.branch", "github.stacked_pr", "model.invoke", "sandbox.execute", "sandbox.cleanup",
  "review.context", "review.requirements", "review.analysis", "review.critic", "review.tests", "review.autofix", "review.delivery", "review.decision", "review.stale_check",
  "tracker.fetch", "tracker.credential_save", "web.request", "webhook.verify", "webhook.process", "autofix.loop_guard", "telemetry.smoke",
] as const;
export type OperationName = typeof operationNames[number];

export type SafeAttributes = {
  stage?: ReviewStage;
  outcome?: TelemetryOutcome;
  provider?: "anthropic" | "openai" | "gemini";
  reviewMode?: "review" | "autofix";
  repositoryVisibility?: "public" | "private";
  errorCode?: string;
  operation?: OperationName;
};

const forbidden = /(api.?key|authorization|cookie|credential|diff|email|file|header|owner|path|prompt|repo.?name|secret|source|stdout|token)/i;
const allowed = new Set(["stage", "outcome", "provider", "reviewMode", "repositoryVisibility", "errorCode", "operation"]);
const operationSet = new Set<string>(operationNames);
const errorCodes = new Set(["TypeError", "UnknownError", "configuration_missing", "upstream_unavailable", "rate_limited", "timeout", "cancelled", "stale_head", "budget_exhausted", "loop_guard", "deletion_failed", "provider_error", "runner_error", ...Array.from({ length: 600 }, (_, index) => `http_${index}`)]);

export function safeAttributes(input: SafeAttributes): Attributes {
  const output: Attributes = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key) || forbidden.test(key) || value === undefined) continue;
    const normalized = key === "operation" && !operationSet.has(String(value)) ? "other"
      : key === "errorCode" && !errorCodes.has(String(value)) ? "other"
        : String(value).slice(0, 80);
    output[`buildit.${key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}`] = normalized;
  }
  return output;
}

function instruments() {
  const meterProvider = (globalThis as typeof globalThis & { [key: symbol]: { getMeter(name: string): ReturnType<typeof metrics.getMeter> } | undefined })[Symbol.for("buildit.telemetry.meter-provider")];
  const meter = meterProvider?.getMeter("buildit") ?? metrics.getMeter("buildit");
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
      return result;
    } catch (error) {
      const errorCode = error instanceof Error ? error.name : "UnknownError";
      span.setAttributes(safeAttributes({ ...attributes, outcome: "failed", errorCode }));
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorCode });
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

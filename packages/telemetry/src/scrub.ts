// registerOTel's default fetch instrumentation emits http.url and url.full, which are outside
// safeAttributes's allowlist entirely - that allowlist governs the attributes BuildIT sets, not
// the ones auto-instrumentation adds behind it. Bounded today, because GitHub calls use
// numeric-ID routes so no owner/name appears and the worst case is an opaque S3 artifact key -
// but a source-free telemetry claim that only holds for the attributes we happen to set
// ourselves is not the claim being made.

// Structural, so this package does not take a dependency on the trace SDK just to name a type.
type SpanAttributes = Record<string, unknown>;
type EndedSpan = { attributes: SpanAttributes };

const urlAttributes = ["http.url", "url.full"];
const opaqueAttributes = ["http.target", "url.path", "url.query", "db.statement", "http.request.header.authorization"];

export function scrubUrl(value: unknown) {
  try {
    // Origin only. The path is where a repository name, an artifact key or a token would sit.
    return new URL(String(value ?? "")).origin;
  } catch {
    return "[redacted]";
  }
}

export function scrubSpanAttributes(attributes: SpanAttributes) {
  for (const key of urlAttributes) if (attributes[key] !== undefined) attributes[key] = scrubUrl(attributes[key]);
  for (const key of opaqueAttributes) if (attributes[key] !== undefined) attributes[key] = "[redacted]";
  return attributes;
}

// A span processor rather than switching fetch instrumentation off: the timing and status of
// outbound calls are what the operator dashboards are built on, and only the URL is sensitive.
export function scrubUrlSpanProcessor() {
  return {
    onStart() {},
    onEnd(span: EndedSpan) { scrubSpanAttributes(span.attributes); },
    async shutdown() {},
    async forceFlush() {},
  };
}

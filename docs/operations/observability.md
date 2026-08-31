# BuildIT observability

BuildIT exports server-side traces and metrics with OpenTelemetry. Structured logs carry only an event name, bounded BuildIT fields, and the active trace ID. Source code, diffs, prompts, test output, file or repository names, people, credentials, headers, and query strings are forbidden.

## Local check

Run `docker compose -f observability/docker-compose.yml up -d`, then set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` before starting the web app or broker. Grafana is available at `http://localhost:3001` and Prometheus at `http://localhost:9090`. Stop the stack with `docker compose -f observability/docker-compose.yml down`.

## Grafana Cloud

Create a free Grafana Cloud stack and copy its OpenTelemetry endpoint and authentication header from **Connections → OpenTelemetry**. Store them only in the BuildIT web and broker project settings as `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`. Never add them to Convex, Git, screenshots, test fixtures, or browser code.

The dashboard covers operation volume, failure ratio, p95 latency, review stages, model calls, sandbox runs, and artifact operations. The alert rules cover availability, p95 latency, telemetry silence, and failures at deletion, cleanup, webhook verification, loop guards, and stale-head checks. Product activation and human decisions remain sourced from tenant-authorized Convex metric events; they must be exported only as organization-free aggregate counts.

The local stack is a development aid, not the production store. Production alert delivery still requires a Grafana Cloud endpoint and notification destination. Logs in the JavaScript OpenTelemetry SDK are less mature than traces and metrics, so BuildIT keeps structured stdout logs correlated by trace ID as the dependable fallback.

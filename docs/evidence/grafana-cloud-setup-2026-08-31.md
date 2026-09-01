# Grafana Cloud setup evidence — 2026-08-31

This record contains no access token, authorization header, customer identifier, source code, prompt, test output, repository name, or personal data.

- Stack: `peacefulbumblebee2324.grafana.net`
- Region: Grafana Cloud India (`ap-south-1` OTLP gateway)
- Isolated folder: `BuildIT` (`buildit`)
- Dashboard: `BuildIT product and platform health` (`buildit-overview`, version 1)
- Existing Orbit dashboard search result after the change: 12. No Orbit dashboard, folder, data source, alert rule, contact point, or notification policy was written.
- BuildIT-only alert group: `BuildIT release`
- Rules: high failure rate, p95 latency, telemetry silence, and critical safety-boundary failure.
- A 90-day BuildIT collector token authenticated successfully against the OTLP gateway. The token was passed directly to Vercel and was not printed or committed.
- `OTEL_EXPORTER_OTLP_ENDPOINT`, secret `OTEL_EXPORTER_OTLP_HEADERS`, and `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` exist in Production for only the dedicated `buildit-agentic-review/buildit-agentic-review` and `buildit-agentic-review/buildit-content-broker` projects. They were moved out of the earlier PulseTrade team without changing Orbit.
- Local end-to-end proof accepted eight web spans, one safe OTLP log, and BuildIT counter/histogram metrics before the local stack was torn down.

Both BuildIT production Vercel projects were later redeployed with their BuildIT-only telemetry settings. The broker deployment is `dpl_67dea1vW3uoKwNsBd4TK6HGgvnaJ`; anonymous telemetry remains unavailable. A safe BuildIT operation series has been observed without using the collector credential for dashboard administration. Notification delivery is still not claimed. Notification policy remains unchanged because the stack also serves Orbit.

An authenticated browser check on 2026-08-31 confirmed that dashboard `buildit-overview` is visible and that folder `BuildIT` → group `BuildIT release` contains exactly the four provisioned BuildIT rules. The existing Orbit folders and rules remained separate and were not edited. Remaining proof requires live product and worker signals plus a BuildIT-only contact point that receives a telemetry-silence alert; it must not reuse Orbit's contacts.

# Actual local query-error alert drill

**Passed:** after stopping only the isolated Prometheus service, all 14 corrected current Grafana rules generated real `DatasourceError` alerts and the local webhook received them. Restoring Prometheus returned all 14 rules to healthy evaluation and produced matching resolved deliveries for all 14.

- Outage began at 06:12:39 UTC on 14 September 2026.
- All 14 error instances began at 06:13:00 UTC.
- The isolated Prometheus service restarted at 06:14:13 UTC.
- All queries were healthy at the 06:15:57 observation.
- Grafana kept special error instances active until their emitted expiry; the final expiry was 06:18:00 UTC. All 14 resolved deliveries were captured by 06:18:34. This delay was observed through the actual Alertmanager response; no expiry or pending period was shortened.

The exact native current rules changed only `execErrState` from `OK` to `Error` and `notification_settings` to the existing `BuildIT alerts (Tanmay)` receiver name. Expressions, windows, thresholds, labels, and pending periods remained unchanged. The local receiver had a webhook integration pointing only to `http://capture:8080/notifications`; it had no real email address. Captured `DatasourceError` labels retained both `service=buildit` and `grafana_folder=buildit`.

This verifies the error-handling and direct-notification path for all 14 rules in Grafana 12.1.1. It does not verify their individual business threshold breach cases, production datasource behavior, production timing, or actual email delivery. The earlier separate missing-heartbeat drill verifies the unchanged telemetry rule's full five-minute Pending → Firing → Normal lifecycle.

Evidence is in `local-monitoring-error-summary.json`, `local-monitoring-error-state.jsonl`, `local-monitoring-error-notifications.jsonl`, `local-monitoring-error-alertmanager.json`, `local-monitoring-error-emitter.json`, and `local-monitoring-error-outage.json`. Only the disposable `buildit-audit-error-20260914` project and its own volume were removed; see `local-monitoring-error-shutdown.json` and `.log`. No production changes or paid calls occurred in this drill.

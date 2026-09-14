# Isolated BuildIT alert firing and recovery — 14 September 2026

**Passed:** BuildIT's real telemetry recording code and OpenTelemetry exporter delivered a heartbeat through a local collector and Prometheus. The unchanged current `BuildITTelemetrySilent` Grafana rule fired, sent a local notification, recovered after the heartbeat, and sent a resolved notification.

| Event | UTC time |
| --- | --- |
| Missing heartbeat entered Pending | 05:48:30 |
| Alert fired after the original five minutes | 05:53:30 |
| Local capture received firing notification | 05:53:31.050989 |
| Application telemetry exporter sent the heartbeat | 05:56:50.011 |
| Alert returned to Normal | 05:58:30 |
| Local capture received resolved notification | 05:58:31.163612 |

All 14 rule objects loaded into the isolated Grafana were identical to the saved current native production export. Original expressions, five-minute pending duration, one-minute evaluation interval, and one-minute query delay remained unchanged. The other 13 rules loaded without evaluation errors; their individual firing and recovery paths were not exercised.

The SDK recorded synthetic `queue_depth=0` using the real `recordMeasurement`, `registerBuildITMetrics`, and flush/shutdown functions. Both SDK-generated HTTP payloads received HTTP 200 from the collector. A loopback-only bridge passed their exact bytes through `docker exec` because the containers had an internal-only network and no published host ports. This tested the actual application SDK/exporter and collector; it did not invoke the production broker's authenticated ingress or a real Convex cron.

Prometheus independently returned `buildit_snapshot` with `buildit_measurement=queue_depth` and value `0`. The warning expression filters out healthy samples, so its unchanged `noDataState=OK` configuration returned **Normal (NoData)** on recovery. This status was checked alongside the present Prometheus heartbeat and the resolved webhook; it was not used by itself to infer recovery.

Runtime versions were Grafana 12.1.1, Prometheus 3.6.0, OpenTelemetry Collector 0.135.0, and Node 24.21.0. Live local Grafana API inspection confirmed that the active notification policy routed only to `http://capture:8080/notifications`. Grafana also created its unused default email contact, which was not referenced by the policy. The Docker network had `internal=true`, so it could not send external notifications. No customer email, paid model call, production rule mutation, or real customer review occurred.

Evidence:

- `local-monitoring-summary.json`: asserted timeline and limits.
- `local-monitoring-state.jsonl`: successive actual Grafana states and Prometheus query results.
- `local-monitoring-notifications.jsonl`: sanitized real local firing/resolved deliveries.
- `local-monitoring-emitter.json`: actual exporter receipts, source hashes, and payload hashes.
- `local-monitoring-isolation.json`: exact 14-rule comparison, internal network, container images, and disposable volume.
- `local-monitoring-runtime.json`: local Grafana rule inventory, contact/policy inventory, and Prometheus version/freshness.
- `local-monitoring-shutdown.json` and `.log`: removal of only the `buildit-audit-20260914` compose project and its disposable volume.

The scripts and private local configuration remain under ignored `.local/audit-monitoring`. The ephemeral admin password was consumed through stdin and was never included in command arguments or evidence. Production Grafana rule cleanup, production notification delivery, real cron/broker ingress, and the other 13 alert scenarios remain separate verification work.

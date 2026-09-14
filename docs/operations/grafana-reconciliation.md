# BuildIT Grafana reconciliation

The approved stack is peacefulbumblebee2324.grafana.net. The source defines 14 rules in
folder `buildit`, group `buildit-release`. Native UI exports captured on 2026-09-14 contain
14 current rules and 12 legacy rules in folder `BuildIT`, group `BuildIT release`.
Exports are snapshots; they do not prove telemetry freshness or unique folder UIDs.

## Prepare evidence without changes

Run `node scripts/provision-buildit-grafana-alerts.mjs --dry-run` to validate the local source.
For live evidence use a BuildIT read credential with alert-rule and folder read access and
query access to datasource `grafanacloud-prom`, supplied through the existing environment.

```bash
node scripts/provision-buildit-grafana-alerts.mjs --report > .local/buildit-grafana-reconciliation.json
```

The report intentionally exits nonzero if drift, legacy rules, an unconfigured BuildIT recipient, or stale telemetry remain.
It makes only GET requests to the pinned stack. It emits no credential or customer fields.
It also reads contact-point configuration without emitting its recipient settings. It checks the native execution graph rather than trusting the saved original Prometheus
definition: Grafana stores that original separately, so an export alone can miss manual changes.

A cleanup candidate must match all of: exact legacy folder UID resolved from the unique title
`BuildIT`, group `BuildIT release`, a unique rule UID, and the exact UID/title pair below.
The mapped replacement must be present in the committed rule set. There is no title normalization
or fallback matching by similar spelling. The live report includes the candidate's full native
API-object fingerprint and the replacement title/UID and verification state. Unknown rules and
all other groups remain outside cleanup candidates. Any unrecognized legacy rule, duplicate UID,
ambiguous folder, current-rule drift, missing replacement, or stale/missing telemetry prevents
cleanup readiness. No candidates also means no cleanup is ready or needed.

| Legacy UID | Exact legacy title | Replacement title |
| --- | --- | --- |
| `afwt2cuzwjf9cd` | BuildIT telemetry silent | `BuildITTelemetrySilent` |
| `ffwt2e95zmfpcc` | BuildIT high failure rate | `BuildITHighFailureRate` |
| `dfwt2f4rivshsb` | BuildIT p95 latency high | `BuildITP95LatencyHigh` |
| `efwt2f5a94dtsb` | BuildIT critical boundary failure | `BuildITCriticalBoundaryFailure` |
| `buildit-queue-depth-high` | BuildIT queue depth high | `BuildITQueueDepthHigh` |
| `buildit-provider-failure` | BuildIT provider failure | `BuildITProviderFailure` |
| `buildit-runner-failure` | BuildIT runner failure | `BuildITRunnerFailure` |
| `buildit-artifact-backlog` | BuildIT artifact deletion backlog | `BuildITArtifactDeletionBacklog` |
| `buildit-webhook-signature` | BuildIT webhook signature spike | `BuildITWebhookSignatureSpike` |
| `buildit-loop-guard` | BuildIT loop guard trip | `BuildITLoopGuardTrip` |
| `buildit-stale-check` | BuildIT stale check | `BuildITStaleCheck` |
| `buildit-budget-exhaustion` | BuildIT budget exhaustion spike | `BuildITBudgetExhaustionSpike` |

## Query errors and notification delivery

The initial 2026-09-14 native current export contains a reproduced monitoring defect: all 14
rules use `execErrState: OK` and omit `notification_settings`. Grafana's Prometheus converter
sets its error default to OK. A matching Prometheus expression therefore does not prove a
working alert. The corrected verification requires `execErrState: Error`, `noDataState: OK`,
and the explicit existing receiver `BuildIT alerts (Tanmay)`, plus a configured email
integration that has recovery messages enabled. The initial export now correctly fails this check.

`Error` gives query failures their own `DatasourceError` alert. The direct receiver also applies
to those alerts; they need not match a renamed-alert routing policy. Healthy warning queries
can legitimately return no series because their comparison filters them out, so No Data remains
OK. The heartbeat's `absent_over_time` expression and its 15-minute window are unchanged.

Provisioning first requires the existing unique `buildit` folder, the exact managed rule
inventory, and the existing BuildIT email contact. It submits the original expressions through
the converter with an explicit receiver, then re-reads and updates only those current rule UIDs
with the error and notification settings. It compares each native rule immediately before the
write and verifies saved settings and graphs after every write and once more at the end. Failed
or partial application remains a failed command; it is not reported as a successful provision.
No contact, destination email address, folder, or global notification policy is created.

Configuration checks are not proof of email delivery. Test the approved existing contact
separately and inspect notification history before retiring legacy rules. Preserve both the
before and after native exports, and compare the exact changed fields. The planned corrective
fields are only `execErrState` and `notification_settings`; expressions, query windows, thresholds,
labels, pending durations, and No Data behavior remain unchanged.

A reversible pause is not equivalent to verified legacy removal. Before pausing even an exact
legacy rule, verify its replacement and delivery path and record why its old predicate is
obsolete. Never bulk-pause a folder merely because its title looks familiar. Paused rules can
produce a resolved notification with reason Paused, which must not be counted as genuine metric
recovery. Keep the strict API inventory gate failed while API access or legacy reconciliation
remains unresolved.

The authenticated Grafana UI exposes these legacy rules as provisioned and has no pause-evaluation
control. Once the reviewed API credential is available, the approved eight-rule operation is
guarded by `scripts/pause-buildit-grafana-legacy.mjs`. It resolves the unique `BuildIT` folder,
requires the exact UID/title pairs for the eight approved duplicates, writes only `isPaused: true`,
and reads every rule back. Use `BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN` in the environment, never
as a command-line argument or committed file:

```bash
read -rs BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN && export BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN
pnpm alerts:pause-legacy --dry-run
pnpm alerts:pause-legacy
```

The command refuses the four legacy rules whose predicates differ and all unrelated folders.

See [Grafana's Error and No Data behavior](https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rule-evaluation/nodata-and-error-states/)
and the [version 12.1.1 converter defaults](https://github.com/grafana/grafana/blob/v12.1.1/pkg/services/ngalert/prom/convert.go).

## Compare existing UI exports offline

When live API access is unavailable, use the separate read-only export report:

```bash
node scripts/report-buildit-grafana-exports.mjs audit/evidence/grafana-current-group-2026-09-14.json audit/evidence/grafana-legacy-group-2026-09-14.json > .local/buildit-grafana-export-comparison.json
```

This checks the captured native evaluation graphs and emits only candidate identities and exact
export-rule fingerprints. Grafana omits a zero pending duration from an export; the graph check
treats that omitted `for` as zero. It explicitly reports telemetry freshness as unknown, folder
UIDs and full-stack inventory as unverified, and cleanup readiness as false. It exits 1 even if
all captured definitions match, because an offline export cannot pass a live gate. A Normal UI
state is not a telemetry timestamp.

The `sha256-canonical-grafana-ui-export-rule-v1` fingerprint hashes the complete exported rule
object with recursively sorted object keys. It is not interchangeable with the fingerprint of
a full native API response. Generate and review the live report, with verified folder UIDs and
fresh telemetry, before production approval or removal. Do not invent folder UIDs or supply a
synthetic fresh snapshot to turn an offline report green.

## Review and apply only after approval

1. Review this exact report, including every candidate UID and fingerprint. Export the matched
   legacy rules into protected local backup storage before removal.
2. If current rules differ, review and approve the committed definition changes first.
   Provisioning the managed group does not remove the old group.
3. Refresh the live report. Require no current-rule drift, no unrecognized legacy rules, and
   telemetry no older than 15 minutes. Require every candidate's mapped replacement to verify.
4. After explicit production approval, remove only approved candidate UIDs using the individual
   alert-rule endpoint. Re-read each candidate immediately before removal and require its
   fingerprint to match the reviewed version. Do not delete a folder, group, policy, or contact point.
5. Run `pnpm alerts:verify`. It must find the expected current definitions, fresh scheduled
   telemetry, and no rules left in the known legacy group. Resolve unknown legacy items individually.
6. In the isolated monitoring setup, verify normal, missing-snapshot, firing, and recovery states.
   Before production closure, observe at least three normal five-minute snapshot intervals and
   verify the approved contact-point delivery separately.

No production change or delivery was performed by this implementation. The report is a review
tool, not a deletion command. Live alert delivery and recovery are not established by unit tests.

References: [Grafana provisioning API](https://grafana.com/docs/grafana/latest/developer-resources/api-reference/http-api/api-legacy/alerting_provisioning/),
[Prometheus converter](https://github.com/grafana/grafana/blob/main/pkg/services/ngalert/prom/convert.go),
[generated evaluation nodes](https://github.com/grafana/grafana/blob/main/pkg/services/ngalert/prom/query.go).

## Pausing a provisioned rule: the header that makes it impossible

Several attempts concluded that Grafana exposes no pause action for provisioned rules, because the
UI does not offer one and the API refused the write. The API does support it. The refusal was:

```
409 alerting.provenanceMismatch
cannot update with provided provenance '', needs 'api'
```

These rules were created through `/api/convert/prometheus/...` with `x-disable-provenance: true`,
which records provenance `api`. Sending that same header on the **update** asks Grafana to write
provenance `''`, and it refuses to change a rule's provenance underneath itself. Dropping the header
lets the update inherit `api` and succeed.

So: `x-disable-provenance` on create, **not** on update.

```js
// 12 of 12 succeeded once the header was removed.
await fetch(`/api/v1/provisioning/alert-rules/${uid}`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...rule, isPaused: true }),
});
```

Pausing rather than deleting, because it is reversible and the corrected copies in
`buildit-release` already carry every rule's intent. Verified by reading the provisioning API back:
**14 active in `buildit-release`, 12 paused in `BuildIT release`**, dashboard unchanged at 14 panels.

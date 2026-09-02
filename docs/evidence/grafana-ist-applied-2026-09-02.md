# Operator alerts render in IST

Date: 2026-09-02. Stack: `peacefulbumblebee2324.grafana.net`.

Grafana Cloud does not read `observability/grafana/provisioning/*.yml` — that file is this
repository's source of truth, not something Grafana polls. The contact point
`BuildIT alerts (Tanmay)` had referenced the template for some time, but the template itself had
never been created in Grafana, so both references resolved to nothing and the stock UTC layout was
used instead.

Applied `buildit-operator-v1` through the provisioning API using an authenticated browser session,
so no service account token was created or handled.

Verified with Grafana's own template preview against a sample firing alert:

| | |
|---|---|
| `startsAt` | `2026-09-01T06:38:44Z` |
| Rendered | `Started: 01 Sep 2026, 12:08:44 IST` |

That matches the 12:08 receipt time on the alert mail that prompted this, which is what identifies
the offset as correct rather than merely applied.

Subject rendered as `[ACTION REQUIRED · page] BuildIT · <summary>`.

Only the BuildIT contact point was touched. The two Orbit contact points on the same stack were
read and left unchanged.

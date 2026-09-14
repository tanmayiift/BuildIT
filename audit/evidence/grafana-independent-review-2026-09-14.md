# Independent Grafana repair verification

The real post-edit native UI export passes the strict comparison at **2026-09-14 06:17:07.509 UTC**. Across the same 14 current BuildIT rule UIDs, there are exactly 28 changed fields: each rule changes `execErrState` from `OK` to `Error` and adds `notification_settings.receiver = BuildIT alerts (Tanmay)`. There are **zero unexpected differences**, including cosmetic differences.

Rule titles, current folder title `buildit`, group `buildit-release`, organization number, group interval, rule order, complete native query data, expressions, thresholds, relative query time ranges, pending periods, missing-data behavior, pause state, labels and annotations are unchanged. The exported folder title is checked; native UI group exports do not contain a folder UID, so this comparison does not independently verify that UID or other groups on the stack.

The root agent performed all live UI edits and supplied the actual downloaded post-edit export. This worker could not access the in-app browser: its supported inventory exposed only Chrome, including after a reset. It made no Grafana UI or API changes, did not inspect credentials, and returned tab ownership immediately. The before/after check below used the real exported files, not the prepared candidate.

| Input | SHA-256 |
| --- | --- |
| `grafana-current-group-2026-09-14.json` | `6ca96d13f75f1e85ab337ec405146a05fbce0de8a5a5c3e3edc7f901e19cd19a` |
| `grafana-current-group-after-repair-2026-09-14.json` | `21a1b2bab7fc55d00228d4e59ad1a11531cb283628a76e7a28e4b96dca458834` |

Detailed result: `grafana-current-repair-exact-diff-2026-09-14.json`. The comparator reads two explicit BuildIT JSON files, limits each to 2 MiB, performs no network requests and writes no files. It checks one current group and 14 unique rule UIDs, reports every changed field, and rejects any unapproved difference. JSON object key order is ignored; rule order changes are reported. Exit 0 means the two exports match the specified repair; it does not mean live delivery or full-stack closure.

```bash
node scripts/compare-buildit-grafana-repair-exports.mjs audit/evidence/grafana-current-group-2026-09-14.json audit/evidence/grafana-current-group-after-repair-2026-09-14.json
```

Its 14 regression cases cover the approved changes, a telemetry-only partial repair, changed query/threshold/lag/period/missing-data state/labels/annotation/recipient/timing/cosmetic metadata, invalid scope or rule inventory, and ordering. Comparing the unchanged real export to itself correctly exits 1 with 28 missing repair requirements; receipt `grafana-export-repair-unmodified-command.json`. Tests use the existing sanitized fixture, not an ignored audit file. The actual production comparison uses the original native exports without sanitizing or normalizing their differences.

Independent source review reproduced one additional correctness defect: the provisioning command could report success after a saved query time range changed from 60 to 300 seconds, either immediately after a write or only in the final inventory. The expression remained unchanged, so its previous selected-field check missed this timing change. Both mocked regressions failed as expected in `grafana-native-readback-review-red.log`; no live server was called.

The monitoring worker fixed this by comparing the complete intended native rule with both saved and final results. Only Grafana's `updated` timestamp and `provenance` metadata are excluded; query data, added nodes, scope, labels, annotations, and notification timings must match. This worker read the fix and reran both regressions with the 14 export-comparison cases: **16/16 pass** in `grafana-independent-review-green.log`. Focused ESLint and whitespace checks also pass (`grafana-independent-review-lint.log`). The existing broader provisioning/verification suite remains the monitoring worker's separate evidence.

The reviewed source pins the Grafana destination, refuses redirects, requires the existing BuildIT contact before writes, limits edits to the unique current folder/group, checks each rule for concurrent changes, and verifies the exact saved fields. No other concrete security or routing blocker was reproduced in this bounded review after the readback repair.

This verifies the saved configuration only. It does not establish a production firing event, production email delivery, telemetry freshness, default policy contents, or legacy-rule cleanup. Those remain separate live evidence owned by the root and monitoring workers; isolated alert drills must not be described as production firing tests.

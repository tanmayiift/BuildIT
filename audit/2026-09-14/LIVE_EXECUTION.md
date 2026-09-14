# Approved BuildIT live execution

Started 2026-09-14T05:08:53.224458+00:00 after the user approved all prepared repairs and Bash access. Scope remains BuildIT only; US$10 cumulative external cap. The prior reports describe the previous local-only phase. This file records new live actions and results without rewriting that evidence.

- Fresh repo state remains e9dc368 with the reviewed 163-file patch present. No new source edits at start.
- Session filesystem/network permission granted for BuildIT and its pnpm store.
- Existing audit agents are checking production target/access, real journey prerequisites, and browser execution independently.
- Fresh read of exact Ireland KMS key still matches the reviewed three-statement baseline. Prepared edit retains all three and adds only S3InventoryEncryption. Save/readback pending.

## AWS inventory repair applied

2026-09-14T05:11:42.243902+00:00: saved the exact approved four-statement policy to key db912055-b566-46ed-bfa7-561999d7e4cf in account 882820282590 / eu-west-1. Fresh baseline and editor copy were compared as JSON before Save; returned key-policy page was parsed and matched the full candidate after Save. All three existing statements remain. New successful inventory delivery is still pending its next schedule. No other AWS resource changed. Receipt: ../evidence/aws-kms-applied-2026-09-14.json.

The editor also exposed four pre-existing unsupported kms:DescribeKey encryption-context conditions. This additional code/configuration finding is retained for review; it was not introduced or hidden by the inventory repair.

## AWS key policy validation repaired

2026-09-14T05:27:38.839118+00:00: saved and read back the two unused DescribeKey removals and the exact S3 path condition operator correction (ArnLike to StringLike). The live editor went from four errors and one warning to zero of both. Two meaningful template regressions failed before the fixes; 29 AWS checks now pass. Existing crypto paths and the inventory grant remain. Receipt: ../evidence/aws-key-policy-corrected-2026-09-14.json. [AWS condition compatibility](https://docs.aws.amazon.com/kms/latest/developerguide/conditions-kms.html#conditions-kms-encryption-context) confirms these are string conditions for supported crypto operations.

AWS CloudShell cannot start: its visible error says account verification is in progress and may take up to two days. No environment was deleted and no support request was sent. This blocks shell-based AWS verification, not the policy updates already verified in the console.

## Current application and telemetry checks

Full `pnpm verify` passed after the AWS and review-family budget fixes: 1,897 tests / 216 files, lint, type checks and all builds. Evidence: verify-approved-live-phase.log. A later release-helper retry finding is being repaired and will require a final rerun.

Grafana Explore returned one real scheduled BuildIT snapshot timestamp: 2026-09-14 05:29:22.963 UTC, 110 seconds old when read. All 14 current rules show Normal. This proves fresh telemetry at that instant, not alert delivery/recovery or API verifier completion. Legacy rules remain unchanged. Evidence: grafana-live-freshness-2026-09-14.json.

Native Chrome browser control now works after the user enabled the OS permissions. Local harness fixes allow its exact loopback backend and real session refresh; the signed-in owner Usage page renders recorded spend. The browser test matrix is still running.

Grafana follow-up: the real query inspector reports one query, 61 range rows and one instant row. Its JSON panel contains fresh timestamps across 05:29, 05:34 and 05:39 UTC. This establishes recurring snapshot arrival during three scheduled periods; controlled firing, notification delivery and recovery remain untested. No alert was disabled or deleted.

## Current closure update

The later final source verification passes 1,970 tests in 223 files, with lint, type checks, builds and the high-severity dependency audit clean. The supported CUA Chrome matrix completed 45/45 named cases. All 14 current Grafana rules now have explicit BuildIT email routing and Error-on-execution; isolated heartbeat and datasource-error firing/recovery drills passed, and the labeled delivery test reached the existing Gmail contact. The duplicate `pulsetrade/backend-vercel` Git connection to BuildIT was removed after reproducing its `dist` output failure; its project and old deployment remain preserved. Production deployment, live provider execution, and the eight-rule Grafana pause remain open.

The post-repair AWS S3 read shows a fresh `DailyDeletionAudit` manifest and compressed CSV in the destination, both modified on 2026-09-14 after the KMS repair. The older 2026-09-13 Access Denied status remains historical; the application patch remains undeployed, the production Convex deployment remains unpaused, and no Git push, application deployment, paid provider call, customer email, or Vercel subscription change was made. The exact remaining gates are in `FINAL_STATUS.md` and `PLAN.md`.

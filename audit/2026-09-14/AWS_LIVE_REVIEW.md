# BuildIT AWS read-only review — 2026-09-14

The signed-in account identifies itself as **BuildIT**. Only the dedicated BuildIT stack and its linked resources were inspected. The approved KMS key-policy correction was saved and read back; no bucket, object, account setting, application deployment, or payment was changed. Console observation is configuration evidence; it is not an executed storage/restore/deletion drill.

## Confirmed failure

S3 reports that **DailyDeletionAudit's September 13 inventory export failed with Access denied**, because the destination bucket or KMS key did not grant the required access. The pre-repair live KMS key policy had account administration, broker envelope operations, and broker artifact encryption statements, but no S3 inventory delivery grant. The approved scoped grant is now present in the live policy and repository template; the destination still has no post-repair object.

An encrypted inventory destination requires permission for S3 to generate a data key. The approved repair grants that operation to the S3 service, scoped to this account and artifact source bucket; it does not grant the broker broader access. The live policy was saved and read back through the signed-in KMS console. A successful later inventory export is now visible in the destination: the console shows a manifest, checksum, and compressed CSV modified on 2026-09-14 after the repair. The content read and next scheduled export observation remain open. [AWS inventory permissions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/configure-inventory.html).

## Configuration observations

| Control | Live evidence | Limit of conclusion |
| --- | --- | --- |
| Stack | `buildit-production-artifacts`, `UPDATE_COMPLETE`, Ireland (`eu-west-1`), eight resources | Stack success does not prove report delivery. |
| Artifact encryption | Expected customer-managed KMS key; S3 Bucket Key enabled | No new object was uploaded or decrypted. |
| Public access / ownership | All public access blocked; Bucket owner enforced | Policies were read, not attacked with external credentials. |
| Versioning / Object Lock | Versioning suspended; Object Lock disabled | No conclusion about already expired or deleted historical objects. |
| Artifact lifetime | Enabled `artifacts/` rule expires current objects on day 7; incomplete multipart uploads deleted after 1 day | S3 expiration is asynchronous; no measured deletion SLA from this observation. |
| Replay retention | `ExpungeReplayMarkers` enabled | Source specifies day 1; this rule's detailed live duration was not independently opened. |
| Replication | No replication rules | This is not a regional backup/restore test. |
| Inventory | Enabled, daily CSV, whole bucket, dedicated encrypted inventory bucket and `inventory/` prefix; fresh post-repair objects observed | Content parsing and next scheduled export are still open. |
| Key | Enabled, single region, alias `alias/buildit-production-eu-west-1`, automatic rotation every 365 days | No rotation was triggered. |
| Broker trust | Dedicated Vercel team `buildit-agentic-review`, project `buildit-content-broker`, production environment; matching audience | Assumption was not executed from Vercel in this audit. |
| Resource permissions | Artifact TLS/encryption conditions and restricted broker artifact/replay operations present; broker has no identity policies | Resource-based grants are intentional, so zero identity policies is not itself a defect. |

## Infrastructure ownership drift

CloudFormation still lists the former Vercel team's OIDC provider (`oidc.vercel.com/pulsetrade`), while the active broker trust uses `oidc.vercel.com/buildit-agentic-review`. This difference does **not** establish that runtime access is failing, but a broad stack update could reintroduce old trust or replace a provider unexpectedly. Preserve the existing working trust and review the generated change set before any update. The duplicate `backend-vercel` Git connection was inspected and removed separately in Vercel; no AWS resource for it was changed.

## Approval and post-change evidence

1. Preserve the saved KMS statement and review the identity-provider discrepancy before any broader stack change.
2. Run the strengthened AWS boundary verifier with an existing authorized read profile; missing credentials must fail the release gate.
3. Parse the fresh manifest/CSV with an authorized AWS read path, observe the next scheduled daily export, then perform a separately approved isolated encrypted artifact and expiry drill. Do not infer recovery from a green CloudFormation status alone.

## Post-repair inventory read

The authenticated S3 console now shows a fresh `DailyDeletionAudit` manifest (544 B), checksum (33 B), and compressed CSV (130 B) in the destination, all modified on 2026-09-14 after the repair. The manifest is SSE-KMS encrypted with the repaired BuildIT key, has bucket-key encryption enabled, and is scheduled for deletion by the 14-day lifecycle rule. The console also shows the inventory enabled daily for the whole source bucket with CSV output. Direct signed-object content was blocked by the in-app browser; AWS CloudShell also reports that account verification is in progress and cannot create an environment. Parsing the manifest/CSV and observing the next scheduled export remain open. Receipt: `audit/evidence/aws-inventory-console-read-2026-09-14.json`.

External spend incurred by this audit: **US$0**. Customer content, account contact details, session credentials, and key material are excluded from this report.

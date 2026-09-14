# BuildIT inventory KMS repair for approval

Prepared only. No production policy has been written.

The parent audit verified account `882820282590`, Ireland (`eu-west-1`), source bucket `buildit-production-882820282590-artifacts-eu-west-1`, and key `arn:aws:kms:eu-west-1:882820282590:key/db912055-b566-46ed-bfa7-561999d7e4cf`. The 2026-09-13 inventory export reports access denied. The current key policy contains account administration and both broker grants, but no S3 inventory service grant.

The reviewable addition is `buildit-inventory-kms-statement.json`. It permits only S3 to generate an encryption data key, constrained to this account and exact source bucket. `Resource: "*"` refers to the key whose policy is being updated; this is not a grant across every account key. No decrypt, administrative, broker, bucket, or IAM permissions are added.

AWS documents the required inventory service grant and its source account/bucket constraints in [Configuring Amazon S3 Inventory](https://docs.aws.amazon.com/AmazonS3/latest/userguide/configure-inventory.html#inventory-configure-kms). Destination default KMS encryption still requires the grant. The source template now includes this statement.

## Prepare the full candidate before requesting production approval

1. Confirm the active AWS account is `882820282590`. Read the key by its full pinned ARN above in `eu-west-1`; verify it is enabled and retain its current `default` policy as `buildit-kms-baseline.json`. Keep all top-level policy fields and every existing statement. This operation reads one BuildIT key.
2. Parse the baseline and the addition as JSON. Require a statement array. If `S3InventoryEncryption` already exists and is identical, no write is needed. If that SID exists with different content, stop and review the difference. Otherwise append exactly the one new statement to a deep copy of the baseline; save the full policy as `buildit-kms-candidate.json`.
3. Compare the complete candidate with the baseline. The only change must be the added statement. All existing statements—including any additional statements discovered in the fresh read—must be byte-for-byte equivalent as parsed JSON values. Record both file hashes and show this exact addition for approval. The single-statement file is **not** a full key policy and must never be passed directly to PutKeyPolicy.

## Apply only after approval of that candidate

1. Immediately reread the key's current `default` policy. Compare its parsed JSON with the saved baseline. If anything changed, do not write: rebuild and review the candidate against the new policy. Serialize this operation with any other administrator changing the same key. The [PutKeyPolicy API](https://docs.aws.amazon.com/kms/latest/APIReference/API_PutKeyPolicy.html) has no revision/If-Match field, so a client-side comparison alone cannot eliminate the final race.
2. Submit the approved full candidate to **this exact key only**, retaining the default lockout safety check. The intended write is `aws kms put-key-policy --region eu-west-1 --key-id arn:aws:kms:eu-west-1:882820282590:key/db912055-b566-46ed-bfa7-561999d7e4cf --policy-name default --policy file://audit/evidence/buildit-kms-candidate.json`. This command has not been run.
3. Read the policy back and compare with the candidate. Account administration and both broker statements must remain intact. Allow for the documented KMS propagation delay before treating an immediate stale read as failure.
4. Check the next scheduled inventory export and its newly written encrypted manifest/checksum. The read-only `smoke:aws-boundary` verifier now rejects missing/stale inventory, missing S3 key access, wrong encryption/expiry/destination, and incorrect BuildIT IAM/OIDC trust. An accepted policy update alone is not successful export proof. The initial report can take up to 48 hours.

## Explicit scope boundary

Do **not** deploy the whole CloudFormation stack for this repair. Its ownership record points at a legacy OIDC provider belonging to another project. A full-stack update could replace or remove that provider. This repair changes only the existing BuildIT KMS policy; it does not alter either provider, role trust, buckets, or another project.

The verifier deliberately reports `aws_boundary_oidc_stack_drift` while that ownership mismatch remains. The actual broker trust can be correct even while the stack's resource record differs. This must be reconciled separately without editing/deleting the other project's provider; do not label the entire AWS boundary healthy merely because inventory begins working.

If rollback is needed, reread the current key policy and remove only this exact added statement after review. Do not overwrite newer administrator changes by blindly restoring the saved baseline.

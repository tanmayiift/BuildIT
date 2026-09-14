# AWS inventory permission and verification repair

Source-only work, BuildIT repository only. No AWS write or production deployment.

Confirmed source defect: the inventory destination uses the BuildIT KMS key, but that key allowed account administration and broker operations only. No S3 service permission existed for inventory encryption. The parent independently reproduced the live 2026-09-13 export failure: access to the destination bucket or KMS key was denied; the console policy has the same missing grant.

`infra/aws/artifacts.yaml` now adds one statement: S3 may call `kms:GenerateDataKey` only for the exact source artifact bucket and AWS account. It cannot decrypt or administer the key. The statement uses a literal bucket-name substitution to avoid a CloudFormation dependency cycle.

`verify-aws-boundary.mjs` remains read-only. It now verifies actual source/destination regions, inventory encryption/privacy/version history/14-day expiry, the enabled daily destination configuration, scoped bucket and key policies, a recent manifest/checksum pair and both objects' encryption, exact BuildIT production broker trust, the dedicated OIDC issuer/audience, and matching BuildIT stack ownership. Scope is checked before resource reads. It does not require role identity policies, because the broker uses resource-based permissions. It never reads a legacy other-project provider; it reports stack ownership drift instead.

The grant check deliberately accepts the documented narrow policy shape, not arbitrary IAM-equivalent policies. Unknown extra grant conditions and potentially matching denies fail verification. Recent object metadata is delivery evidence, not a cryptographic content audit of the manifest itself.

Evidence:
- `aws-inventory-red.txt`: 13 meaningful failures before the source/verifier changes. The old verifier incorrectly passed missing key permission and ten broken inventory/identity fixtures.
- `aws-inventory-condition-red.txt`: additional contradictory-condition regression failed before tightening the grant check.
- `aws-inventory-green.txt`: 27 assertions passed across three focused suites, including complete production-like fixture verification, actual YAML policy semantics, foreign-account/bucket rejection, denied decrypt, invalid conditions/denies, wrong object encryption, and read-only command inventory.
- `aws-inventory-lint.txt`: focused lint passed.
- `buildit-inventory-kms-statement.json`: exact additive statement for verified live BuildIT resources.
- `buildit-inventory-kms-apply-review.md`: preparation, approval, fresh-policy comparison, narrow apply, read-back and export proof steps.

The live policy is still unchanged. Production repair requires approval of the additive key-policy change, preserving all current statements. Do not deploy the whole stack: the parent found legacy other-project OIDC ownership drift. Actual export recovery and eventual full boundary verification remain outstanding.

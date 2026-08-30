# AWS boundary re-proof — 2026-08-30

The read-only `pnpm smoke:aws-boundary` probe passed against stack `buildit-production-artifacts` in `eu-west-1` after a fresh temporary AWS browser login.

Source-free observed result:

- S3 encryption: AWS KMS
- Public access: blocked
- Source artifact retention: 7 days
- Replay-record retention: 1 day
- Bucket versioning: disabled, preventing deleted source from remaining in version history
- KMS automatic rotation: enabled

The probe changed no AWS resource and printed no credential. This proves the current storage configuration; it does not replace the broker, sandbox, restore, or incident drills tracked separately.

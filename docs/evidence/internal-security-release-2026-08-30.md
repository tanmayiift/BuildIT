# Internal security release evidence — 2026-08-30

`pnpm security:release` passed 198 tests across 32 files and found no known production dependency vulnerability at high severity or above.

The tested controls cover tenant and parent authorization, session records, webhook and grant integrity, replay, KMS encryption context, ciphertext swapping, model and tracker credentials, artifact upload/read/delete, sandbox command and resource bounds, credential teardown, cancellation, durable workflow fences, merge prohibition, data classification, incident runbooks, and deployment boundaries.

The control matrix pins OWASP ASVS 5.0.0 identifiers in `docs/security/asvs-control-matrix.json`. It is an internal engineering assessment, not an OWASP certification. Session-cookie attributes and least GitHub OAuth/App scopes still require observation against the coordinated production deployment. An independent penetration test and SOC 2 / ISO 27001 audits remain external work and are not represented as passing controls.

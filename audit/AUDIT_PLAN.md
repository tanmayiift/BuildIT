# BuildIT independent audit plan

Note: repository root already contains a private, gitignored `PLAN.md` (362 KB internal
execution plan). It was **not** overwritten. This audit checklist lives here instead.

## Steps

- [x] 1. Confirm repo root, `git status`, read all instruction files (README, AGENTS.md, CLAUDE.md, SECURITY.md, docs).
- [x] 2. Architecture inventory: apps, packages, convex functions, workers, crons, entry points.
- [x] 3. Route / HTTP / public-function / CLI-command inventory.
- [x] 4. Integration inventory (GitHub App, Convex, AWS KMS/S3, Vercel sandbox, Anthropic/OpenAI, Grafana/OTel) + sandbox/mock support.
- [x] 5. Role & permission matrix; tenancy model.
- [x] 6. Existing test-coverage inventory (unit, architecture, reliability, e2e, evals) + TODO/FIXME/skip census.
- [x] 7. Toolchain check: Node/pnpm version conformance, lockfile integrity, `pnpm install --frozen-lockfile`.
- [x] 8. Static checks: `security:tracked-files`, `lint`, `typecheck`, `typecheck:convex`.
- [x] 9. Unit/integration tests: `pnpm test` (full vitest run) + coverage attempt.
- [x] 10. Production build: `pnpm build`.
- [x] 11. Architecture & release-gate suites: `tests/architecture`, `security:release`, `reliability:release`.
- [x] 12. Evaluation suites: `pnpm eval` and eval CLIs (dry/offline where possible).
- [x] 13. Start the web app locally; verify health, boot, console/server logs.
- [x] 14. Browser E2E: `pnpm test:e2e`, tenant-isolation config, accessibility spec.
- [x] 15. Manual browser exploration of every discoverable UI surface + responsive viewports.
- [x] 16. Accessibility audit (automated axe + manual keyboard).
- [x] 17. CLI audit: build + `verify-cli-journeys`, command surface, negative paths.
- [x] 18. API/HTTP endpoint audit: webhook signature, auth, negative paths (local only).
- [x] 19. Data/persistence review: Convex schema, indexes, migrations, retention, tenant isolation.
- [x] 20. Security review: secrets, crypto, headers, CSP, CORS, injection, access control, dep audit.
- [x] 21. Performance/reliability review: bundle size, query patterns, retries, cancellation, backpressure.
- [x] 22. Test-quality audit: assertion strength, mock leakage, skipped tests, journey coverage.
- [x] 23. Documentation-vs-reality audit (README, guides, evidence docs, claims).
- [x] 24. Compile deliverables: PROJECT_AUDIT_REPORT, FEATURE_TEST_MATRIX, DEFECT_REGISTER, COMMAND_LOG.
- [x] 25. Final regression re-run + clean working tree verification + process shutdown.

## Blockers

BLOCK-01 production AWS/sandbox smoke tests · BLOCK-02 two-real-user production isolation · BLOCK-03 all authenticated journeys (no test accounts) · BLOCK-04 live model providers (cost). See DEFECT_REGISTER.md.

## Result

All 25 steps complete. Deliverables: `PROJECT_AUDIT_REPORT.md`, `FEATURE_TEST_MATRIX.md`,
`DEFECT_REGISTER.md`, `COMMAND_LOG.md`, `evidence/`.

No source file was modified (the audit instruction was to list issues and their fixes).

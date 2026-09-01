# BuildIT independent audit plan

Note: repository root already contains a private, gitignored `PLAN.md` (362 KB internal
execution plan). It was **not** overwritten. This audit checklist lives here instead.

## Steps

- [x] 1. Confirm repo root, `git status`, read all instruction files (README, AGENTS.md, CLAUDE.md, SECURITY.md, docs).
- [ ] 2. Architecture inventory: apps, packages, convex functions, workers, crons, entry points.
- [ ] 3. Route / HTTP / public-function / CLI-command inventory.
- [ ] 4. Integration inventory (GitHub App, Convex, AWS KMS/S3, Vercel sandbox, Anthropic/OpenAI, Grafana/OTel) + sandbox/mock support.
- [ ] 5. Role & permission matrix; tenancy model.
- [ ] 6. Existing test-coverage inventory (unit, architecture, reliability, e2e, evals) + TODO/FIXME/skip census.
- [x] 7. Toolchain check: Node/pnpm version conformance, lockfile integrity, `pnpm install --frozen-lockfile`.
- [x] 8. Static checks: `security:tracked-files`, `lint`, `typecheck`, `typecheck:convex`.
- [x] 9. Unit/integration tests: `pnpm test` (full vitest run) + coverage attempt.
- [x] 10. Production build: `pnpm build`.
- [ ] 11. Architecture & release-gate suites: `tests/architecture`, `security:release`, `reliability:release`.
- [ ] 12. Evaluation suites: `pnpm eval` and eval CLIs (dry/offline where possible).
- [ ] 13. Start the web app locally; verify health, boot, console/server logs.
- [ ] 14. Browser E2E: `pnpm test:e2e`, tenant-isolation config, accessibility spec.
- [ ] 15. Manual browser exploration of every discoverable UI surface + responsive viewports.
- [ ] 16. Accessibility audit (automated axe + manual keyboard).
- [ ] 17. CLI audit: build + `verify-cli-journeys`, command surface, negative paths.
- [ ] 18. API/HTTP endpoint audit: webhook signature, auth, negative paths (local only).
- [ ] 19. Data/persistence review: Convex schema, indexes, migrations, retention, tenant isolation.
- [ ] 20. Security review: secrets, crypto, headers, CSP, CORS, injection, access control, dep audit.
- [ ] 21. Performance/reliability review: bundle size, query patterns, retries, cancellation, backpressure.
- [ ] 22. Test-quality audit: assertion strength, mock leakage, skipped tests, journey coverage.
- [ ] 23. Documentation-vs-reality audit (README, guides, evidence docs, claims).
- [ ] 24. Compile deliverables: PROJECT_AUDIT_REPORT, FEATURE_TEST_MATRIX, DEFECT_REGISTER, COMMAND_LOG.
- [ ] 25. Final regression re-run + clean working tree verification + process shutdown.

## Blockers

(none yet)

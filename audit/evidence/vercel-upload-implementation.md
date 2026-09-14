# Vercel upload boundary repair

Verified locally 2026-09-14T05:49:01.658602+00:00. No files were uploaded and no deployment or login was performed.

The existing `.vercelignore` covered local environment files, `.local`, `.vercel`, dependencies, built output and `test-results`, but did not cover the new audit tree, arbitrary logs, coverage reports, Playwright HTML reports, `.pnpm-store` or `.claude`. A Vercel upload could therefore include private audit receipts and unnecessary local material.

Added exactly six exclusions: `audit/`, `*.log`, `coverage/`, `playwright-report/`, `.pnpm-store/`, `.claude/`. The last two directories are present in this checkout. Existing secret exclusions were retained.

The regression tests use the existing installed `ignore` library rather than substring matching. Inspection of the installed Vercel CLI confirmed that its upload tree also calls that library's `ignores` method on relative paths and uses the same parent-directory, wildcard and negation rules. The locked test dependency is ignore 5.3.2 through ESLint; the CLI bundles ignore 4.0.6. No dependency was added. The tests deliberately apply `.vercelignore` alone, so `.gitignore` or CLI defaults cannot conceal a missing exclusion.

The representative upload selection covers root/nested environment files and backups, local captures/backend config, Vercel project links, audit receipts/screenshots, root/nested logs, coverage, browser HTML reports/traces/storage state, package caches and local tool configuration. It retains web/broker/package source, generated Convex declarations, build manifests, scripts, `.env.example` and the nonsecret `scripts/buildit-production.env`. Similar source names (`audit.ts`, `coverageGate.ts`, `logger.ts`) remain included.

**Red:** 15 failing cases / 13 passing cases before the change (`vercel-upload-red.txt`). **Green:** 92 tests passed across 5 focused upload and release-boundary files (`vercel-upload-green.txt`). ESLint (`vercel-upload-lint.txt`) and `git diff --check` pass.

A separate local directory walk using the same matcher selected 640 files and rejected 45 entries (directories prune descendants). No checked private/generated path remained in the selection; actual web/broker source, `.npmrc` and the production target were retained. The count is a timestamped local selection, not a remote upload inventory. See `vercel-upload-selection.json`.

No extra stored-secret defect was found in the inspected baseline paths: nested `.env` files including backups, `.local` and `.vercel` were already excluded. Root `.npmrc` contains one configuration entry with no credential key and remains a valid build input; its contents were not printed. No broad credential filenames were guessed or new secret files created.

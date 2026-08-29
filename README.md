# BuildIT

BuildIT is an autonomous pull-request reviewer and bounded Autofix system. It gathers requirements, checks a pinned commit, runs approved tests and scanners in an isolated environment, verifies AI claims against evidence, and can deliver fixes as a stacked pull request. A human always decides whether to merge.

BuildIT is currently under development. The deployed interface is not evidence that repository access, sandbox execution, or AI review is production-ready.

## Local verification

Requirements: Node.js 22 or 24 and pnpm 10.15.0.

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm test:e2e
```

Copy `.env.example` to `.env.local` only when configuring local services. `.env.local` is ignored by Git and must never be committed.

## Documentation

- [Complete product specification](docs/BuildIT-complete-product-spec-v1.3.md)
- [Security boundaries](docs/architecture/security-boundaries.md)
- [Security policy](SECURITY.md)

The internal execution plan, credentials, deployment identifiers, and source-bearing evidence are deliberately excluded from this repository.

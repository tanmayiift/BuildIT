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

The web application reads its public configuration from `apps/web/.env.local`, not from the repository root, and `NEXT_PUBLIC_CONVEX_URL` there decides which Convex deployment every browser page talks to. CI sets that variable at job level instead, so a green CI run says nothing about whether a local checkout is configured. `pnpm test:e2e` checks the configured deployment before it builds and prints what it found: without the variable it stops immediately rather than timing out, and against a deployment that does not serve `publicProof:summary` it skips the `/proof` assertions with the reason on screen rather than reporting a working page as broken.

## Documentation

- [Complete product specification](docs/BuildIT-complete-product-spec-v1.3.md)
- [Security boundaries](docs/architecture/security-boundaries.md)
- [Security policy](SECURITY.md)

The internal execution plan, credentials, deployment identifiers, and source-bearing evidence are deliberately excluded from this repository.

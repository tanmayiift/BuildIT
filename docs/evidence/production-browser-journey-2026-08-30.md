# Production browser journey — 2026-08-30

Target: `https://buildit-agentic-review.vercel.app`

Command:

```sh
BUILDIT_E2E_BASE_URL=https://buildit-agentic-review.vercel.app pnpm test:e2e
```

Result: 26 of 26 journeys passed in fresh Playwright Chromium sessions: 13 desktop and 13 mobile.

Covered: public product tour, exact-commit sample evidence, signed-out workspace guard, setup recovery, GitHub callback failure, identity-only GitHub OAuth destination, selected-repository GitHub App destination, permission and retention explanations, responsive navigation, integration truthfulness, and data-handling claims.

Not covered: an authenticated customer session, saved-key reload/revoke, tenant data, live review execution, or Autofix. The user's existing Chrome session did not expose a testing port, and this terminal still lacks permission for direct browser control. These remain release requirements rather than being replaced with mocked proof.

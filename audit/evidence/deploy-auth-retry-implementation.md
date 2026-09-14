# Deployment authorization retry repair

Local verification completed 2026-09-14T05:36:19.522481+00:00. No login, Vercel command, network request, alias write, or deployment was executed by these tests.

The broker helper previously returned the raw `spawnSync` result from its authorization retry. A successful retry therefore lacked the `combined` output required to inspect the alias, while a failed retry skipped the normal failure checks entirely.

The retry now replaces the first result and then passes through the same error handling and output normalization. It remains one retry only, for a completed CLI attempt reporting an authorization failure. A failure to spawn the CLI is not retried. Failed attempts expose a validated numeric exit status or a closed spawn-error code rather than raw CLI output/error messages. The web helper had no authorization retry; its single-attempt behavior is preserved, with matching safe error handling.

Tests execute the actual private helper function extracted from each source file inside an isolated JavaScript context. The only subprocess function is replaced before evaluation, so neither the entrypoint nor any real CLI can run. The tests cover first authorization failure then success, valid alias target parsing, second nonzero exit, repeated authorization rejection, signal termination, spawn errors, no retry for ordinary build failure, fixed retry count, identical project/environment forwarding and credential-marker non-disclosure.

**Red:** 10 failures and 41 passes before source changes (`deploy-auth-retry-red.txt`).

**Green:** 64 tests pass across deployment command, broker deployment boundary, Convex production target and execution release gate (`deploy-auth-retry-green.txt`). Changed-file ESLint (`deploy-auth-retry-lint.txt`), Node syntax checks for both scripts and `git diff --check` pass.

Changed source: `scripts/deploy-buildit-broker.mjs`, `scripts/deploy-buildit-web.mjs`, `tests/architecture/deployment-command.test.ts`. Full coordinated verification remains the root agent's release check; these local results do not claim a production deployment succeeded.

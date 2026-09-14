# Unknown-route response repair

Observed by the isolated production HTTP harness: `/settings`, `/setup/github`, `/setup/run`, `/audit-nonexistent-route` and direct `/_not-found` did not finish within five seconds. An unmatched nested path did finish as a 404.

The proxy rewrote every unrecognized route to Next's internal `/_not-found` route, including `/_not-found` itself. This was not a terminal response and routed the failure back into the application rendering path. The route map also claimed all unmatched multi-segment paths and bare `/setup` were real pages.

Changes are limited to `apps/web/src/proxy.ts`, `apps/web/src/route-map.ts` and their new direct test. Unknown paths now return a complete fixed HTML 404 response directly, with a noindex marker, recovery links, and the existing content security policy. HEAD returns no body. Known routes preserve per-request nonce headers and cookies. The proxy matcher and authorization behavior are unchanged. `/setup/review` remains allowed because the parallel tracker implementation supplies that page.

Read the installed Next documentation for proxy and not-found behavior before changes. The documentation permits a direct proxy response and explains why a streamed not-found page can retain HTTP 200.

Evidence:
- `unknown-route-red.txt`: 11 failing assertions before the fix, including the internal rewrite and invalid route inventory.
- `unknown-route-green.txt`: 76 passing assertions across the proxy, public assets, and public proof page tests.
- `unknown-route-lint.txt`: focused lint pass.

The monitoring worker rebuilt the isolated production Next app and verified 36/36 complete-response HTTP checks. Formerly hanging routes now return 404 in 1–4ms; direct /_not-found in 1ms; HEAD returns an empty 404 in 1ms. Recovery links, CSP and no-store were checked. Evidence: local-browser-http-proof.json and local-browser-http-proof.log. No production route changes were deployed.

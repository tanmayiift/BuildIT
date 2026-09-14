# Scanner diagnostic log leak repair

Source-only BuildIT change. No sandbox, provider, production service, or real repository execution was requested.

Confirmed defect: the OSV scanner-unavailable warning interpolated the first 400 characters of combined scanner stdout/stderr. A scanner can quote a dependency URL, source line, path, or credential from the untrusted repository. The regression injected a synthetic secret and private source marker, captured console.warn/log/error, and observed them in the old diagnostic.

The adjacent gitleaks warning used generated exit/report-size text in the inspected source, rather than raw report content. It now shares the same stricter logging helper: fixed event name, a closed category, and a validated numeric exit code (or null). Neither logger accepts scanner text, exception messages, user paths, or report content. User-facing scan-unavailable state/reason and continued repository checks are unchanged.

Audit of packages/runner found no other raw repository diagnostic console sink. The standalone sandbox-smoke script prints the JSON result of its trusted fixed probe only after checking successful booleans and empty credential-name arrays; it was not run or changed.

Evidence:
- runner-diagnostic-red.txt: four regressions failed before the fix; the OSV case reproduced actual source/secret leakage, and the gitleaks cases required closed category logging.
- runner-diagnostic-green.txt: runner and broker execution boundary suites pass after the fix (see exact count in log).
- runner-diagnostic-typecheck.txt: runner package typecheck passes.
- runner-diagnostic-lint.txt: both changed files pass lint.

Changed source: packages/runner/src/vercelSandbox.ts and its existing test file. Full combined verification remains the parent task's responsibility. Historical production logs were not searched, exported, or deleted in this source-only task.

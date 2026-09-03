# Platform failure modes, measured — 2026-09-03

`execution_failed` (4 occurrences) and `sandbox_unavailable` (1) were the last two production
platform errors reported as **unmeasured**: they last occurred 09-01, before that day's
runner-budget changes, and had not recurred. "Has not recurred" is not a measurement, so this
records what each code actually is, reproduced through the production code path.

## How this was measured

`packages/broker/test/execution-failure-modes.test.ts` constructs a **real** `VercelSandboxRunner`
and passes it to the **real** `handleExecution`. The runner, the `safeExecutionError` classifier and
the HTTP response are all production code. The only substitution is the Vercel Sandbox SDK boundary
itself — the part BuildIT does not own — because that is where the failures originate.

**A true provider outage cannot be caused on demand.** What is pinned is that every failure BuildIT
can reach turns into one specific, honest, non-leaking code. It runs inside `pnpm security:release`,
so it is a release gate rather than a one-off.

## Trigger → code

| Fault at the SDK boundary | Code | HTTP | Logged category |
|---|---|---|---|
| `Sandbox.create` rejects `Error("Sandbox failed to start: no capacity in region cdg1")` | `sandbox_unavailable` | 503 | `runner_or_scanner` |
| `runCommand` rejects `Error("Sandbox terminated unexpectedly")` | `sandbox_unavailable` | 503 | `runner_or_scanner` |
| `Sandbox.create` rejects `TypeError("fetch failed")` | `sandbox_unavailable` | 503 | `runner_or_scanner` |
| `Sandbox.create` rejects `DOMException(name: "TimeoutError")` | `sandbox_unavailable` | 503 | `runner_or_scanner` |
| `Sandbox.create` rejects `Error` with `code: "ECONNRESET"` | `sandbox_unavailable` | 503 | `runner_or_scanner` |
| factory throws a non-`Error` (`throw "boom"`) | `execution_failed` | 503 | `unexpected` |
| `readFileToBuffer` rejects `Error("unexpected internal state")` | `execution_failed` | 503 | `unexpected` |

Unchanged, and asserted so they stay unchanged: `credential_teardown_failed`, `sandbox_unsafe_path`
and `sandbox_untrusted_install_control` remain `runner_safety_failed`; `gitleaks_execution_failed`
and `osv_report_invalid` remain `scanner_unavailable`.

## What each code means

**`sandbox_unavailable` can only ever mean the provider.** Every BuildIT-authored `sandbox_*` error
is caught earlier in the chain and becomes `runner_safety_failed`, so this code is unreachable from
any BuildIT check. The single production occurrence was the Vercel Sandbox itself failing to start
or run.

**`execution_failed` is the terminal catch-all** — a fault matching no branch. It stays a catch-all
by design. If it recurs, the fix is to name that specific cause, not to widen the bucket.

## Two misroutes the measurement exposed, both fixed

1. **A real outage was logged as a code defect.** `safeExecutionErrorCategory` tested
   `/^(?:sandbox_|credential_teardown|osv_|gitleaks_)/`, but the provider says
   `"Sandbox failed to start"` — capital S, no underscore — so it fell through to `unexpected`. The
   one field that exists to make outages measurable was mismeasuring them. It now classifies the
   provider's own shape as `runner_or_scanner`, and the list stays closed.

2. **Unreachability was reported as an unnameable failure.** `fetch failed`, `TimeoutError`,
   `ECONNRESET` and friends carry none of the matched text — a `DOMException` named `TimeoutError`
   has the message "The operation timed out", and an errno lives on the error object rather than in
   its text — so they landed in `execution_failed`, whose message told operators to retry "once the
   service is available" without naming the service. The classifier now reads the error's name and
   errno as well as its message, and the branch is placed last so nothing classified above it can
   be reclassified.

Downstream, `classifyPlatformFailure` had no branch for either code, so both reached the author as
*"BuildIT stopped because a required platform step failed."* `sandbox_unavailable` now says the
check environment could not be reached, that it is BuildIT's infrastructure rather than the pull
request, and that a new review is the right move — the one actionable thing the generic message
could not carry. `execution_failed` deliberately still reads `platform_error`.

## Production counts at the time of measurement

Of 30 failed workflows: `analysis_context_too_large` 7, `report_publication_contract_failed` 4,
`execution_failed` 4, `malformed_response` 4, `rate_limited` 4, `repository_access_refused` 1,
`github_blob_403` 1, `sandbox_unavailable` 1, non-JSON `SyntaxError` 1, `runner_safety_failed` 1,
`budget_preflight_exceeded` 1, `missing_finding_fingerprint_secret` 1.

The four `execution_failed` and one `sandbox_unavailable` predate the runner-budget changes and
have not recurred. They are now measured in the sense that matters: their code path is pinned, and
if either happens again the emitted code and logged category will name it correctly.

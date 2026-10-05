# Browser evidence, 2026-10-04

Run by hand against https://buildit-agentic-review.vercel.app, 18:57–19:06 UTC, on deployed commit
`bc2a33f` (#94). It was not produced by `pnpm evidence:browser`, which was written the same evening, but it
checks the same things.
- `tanmayiift` in the Claude desktop app's browser.
- `smratipahwa` in Chrome, where that account was already signed in.

No session was copied, saved or printed. The API probes ran inside each signed-in page and returned only a
status and an error code.

**Result: passed.**

## Two-user isolation: the spec's assertions, per identity

| Check | `tanmayiift` (A) | `smratipahwa` (B) |
|---|---|---|
| `/account` shows own login, never the other | pass | pass |
| `/repositories`, `/reviews`, `/setup/model` show own workspace, never the other's workspace or marker | pass | pass |
| `/metrics`, `/usage`, `/audit` show "Connected" and nothing of the other's | pass | pass |
| own marker on `/repositories` | pass | pass |
| own review shows own marker | pass | pass |
| the other's review reads "Review evidence is unavailable" and shows nothing of theirs | pass | pass |
| A's review started minutes earlier (`nx77q8d1…`), opened as B | — | refused, no zod repository shown |

## API probes, from inside each signed-in page

| Function | A, own review | A, B's review | B, own review | B, A's reviews |
|---|---|---|---|---|
| `reviews:get` | ok | `not_found_or_forbidden` | ok | `not_found_or_forbidden` (both) |
| `reviews:getEvidence` | ok | `not_found_or_forbidden` | ok | `not_found_or_forbidden` (both) |
| `reviews:runHistory` | ok | `not_found_or_forbidden` | — | `not_found_or_forbidden` |

## Signed-in journey, as A

The spec's opt-in third test, done for real: prepare, consent, start, read the verdict.
- `tanmayiift/buildit-demo-zod#1`, OpenAI, $5 ceiling.
- The consent panel showed `1a295bd → 7135ab8` and listed the dependency install, test, lint, typecheck and
  the three scanners.
- Review `nx77q8d1wh5n5cqmc9cwe8bwwn8fmbwp`: created 18:57:07, verdict 19:01:35, **`inconclusive`
  (`test_suite_failing`)**. That is the rule decided in #93.
- Cost: 149 s of sandbox (platform counter 1258 → 1407), $0.6675.
- The review page lists the checks as "Static analysis, Secret scan, **Dependency install**, Lint, Dependency
  audit, Test, Typecheck". Since #94, every check row stores its step (`planId`). The review before it
  (`nx7eyh16…`), recorded without one, reads "Dependency install or build", as designed.

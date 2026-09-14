# Local Playwright launch result — 2026-09-14

The full `pnpm test:e2e` command was run against the existing loopback BuildIT audit server at `http://127.0.0.1:3107` so it would not start a conflicting second server. The command discovered 207 tests, completed 2 tests, and failed 205 before page assertions because Chromium's macOS helper could not start:

`bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer ... Permission denied`

The failures are browser-process launch failures, not application assertions. The supported CUA Chrome run separately completed 45 named BuildIT cases with 45 passed and 0 failed; its scope and limits are recorded in `local-browser-cua-proof.json` and `local-browser-cua-matrix.md`. No browser permission bypass was attempted. A Linux CI runner with Chromium dependencies remains the required execution environment for the full Playwright suite.

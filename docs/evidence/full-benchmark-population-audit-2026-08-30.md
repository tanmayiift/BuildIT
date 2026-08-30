# Full benchmark population audit — 2026-08-30

Command: `pnpm eval:populations`

Result: passed.

- AACR-Bench positive: 196 rows
- AACR-Bench negative: 155 rows
- AACR-Bench comments parsed: 2,145
- SWE-bench Verified: 500 rows
- Immutable revision and SHA-256 checks: passed
- Recorded licenses: Apache-2.0 and MIT
- Raw benchmark files: stored only under ignored `.local/benchmarks` with mode 0600

The audit exposed and fixed an incompatible synthetic AACR adapter. The adapter now consumes the official `githubPrUrl`, `source_commit`, `target_commit`, and `comments` schema, normalizes reversed line ranges, separates task data from hidden comment gold, and rejects invalid GitHub PR URLs or commit ranges.

This proves provenance, complete-population parsing, and adapter compatibility. It does not prove BuildIT model accuracy or SWE patch success because the live model and sandbox pipeline has not executed these populations.

# Sample tour transcript source, 2026-09-03

The one complete finding in the public sample tour is transcribed from a review BuildIT actually
ran. This file is the record it is checked against, so the fixture cannot drift away from the
review it claims to quote. `tests/architecture/sample-fixture-consistency.test.ts` fails the build
if any value below stops matching `apps/web/src/app/sample-data.ts`.

| Field | Value |
| --- | --- |
| Repository | `tanmayiift/buildit-public-fixture` |
| Pull request | https://github.com/tanmayiift/buildit-public-fixture/pull/22 |
| Reviewed commit | `699dd5f2f177a82f12a054daa7f68486cdcaf5b1` |
| Finding | TLS certificate verification is disabled |
| Severity | Critical · Blocking · Confirmed by evidence |
| Location | `src/rates.js:4` |
| Failing check | `test` (Required) |
| Autofix stacked PR | https://github.com/tanmayiift/buildit-public-fixture/pull/23 |
| Autofix result | +1 / −1; test, buildit-rules, gitleaks, osv-scanner all pass afterwards |

The review comment is on the pull request itself and is the primary source. The queue row that
carries this finding uses `nexus/web #22` as its display identity, because the tour is labelled
sample data throughout; the commit, finding, check table, diff and stacked pull request are the
real ones.

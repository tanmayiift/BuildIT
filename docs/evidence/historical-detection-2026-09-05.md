# Historical detection run — 5 September 2026

The first committed evaluation result in this repository. Everything before it was either a
threshold with no run behind it or a suite that graded the grader.

**Set:** `historical-v1` — ten real pull requests, four languages, nine planted defects and one
correct change. Defined in `packages/evaluations/src/historicalCases.ts`, every case openable on
GitHub.

**Prompt version:** `findings-v1`. **Provider:** OpenAI. Read from the check runs and review
comments BuildIT actually posted, not from a local re-run.

---

## Result: 1 of 4 attempted

Only four of the ten had been reviewed when this was recorded. The other six were opened the same
day and are waiting on a GitHub App installation, which is a step only the account owner can take.
They are listed as `not_attempted` rather than scored, because a case nobody ran is not a case
that failed.

| Case | Language | Family | Expected | BuildIT said | Outcome |
| --- | --- | --- | --- | --- | --- |
| `hist-got-retry-budget` | TypeScript | regression | blocking finding | Changes need review, 2 findings, cited `calculate-retry-delay.ts:39-43` | **detected** |
| `hist-express-view-cache-key` | JavaScript | logic_edge_case | blocking finding | Ready for human review, 0 findings | **missed** |
| `hist-zod-int16-off-by-one` | TypeScript | logic_edge_case | blocking finding | Ready for human review, 0 findings | **missed** |
| `hist-date-fns-holidays-clean` | TypeScript | — | no blocking finding | Ready for human review, 0 findings | **clean_pass** |
| `hist-p-queue-weighted-concurrency` | TypeScript | concurrency | blocking finding | — | not_attempted |
| `hist-body-parser-async-verify-bypass` | JavaScript | error_handling | blocking finding | — | not_attempted |
| `hist-requests-env-ca-override` | Python | configuration | blocking finding | — | not_attempted |
| `hist-itsdangerous-salt-ignored` | Python | authorization_tenant | blocking finding | — | not_attempted |
| `hist-gson-millisecond-carry` | Java | logic_edge_case | blocking finding | — | not_attempted |
| `hist-axios-evicted-session-leak` | JavaScript | performance_resource | blocking finding | — | not_attempted |

**Detection rate on attempted defect cases: 1 of 3.** No false blocking: the clean case passed.

That is the number, and it is not a good one. It is recorded because the alternative — reporting
the suite that grades the grader as though it were a detection result — is the failure mode this
whole set exists to correct.

## What the one detection looked like

> **Retry budget is measured from only the most recent attempt, so totalRetryTimeout does not bound
> total wall-clock time** — `source/core/calculate-retry-delay.ts:39-43`, High · Blocking.
>
> *"`error.timings?.start` is attached to the current failed request attempt, not to the first
> attempt in the retry sequence… the implementation has no persisted start/deadline across attempts
> and therefore cannot enforce a cumulative budget."*

It also raised a second blocking finding: the added test asserts only `attempts >= 1`, which a
correct implementation and a broken one both satisfy. That is the reasoning the label asks for.

## What the two misses have in common

Both are off-by-one-shaped defects in a large diff of otherwise correct additions, and in both the
added tests exercise the valid boundary and never the invalid one:

- **zod** writes `int16`'s maximum as `32768` in two places — the bounds table and the compiled fast
  path — and tests that `32767` parses, never that `32768` is rejected.
- **express** adds a per-render `root` while the view cache stays keyed on template name alone, and
  no test renders one name from two roots.

Neither is subtle to a reader who is looking for it. Both survived a review that read the file.

## Caveats a reader should hold against this

**Detection is not deterministic.** The same commit reviewed twice does not always produce the same
findings — `docs/evaluations/detection-suite.md` records why the live suite is deliberately not a CI
gate. A single run of three cases is an observation, not a rate, and the confidence interval on 1/3
spans most of the unit interval.

**No version comparison yet.** `packages/evaluations/src/versionComparison.ts` implements it and is
tested, but it needs two runs at different prompt versions and this is the first. The next prompt
change produces the second, and that comparison is the artefact that answers whether judgment
improved.

**These are planted defects, not found ones.** They were written to be findable by a careful
reviewer. They say nothing about defects nobody thought to plant.

# One dashboard review on 4 October 2026: sandbox time, model cost, and the provider fallback

Run in production from the dashboard, signed in as `tanmayiift`, on the first day of the reset Vercel
cycle. Every figure below is read from production Convex records after the run, not estimated.

## Credit preflight (operator probe, before anything was spent)

`internal.modelProbe.probe` makes one tiny real call per key and writes nothing to review or budget tables.

| Provider | Model | Result |
|---|---|---|
| Gemini | gemini-2.5-pro | `model_unavailable` (provider 404) |
| Gemini | gemini-3.1-pro-preview | `no_credit` (provider 429, quota exhausted) |
| Gemini | gemini-2.5-flash | `model_unavailable` (provider 404) |
| OpenAI | gpt-5.4-mini | `answered` (45 in / 12 out tokens) |
| Anthropic | — | `no_valid_credential` (the key is revoked) |

So ChatGPT has credit and Claude has no usable key. The review was started on Gemini anyway,
deliberately, to exercise the fallback.

## The run

- Pull request: `tanmayiift/buildit-demo-p-queue#2`, `6b15782 → 76cfa58`, 4 files, +179 −3.
- Chosen provider Gemini (`gemini-2.5-pro`), safety ceiling $5.
- Parent review `nx77xcxdqv34j1k309hsy7t1818fnzwf` → `platform_failed`, reason `provider_quota_exhausted`.
- Child review `nx76x0c1ymjw6jw89797mj93rd8fmazv` (`parentReviewId` = parent) on OpenAI → **`checks_passed`**.

### Timeline (real time, from `_creationTime`; UTC)

| Time | Review | Event |
|---|---|---|
| 09:14:56.958 | parent | created on dashboard consent |
| 09:15:10.970 | parent | context complete (14.0 s) |
| 09:15:30.212 | parent | validation complete (19.2 s) |
| 09:15:35 – 09:15:55 | parent | 3 rounds × (gemini-2.5-pro 404 → gemini-3.1-pro-preview 429 quota) |
| 09:15:59.610 | parent | `workflow_failed`, then `provider_fallback_started` |
| 09:16:08.593 | child | context complete (9.0 s) |
| 09:16:26.894 | child | validation complete (18.3 s) |
| 09:17:01.267 | child | analysis complete (34.4 s) |
| 09:17:07.633 | child | decision: checks complete |

**Consent to verdict: 2 min 10.7 s**, of which 62.7 s was the Gemini attempt and its retries.

## Sandbox seconds, three ways

| Measure | Parent | Child | Total |
|---|---|---|---|
| `executionJobs` created → completed | 14.9 s | 13.6 s | 28.5 s |
| Org / platform wall-clock counter delta | — | — | **26 s** (563 → 589, both counters) |
| `usageLedger` `sandbox_seconds` | 0 | 0 | 0 |

The counters are what the monthly allowances and Vercel's Active CPU follow: **about 13 s of sandbox
time per validation**. A fallback runs validation twice, so this review cost 26 s.

The ledger reads 0 because every scanner check recorded `durationMs: 0`. The ledger is the sum of
recorded command times, and nothing recorded a time. See the second finding below.

## Model calls and cost

| Review | Provider / model | Stage | Outcome | Time | Cost |
|---|---|---|---|---|---|
| parent | gemini / 2.5-pro ×3 | review_plan | `model_unavailable`, not charged | — | $0 |
| parent | gemini / 3.1-pro-preview ×3 | review_plan | `quota_exhausted`, not charged | — | $0 |
| child | openai / gpt-5.4-mini | review_plan | valid | 6.7 s | $0.0266 |
| child | openai / gpt-5.4 | findings | valid | 6.5 s | $0.0862 |
| child | openai / gpt-5.4-mini | critic | valid | 3.7 s | $0.0251 |
| child | openai / gpt-5.4-mini | arbitration | valid | 2.9 s | $0.0251 |
| child | openai / gpt-5.4-mini | report | valid | 5.1 s | $0.0266 |

- **Total cost: $0.1897**, 130,290 tokens, 24.8 s of model time.
- The org's monthly spend moved by exactly $0.189685 ($2.954249 → $3.143934), matching the child's
  `budgetConsumed`.
- The failed Gemini attempts reserved $1.61 each against the ceiling and were all released as
  `not_charged`.

## What this proves

- **The provider fallback works end to end in production (1.3).**
  - A credit failure on the chosen provider is classified `provider_quota_exhausted`.
  - The parent ends `platform_failed` with next action `retry_review`.
  - One child review starts on the next valid key and reaches a verdict within the original ceiling.
  - The failed provider is never charged.
- **Gemini wording is not a risk.** The analysis expected Gemini's quota message might not match the
  credit pattern; it did match (`quota_exhausted`), so the key was classified correctly.

## Findings

1. **No lockfile means no tests, and the verdict does not say so.**
   - `buildit-demo-p-queue` has no lockfile, so the package manager resolved to `none`. Install, test,
     lint and typecheck never ran: only BuildIT's static rules and Gitleaks did (OSV-Scanner was skipped).
   - The consent panel had promised "dependency install, test, lint, typecheck".
   - The review page says "All required checks passed — BuildIT found enough evidence for this exact
     commit", with coverage "Partial". It never says the project's own test suite did not run.
   - Recorded in `docs/operations/known-defects.md`.
2. **Scanner checks record 0 ms, so the per-review sandbox ledger is always 0 for a scanner-only run.**
   The per-review figure cannot be used as a measurement until check durations are recorded.

## Capacity, from this measurement

The 13 s per validation measured here is a **scanner-only** validation, the floor. Earlier
test-running validations measured 12, 26, 72 and 159 s (`convex/lib/sandboxCeiling.ts`).

| Allowance | At 13 s (this run) | At 159 s (heaviest measured) |
|---|---|---|
| Per workspace, 3,600 s/month | ~276 validations | ~22 validations |
| Platform, 16,200 s usable | ~1,246 | ~101 |

A review that falls back costs two validations.

A test-running measurement needs a repository with a lockfile: `buildit-demo-zod`, `-express`,
`-axios`, `-got` and `-date-fns` all have one; `-p-queue` and `-body-parser` do not.

---

## Second run: a review that runs the project's tests (`buildit-demo-zod#1`)

Run after #89 was deployed, which records each scanner's real duration. The project has a
`pnpm-lock.yaml`, so the dependency install, test, lint and typecheck all ran. No build step runs unless a trusted
configuration adds one; the row the review page labelled "Build" was the install, which the runner files under
check kind `build` (labelled correctly from #94).

- PR `tanmayiift/buildit-demo-zod#1`, `1a295bd → 7135ab8`, 8 files, +218 −1.
- Provider OpenAI, ceiling $5. Gemini was skipped: it is out of credit and the fallback was already proven above.
- Review `nx79yyxnsfs2xzvyez324zf6a18fn40d`: verdict `checks_passed`. See the finding at the end.

### Timeline (UTC, real time)

| Stage | Finished | Took |
|---|---|---|
| created on consent | 12:05:42.746 | — |
| context | 12:06:11.703 | 29.0 s |
| validation | 12:08:46.862 | 2 min 35.2 s |
| analysis | 12:10:05.063 | 1 min 18.2 s |
| decision | 12:10:11.490 | 6.4 s |

**Consent to verdict: 4 min 28.7 s.**

### Sandbox seconds, three ways, and now they agree

| Measure | Value |
|---|---|
| Org / platform wall-clock counter delta | **149 s** (589 → 738, both counters) |
| `executionJobs` created → completed | 149.6 s |
| `usageLedger` `sandbox_seconds` | 153 s (sum of recorded command times, 152.9 s) |

The per-review ledger is no longer 0: scanner durations are recorded since #89.

| Check (base / head) | Duration | Result |
|---|---|---|
| test | 43.4 s / 46.5 s | failed on both (see finding) |
| dependency audit (OSV-Scanner) | 16.1 s / 16.7 s | passed |
| dependency install | 10.3 s / 10.9 s | passed |
| lint (advisory) | 2.3 s / 2.3 s | failed on both |
| secret scan (Gitleaks) | 1.5 s / 1.6 s | failed on both |
| typecheck (advisory) | 0.5 s / 0.5 s | not configured |
| BuildIT static rules | 0.1 s / 0.1 s | passed |

### Model calls and cost

- Five calls on OpenAI: `gpt-5.4-mini` for plan, critic, arbitration and report; `gpt-5.4` for findings.
- **Cost: $0.6708**, 476,956 tokens, 65 s of model time.
- Coverage `partial` (`analysis_budget`): not every changed file fitted the model's window. The checks and
  scanners still ran against all of them.

### Capacity, now measured on a test-running review

At **149 s of sandbox per review**:

| Allowance | Reviews that fit |
|---|---|
| Per workspace, 3,600 s/month | ~24 |
| Platform, 16,200 s usable | ~108 |
| Vercel Hobby Active CPU, 5 h | ~120 (if Active CPU tracks this counter) |

A review that falls back between providers costs two validations.

### Finding: a required check failing on both commits is reported as "passed"

- `test` and `gitleaks` are required, and both failed on the base and the head commit. The test suite
  failed to load entirely: all 194 tests fail at `import("../../index.js")`.
- BuildIT classified both as pre-existing, so they did not block. That is its deliberate rule: a failure
  already on the base commit is not this pull request's fault.
- What it then said is not true:
  - the GitHub check is `success`, titled "Ready for human review";
  - the comment opens "All 5 required checks passed with complete evidence", then lists `test` and
    `gitleaks` as already failing;
  - the review page heading reads "All required checks passed — BuildIT found enough evidence for this
    exact commit", above a table showing both as Required · Failed.
- A suite that fails on both commits gives no evidence about the change, whether or not the failure is
  this pull request's fault.
- Recorded in `docs/operations/known-defects.md`.

## Third and fourth runs: what zod's test suite actually did

### After #91: `nx7asz0vnc4z1mwxs2ppj3wtns8fmmvg`, 13:12 UTC

- The verdict was still `checks_passed`, with the new wording: "This change introduced no new failure in its
  5 required checks", naming `test`, `lint` and `gitleaks` as already failing.
- `test` failed on both commits and was not marked `noPassingTests` (now `testSuiteFailing`), because its full output contained a
  pass count.
- Nothing a reader could see showed that count. The page and the comment show the last six lines of output,
  and vitest prints its summary above them. That gap is what #92 closes.

### After #92: `nx7avqsnya9qe09nwghhw9m3s18fnm7t`, 15:36 UTC

The PR, scope and provider were the same as before: `1a295bd → 7135ab8`, OpenAI, $5 ceiling. The verdict was
`checks_passed`.

| Stage | Finished | Took |
|---|---|---|
| created on consent | 15:36:32.286 | — |
| context | 15:37:01.759 | 29.5 s |
| validation | 15:40:10.840 | 3 min 9.1 s |
| analysis | 15:41:29.297 | 1 min 18.5 s |
| decision | 15:41:35.815 | 6.5 s |

**Consent to verdict: 5 min 3.5 s.**

- **Sandbox:** 184 s, and all three measures agree: the org and platform counters (921 → 1105), the
  `executionJobs` span (184.0 s) and the `usageLedger` (184 s). That is 35 s more than the second run,
  for the same commands on the same commits. It is spread across `test` (+16 s), OSV-Scanner (+8 s) and
  the dependency install (+4 s), so it is sandbox variance, not a change in what ran. Capacity at 184 s
  is ~19 reviews per workspace per month, and ~88 on the platform.
- **Model:** five calls, the same models as before, 475,791 tokens, **$0.6676**.

**What the test suite did, now recorded on the check (`checkRuns.testCounts`), identical on both commits:**

| | Passed | Failed |
|---|---|---|
| Test files | 6 | 192 |
| Tests | 7 | 5 |

- 192 of zod's 198 test files failed to load (`import("../../index.js")`). The 12 tests that ran came from
  the 6 files that loaded.
- The rule chosen in #91 makes a suite inconclusive only when *no* test passes. Seven passed, so the failure
  was treated as pre-existing and the verdict is `checks_passed`. That is the rule working as decided.
- The decision after seeing these counts: a suite where more than half of the test files fail is not one
  that ran. From #93 on, this review ends `inconclusive` (`test_suite_failing`). See
  `docs/operations/known-defects.md`.
- The page showed "Tests: 7 passed, 5 failed on this commit", and the comment row read
  `Failed · already failing on base · Tests: 7 passed, 5 failed`. Both hid the 192 failed files, so the
  formatter now adds test files whenever one failed:
  `Tests: 7 passed, 5 failed · Test files: 6 passed, 192 failed`.

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

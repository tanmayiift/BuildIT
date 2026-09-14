# History, feedback, activation and public proof repair evidence

Implemented locally on 2026-09-14. No service changes, deployment or production interaction by this worker.

## Reproduced before repair

`history-red.log` records 11 failing regressions: newest active queue rows and latest PR runs hidden by non-time ordering, exact-limit false truncation, repository history/cost scope applied after caps, invented near-zero review duration, app dismissal missing from feedback, duplicate-voter counts and unapplied GitHub dismissal, incorrect numbered/old-marker feedback targeting, unrelated events hiding activation, attempts called completed PRs, and customer review volume hiding eligible public proof.

## Final behavior

- `convex/reviews.ts` orders queue and PR runs by their timestamp index before caps. Queue returns `{ rows, truncated, limit }` for the latest 500 attempts; PR history does the same for the latest 50 runs. Evidence, per-run totals and comparisons disclose omitted child rows. The comparison screen refuses to infer lost/new findings from incomplete evidence. Unmeasured provider duration and historic end-to-end duration remain unknown.
- `convex/reviewHistory.ts` applies repository and time bounds before reads, checks repository/review parents, and charges only the selected repository when scoped. At most 500 attempts, 2,000 ledger entries and details for the newest 100 attempts are examined. Each detail reads at most 101 findings and feedback rows to detect a 100-row cap. Parent verification stops at the shared 3,000-read allowance and discloses incomplete spend. Costs describe charges recorded during the period, including charges on older reviews.
- The history page uses 30 UTC calendar dates, a stable UTC day end on the server and a daily query refresh key. New rows remain inside the subscribed index range. Ordinary renders do not move query arguments. Partial feedback cannot display an acceptance percentage. Counts describe finding occurrences, not unique defects across runs.
- `convex/lib/findingOpinions.ts`, `findings.ts` and `findingFeedbackData.ts` store one current opinion per person and count the latest opinion once per concrete finding occurrence. App dismissals enter history; GitHub dismissals change the finding's actual resolution. Late deliveries do not undo newer decisions. Linked app users and GitHub actors use the same SHA-256 login identity. Exact finding markers retain their identity across old runs; ambiguous legacy fingerprint markers are refused. Numbered feedback queries completed runs before bounding and refuses oversized finding sets.
- `convex/activation.ts` uses indexed preview, repository, credential and review existence checks. It checks at most 100 report references with matching organization/review/redacted live artifact evidence. When a capped report scan cannot establish readiness, it returns unknown and the UI explains the gap. Outcome counts remain explicitly bounded.
- `convex/publicProof.ts` distinguishes review attempts from distinct PRs with a completed actionable verdict. Overflow uses a sentinel beyond the cap, so an exact-limit dataset is complete. Public links are scoped to approved public evidence repositories before review caps; customer public and private repositories remain excluded. The list examines at most 50 approved repositories and 100 completed runs per repository, and shows at most 40 distinct PRs with truncation metadata.
- New accounting rows with `costStatus: unknown` propagate pending cost through history, review evidence, run history, comparison and public proof. The UI labels pending amounts and refuses a complete-zero claim.

## Validation

Final focused run: **205 tests passed across 7 files**, recorded in `history-green.log`. This includes 21 backend regression tests in `convex/historySummaries.test.ts`, tenant isolation and connected journey suites, plus history, activation, proof and review-detail component tests.

`pnpm typecheck:convex` passes (`history-typecheck-convex.log`). Targeted ESLint passes (`history-lint.log`). Web typecheck passed after the main implementation, then the final run was interrupted by generated `.next/types/validator.ts` route errors during another worker's root Next development process. The parent has moved browser builds to an isolated copy and owns regeneration/final web typechecking; `history-typecheck-web.log` preserves that limitation. No application source errors appeared in that final output.

The extra pending-cost fixture initially used a string where a model-invocation document ID was required; its two validation-error logs are named `history-cost-fixture-error.log` and `history-cost-fixture-retest-error.log`. It was corrected to insert a real invocation. The final 205-test run passes the pending-cost backend and component cases. Those fixture errors are not claimed as product defect reproductions.

Read `apps/web/AGENTS.md` and the installed Next server/client component documentation before frontend changes. Changed callers and tests accompany query response changes; deploy the matching backend and frontend together. Browser, live tenant and production verification remain with the parent task.

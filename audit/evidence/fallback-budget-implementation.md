# Shared budget for provider fallback

Completed locally: 2026-09-14T05:28:52.359936+00:00. No external requests or paid work ran during this fix.

## Reproduction

The previous reservation check read only the current review's `budgetConsumed` and outstanding calls. `startProviderFallback` copied the same full `budgetLimit` to a child with consumption zero. A parent that spent $0.09 under a $0.15 allowance could therefore admit a child's $0.06894 call. Parent and child together exceeded the original consent. Pending and unknown parent calls were also excluded, and replaying failure handling could create another fallback child.

The first focused reproduction was 8 failing cases. The expanded pre-fix suite recorded **22 failures / 27 passes** covering allowance reset, concurrent siblings, Ask from the parent, late receipts, bad family links, ancestor cancellation/staleness, bounded enumeration, and fallback replay. See `fallback-budget-red.txt`.

## Change

- `convex/lib/budgetAccounting.ts` adds `getReviewBudgetSnapshot`. It follows the actual `parentReviewId` chain to the root and reads all descendants through `reviews.by_parent`. It validates organization, repository, GitHub repository, pull request, head, mode, nonnegative safe amounts, missing parents and cycles. It reads at most 16 related reviews and 100 calls of each outstanding status per review, using an extra record to detect overflow. It fails closed rather than price a partial family.
- `convex/modelAccounting.ts` now reserves each real provider request against the root's consumed estimates plus all family reservations and unknown calls, inside the existing atomic transaction. A stricter child allowance is also respected. Cancelled, cancelling, stale, expired or cancellation-requested ancestors prevent new calls. Existing receipt settlement is unchanged: paid work remains accountable even after cancellation or a malformed family link.
- `convex/reviewModelData.ts` uses the same family amounts for the legacy preflight during deployment overlap. This compatibility path is a preflight, not the new durable per-invocation protocol; the release must remain drained and deploy broker first as already planned.
- `convex/durableReview.ts` suppresses duplicate fallback creation and scheduling, refuses to create a fallback when the family has no allowance, and checks the selected fallback credential's repository/workspace scope. The child keeps its own `budgetConsumed=0` because its receipts must remain separate; that zero no longer grants a new allowance.
- `convex/schema.ts` has the parent-added `reviews.by_parent` index. No new persisted fields, tables or counters were introduced by this follow-up. Existing parent-linked reviews are included directly; no rewrite or invented historical charges are needed.

Explicitly initiated new reviews without a parent retain their separately chosen limits. Provider retries within a review and automatic fallback children share one original allowance. Past over-limit paid receipts are still recorded; the admission rule cannot undo a charge already incurred, and further work is refused.

## Read-only spending receipt

After deployment, invoke the internal query `modelAccounting:reviewSnapshot` with `{organizationId, reviewId}`. It returns:

```text
rootReviewId, reviewIds, budgetLimitUsd, estimatedSpendUsd,
reservedUsd, remainingUsd, unresolvedInvocationCount
```

A parent and its child return the same receipt. It contains IDs and monetary metadata only. Use it before and after each controlled paid step, together with the existing workspace snapshot and actual infrastructure usage. Model admission limits do not include sandbox, broker, S3 or Convex bills; the audit's $10 total still needs root's separate infrastructure allowance and spending coordination.

## Verification

**233 tests passed across 10 files**: accounting, lifecycle recovery, execution record integrity, tenant isolation, connected journey, Autofix, provider fallback, classification, public function inventory and capability inventory. Convex typecheck, changed-file ESLint and `git diff --check` also pass.

Evidence: `fallback-budget-green.txt`, `fallback-budget-typecheck.txt`, `fallback-budget-lint.txt`. The source fix has not itself been deployed or checked with a real provider by this worker.

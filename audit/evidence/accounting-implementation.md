# Durable provider accounting evidence

Implemented locally in BuildIT on 2026-09-14. No deployment, production data write, or real provider request was performed.

## Confirmed regressions and evidence

- `accounting-provider-red.txt`: three real adapter regressions failed before implementation: Gemini thinking tokens omitted, truncated-response usage discarded, missing usage represented as trusted zero.
- `accounting-convex-red.txt`: two real data regressions failed before implementation: paid over-limit usage rolled back, and a first Ask charge replaced existing month spend.
- `accounting-handoff-final.txt`: **90 test files, 766 tests passed**, covering the accounting suite, tenant isolation, providers, broker, orchestrator, Autofix worker, failure copy, and architecture checks.
- `accounting-lint-final.txt`: owned accounting sources passed ESLint.
- `accounting-provider-typecheck.txt` and `accounting-broker-typecheck.txt`: package type checks passed.
- `accounting-typecheck-handoff.txt`: the accounting test adapter type was fixed; that whole-Convex run had one remaining concurrent history-test fixture type error outside this tranche. Parent owns final whole-project verification.

## Accounting path

`convex/lib/accountedModel.ts` is the only model transport used by current analysis, escalation, Autofix/repair, and Ask workers. Each physical provider attempt obtains a unique durable reservation, then a fresh signed broker grant. The accounted broker protocol makes exactly one provider call. Retries and verified Gemini catalog fallbacks return to the worker for a separate reservation.

`convex/modelAccounting.ts` reserves funds and Ask rate slots in a mutation before a request can execute. It records a pending/unknown ledger row immediately. Settlement patches that same row, updates integer dollar counters, and releases the reservation only for a known estimate or a provider rejection known not to have charged. Replayed settlement does not add another charge; a new physical request for identical input is a different invocation and is counted.

Settlement retains charges after cancellation, generation replacement, output errors, and over-limit replies. Stage evidence references its invocation and cannot charge it again. Ask settles before checking whether an answer is empty and before GitHub publication. Its rate gate counts physical attempts across all reviews of the same repository pull request.

Provider adapters include Gemini thinking tokens and preserve available usage on malformed/refused/truncated outputs. Missing usage is explicitly unknown. Transport loss keeps the reserved allowance and an unresolved ledger row; no automatic timeout releases money on the assumption that a provider did no work.

The old Autofix writer was removed. Stage and Ask compatibility writers remain only to account for an already-running worker from the prior deployment; no current worker calls those paths to pay for a model request.

## Shared snapshot and safe legacy repair

`getBudgetSnapshot(ctx, organizationId, now)` in `convex/lib/budgetAccounting.ts` returns the shared `BudgetSnapshot` wire type from `convex/lib/workspaceFigureTypes.ts`: UTC month boundaries, recorded estimated dollars, reserved dollars, monthly limit, remaining recorded allowance, reconciliation state, pending/unresolved count, and legacy-history uncertainty.

A zero monthly budget means no monthly limit; per-review limits still apply. Dollar amounts are conservative estimates, not provider invoices. Pending/unresolved calls and historical gaps must remain visible wherever a cost is displayed.

`reconcileMonthPage` scans at most 200 ledger rows per mutation, saves its cursor and subtotal together, and schedules remaining pages. New accounting rows carry `accountingVersion: 1` and update a separate running total atomically, so they can arrive during repair without being missed or counted twice. Reservation is refused until the historical scan completes. Legacy rows remain intact; no tokens, missing receipts, or historical provider charges are invented. UTC reservation month is preserved when settlement arrives in the next month.

## Directly exercised boundary cases

Simultaneous reviews sharing the final allowance; repeated reservation IDs; callback replay; identical prompts with separate actual calls; over-limit replies; cancellation/replacement; unknown receipt followed by known settlement; six simultaneous Ask attempts; rejected uncharged calls; UTC month rollover; a 450-row legacy repair interleaved with a new charge; cross-tenant settlement rejection; grant renewal on retry; paid truncation; lost transport; cancellation between retries; empty Ask answer; GitHub publication failure; stage-link replay without double charging.

## Limits still requiring operational honesty

Historical ledger gaps cannot be recovered without provider receipts. Legacy history is marked incomplete even after all existing rows are summed. Unknown invocations keep their reservations until a receipt or an explicitly verified no-charge result resolves them. Deploy the schema, broker, and workers together, and drain old workers for a clean transition away from the compatibility protocol. No live provider, invoice, or production migration was tested here. Sandbox seconds remain a command-duration meter; they are not a sandbox invoice or a storage meter.

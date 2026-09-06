# Known defects

Found, verified, and deliberately not yet fixed. Each entry says why the obvious fix is wrong, so
the next person does not spend the afternoon rediscovering it.

## The escalate-to-human verdict is unreachable

**Where:** `convex/reviewValidationData.ts` — `uncertainPasses >= uncertainEscalationLimit`, with
the limit set to 2 in `packages/orchestrator/src/reviewPlan.ts`.

**What happens:** `uncertainPasses` is written as `1` when a finding row is inserted
(`convex/reviewModelData.ts`) and incremented only when a row already exists for the same
`reviewId + fingerprintHmac`. A normal review records its findings once, so the counter never
leaves 1 and the threshold of 2 is never met. The `human_review_required` branch is dead code.

**Why it matters:** a finding the critic could not resolve leaves the review on `checks_passed`,
which publishes a green check and a comment titled *"Ready for human review"*. The analysis stage
recorded the opposite. The finding is listed in the comment body, so it is not hidden — but the
badge says the change is fine while BuildIT's own record says it could not tell.

**Why the obvious fix is wrong.** Setting the limit to 1 looks correct and would be a serious
regression. `requireIndependentCritic` forces every critical and high model finding to `uncertain`
whenever no independent critic is available, and independence requires a *second* model on the
credential. A workspace with one provider and one model — which is the common case, and is this
workspace today — would send every review carrying a serious finding to inconclusive. That is the
third time this codebase would have made incomplete input void a verdict; the first two
("coverage meant every byte", and the `changed_files` gap reused for the analysis budget) each made
every real repository undecidable, and both had to be undone.

**What the fix probably is.** Two changes that belong together, neither safe alone:

1. Build the escalation ladder first — re-run the critic once on the sibling model when a finding
   stays uncertain, so an unresolved finding means *two* independent attempts failed rather than
   *one attempt was not independent*. Only then does a threshold of 1 describe something real.
2. Separately, decide what a green check means when a blocking finding is unresolved. Arguably
   `checks_passed` should be unreachable while any critical finding sits at `uncertain`,
   independent of the escalation counter — the counter answers "how hard did we try", the badge
   answers "what do we claim", and those are different questions.

Until both land, an unresolved critical finding is visible in the comment and invisible in the
badge. That is the current, known state.

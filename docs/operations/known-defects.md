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

## The AWS boundary check cannot run, and keeps `main` red

**Where:** the `AWS artifact boundary matches the template` step in `.github/workflows/ci.yml`, and
`pnpm smoke:aws-boundary`.

**What happens:** the step runs only on non-pull-request events, finds no `AWS_ACCESS_KEY_ID`,
prints `buildit_aws_boundary_not_configured` and **exits 1**. So every push to `main` fails
`release-gates`, and no commit can fix it.

**Why it is written that way, and why that is defensible.** The alternative — warn and pass — is how
the Grafana rules drifted for weeks while a green check said nothing was wrong. "We could not check"
is not "it matches", and a gate that goes green on the first is a gate that lies.

**Why it is still a problem.** A build that is red for a reason no commit can address teaches people
to stop reading red builds, which costs more than the drift it is guarding against. The resolution
is neither weakening nor tolerating it: **put the credentials in.** Set `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `BUILDIT_AWS_REGION` (`eu-west-1`) and `BUILDIT_AWS_STACK` as repository
secrets and the step starts verifying the thing it was written to verify.

**Also blocked, for the same want of access:** reading back the encrypted inventory manifest and CSV
that appeared after the KMS repair, and confirming the next scheduled export ran. The CLI session is
expired (`aws sts get-caller-identity` → *"Your session has expired"*), and the browser is refused
navigation to the `eu-west-1` and `s3` console hosts. The stack is Ireland; a console session opened
at `us-east-1` cannot see it.

## `findingResolution: "fixed"` now says which findings were fixed, and only those

**Was:** `convex/validators.ts` declared the value and nothing wrote it, so `changelogData`'s filter
matched zero rows and a changelog produced after a successful autofix delivery listed no fixed
findings. **Fixed 17 September 2026.**

**Why the obvious version stayed unwritten for so long, and was right to.** `reviewAutofixData`'s
delivery path already proves a great deal before it will mark a review `delivered`, so marking the
review's `accepted` findings `fixed` there was a two-line change - and an over-claim of exactly the
kind BuildIT exists not to make. The patch stage is *fed* accepted findings; it is not required to
address all of them, and "the candidate commit passes its checks" is not evidence that any
particular finding was resolved. A review whose patch fixed one of four would have reported four.

**What made it checkable.** A scanner finding has a test that a model finding does not: run the same
scanners on the candidate commit and see whether the rule still matches the file. If it does not,
that finding is fixed - verified, not inferred. So `autofixRounds` now carries the candidate's
scanner matches and `completeDelivery` marks exactly the subset that no longer reproduces.
Model-origin findings have no rule to re-run and are left alone.

**Three details that carry the correctness.**

- **Identity is `ruleId` + `pathHmac`, not the stored `fingerprintHmac`.** That fingerprint is built
  from `scanner-${index}-${ruleId}` and the line range, so removing an earlier finding or inserting a
  line above it changes the fingerprint of a finding nobody touched - which is the same trap
  `introducedScannerFindings` documents for base-vs-head. Rule-and-file is stable across exactly the
  edits an autofix makes.
- **Only `open` and `accepted` are eligible.** `uncertain` is excluded because the critic could not
  confirm the finding was real, and "we could not tell, and now it is gone" is not "it was there and
  we fixed it". `dismissed` is excluded because a person already said it was not a problem.
- **The round stores hashes, never paths.** The raw path is hashed in the action with
  `FINDING_FINGERPRINT_SECRET` and only `{ ruleId, pathHmac }` is persisted, so the round stays as
  source-free as the finding rows it is compared against.

**Where it still under-claims, deliberately.** Two matches of one rule in one file, one of them
fixed, reads as still present. And a missing fingerprint secret records nothing rather than failing a
delivery that otherwise succeeded. Both leave findings unmarked rather than wrongly marked, which is
the direction to be wrong in.

**Unproven against a real delivery.** Verified by unit tests on the diff and an integration test
through `completeDelivery` - confirmed to fail when the marking is removed - but no autofix has
delivered since, because the sandbox quota is spent.

## The model provider account is out of credit — and the fallback that should have covered it was off

Recorded because it explains days of failures that looked like product bugs, and because the fix
turned out to be in BuildIT after all.

Every review reaching the analysis stage failed with HTTP 429 from OpenAI, and the 429 body carried
`insufficient_quota` — the account behind the key has no remaining balance. BuildIT reported this as
*"model provider is busy — retry once the provider's limit resets"* for as long as it lasted, which
is advice that could never work.

It now says what is true: **"the model provider account has no credit left … this is not a rate
limit and it will not clear on its own."** Three layers had to agree before that sentence could
reach a pull request — the provider reading the 429 body, the broker preserving the code rather than
collapsing it to a generic 503, and the retry rule treating it as permanent rather than matching
`http_429` and retrying three more times.

**And that accuracy is what broke the recovery.** `convex/lib/providerFallback.ts` starts a fresh
review on a second connected provider when the first one is the reason the review died. Its trigger
set was written when the provider 429 was a single reason:

```
new Set(["provider_rate_limited", "model_unavailable"])
```

Splitting the 429 introduced `provider_quota_exhausted` and nothing added it to that set, so the
newly-accurate classification became the one provider failure that could never reach a second key.
The production evidence is exact: the 18:35–19:09 failures on 14 September are
`provider_rate_limited` and the 19:41 one is `provider_quota_exhausted` — the same account, the same
cause, on either side of the reclassification.

Meanwhile this workspace has held a **valid Gemini credential since 31 August with `lastUsedAt`
still null.** A key that could have answered was connected the whole time and was never asked.

`provider_quota_exhausted` is now in the set, which is where it most belongs: a rate limit clears on
its own, so falling back is a convenience; a spent account answers the same way until someone pays
it, and waiting is the single thing that cannot help.

**What is still unproven.** The fallback resolves on paper — `gemini` is the only alternative with a
valid credential, and `selectProviderModel` returns `gemini-2.5-pro` from its three approved models
— but no review has exercised it, because the sandbox quota below now fails the run before it
reaches a model at all. The path is fixed and untested against production, and those are different
claims.

## New reviews chose the key whose account had just said it was empty

**Found and fixed:** 17 September 2026.

Credentials for a new review were ordered by `lastValidatedAt` alone, most recent first. That is a
reasonable-looking rule that reliably picks the wrong key, because the key you validated most
recently is the key you last tried to fix. This workspace has held a valid Gemini credential since
31 August and a spent OpenAI one validated 1 September, so every webhook-triggered review chose
OpenAI, spent a review discovering the account had no credit, and only then fell back.

A review that dies with `provider_quota_exhausted` now stamps `quotaExhaustedAt` on the credential
it used, and `orderCredentialsByHealth` puts a stamped credential last.

**Three decisions worth keeping.** It is a *sort*, not a filter: a workspace whose only key is
exhausted still gets to try it, because "no credit six hours ago" is weaker evidence than "there is
no key at all", and reporting the latter would be a wrong diagnosis rather than a cautious one. The
suppression *expires* after six hours, so topping the account up recovers on its own; rotating a
credential inserts a fresh row, so adding a key clears the stamp with no extra code. And the stamp is
written *before* the fallback guards, because a review that cannot start a fallback - it is already
one, or is stale, or is out of budget - learned the same thing about the account, and its successor
is exactly who needs to know.

**The dashboard had to learn it too.** `availableProviders` returned bare provider names, so once the
webhook path started avoiding a spent key the manual picker was the only place left that would still
choose it, with nothing on screen to say why that was a bad idea. It now returns
`{ provider, quotaExhausted }` ordered by the same rule, and the picker labels an exhausted account
and defaults to one that can answer.

## Autofix could not execute at all, and the symptom was a 400 nobody read

**Found:** 16 September 2026, while closing the segmented-execution work. **Fixed the same day.**

The 300-second split gave `/api/execute` a new contract: a request carries a `jobKey` and one
`segment`, and the broker folds both into the `plansHash` that the execution grant is verified
against. `reviewValidationWorker` was rewritten to speak it. `reviewAutofixWorker` was not, and kept
sending one call carrying the whole plan.

That is not a slower autofix. `handleExecution`'s parser rejects a body with no `jobKey` or no
`segment` as `invalid_execution_request` before any sandbox is created, and the grant scope check
would have refused it immediately after. **Every autofix round returned HTTP 400.**

The plan predicted the wrong failure - "it reintroduces the 700s shape" - because it reasoned about
budgets rather than the request contract. The shape was never the binding problem.

**What changed.** The loop lives in `convex/lib/executionSegmentDriver.ts` and both workers drive it,
so the contract is stated once; the second caller can no longer drift from the first without the
compiler noticing. Each autofix round creates and claims its own execution job, which also puts it
under the attempt cap, the wall-clock deadline and the reconcile sweeper.

**What this says about the guards.** Two architecture tests caught the refactor, and both were right
to. The lesson is the one already recorded under "validation that cannot see production": the
`/api/execute` contract had no test that both callers satisfied it, so it could change under one of
them silently. The extracted loop now has four - the orchestration had none before, only the segment
primitives it calls did.

**Unproven against a live sandbox.** The Hobby CPU allowance is spent, so this is verified by tests
and types, not by an autofix round that ran.

## Hobby runs BuildIT, but 5 hours of Sandbox CPU a month is the binding limit

The team was downgraded from Pro to Hobby on 2026-09-16 (refund $14.16 for 18 unused days).
Deployments, the web app, the broker and Convex all work unchanged. Reviews then failed at the
execution stage with `sandbox_unavailable` / `capacity_exhausted`.

Measured on the Vercel usage page, this billing cycle:

| Sandbox quota | Used | Hobby limit |
| --- | ---: | ---: |
| Creations | 434 | 5,000 |
| **Active CPU** | **8h 12m** | **5h** |
| Provisioned memory | 49.0 GB-Hrs | 420 GB-Hrs |
| Data transfer | 5.68 GB | 20 GB |

**Only Active CPU is over**, and it is over by a lot. Everything else has generous headroom. On Pro
that overage was billable on demand; Hobby simply stops, which is what `capacity_exhausted` means.

Two things follow. The cycle resets **4 October**, so the current block is this month's accrued
usage — most of which was spent by the old single-call design that paid sandbox setup on every
review. The segmented design pays setup once per job and should consume materially less CPU per
review, but that is a prediction, not a measurement, and it cannot be measured until the quota
resets or the plan changes.

So: Hobby is viable in principle and unproven in practice. The honest statement is that the
execution path fits the 300-second function ceiling — that part is proven — and whether it fits
5 CPU-hours a month is an open question answerable only with a fresh cycle.

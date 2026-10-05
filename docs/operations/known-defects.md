# Known defects

Found, verified, and deliberately not yet fixed. Each entry says why the obvious fix is wrong, so
the next person does not spend the afternoon rediscovering it.

## The escalate-to-human verdict is unreachable

**Status, 5 October 2026: the badge half is fixed; the escalation half is planned.**
- **Fixed (badge).** `computeReviewDecision` no longer returns `checks_passed` while a critical or high
  finding is `uncertain`. The review ends `inconclusive` / `human_review_required` / `inspect_findings`,
  and its GitHub check is neutral. A confirmed blocking finding or a failed check still wins as
  `changes_requested`.
- **The reader-side bug.** `finalizeDecision` had folded `uncertain` into `rejected`, so the decision
  never saw the finding at all.
- **Accepted trade-off.** A workspace whose credential exposes one model has every serious finding
  forced to uncertain. Its reviews with such findings are now "a person decides" rather than green.
  That is the honest answer: nothing independent confirmed or refuted them.
- **Still open.** The escalation ladder itself: a genuinely different second model, and
  re-arbitration that can accept. That is Phase 1 PR-6 of the 5 Oct plan.

The original analysis follows.

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

**Status: resolved on 4 October 2026.** CI and the release workflow now reach AWS through GitHub's OIDC
token and the read-only `buildit-ci-boundary-reader` role (`infra/aws/ci-reader.yaml`), with no stored
key, and `pnpm smoke:aws-boundary` passes there. The stack itself was reconciled the same day. The
original record follows.

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

## The model providers, measured on 19 September 2026

`validateKey` cannot answer "does this key have credit" - it calls the provider's `/v1/models`,
which is free and answers perfectly well on a zero balance. That is why the OpenAI account looked
fine for weeks while every review died on it. `internal.modelProbe.probe` makes one small real
completion instead, which is the only thing that distinguishes a valid key from a funded one.

| Provider | Model | Result |
| --- | --- | --- |
| **openai** | `gpt-5.4-mini` | **answered** - 45 input, 12 output tokens |
| gemini | `gemini-2.5-pro` | 404 `model_unavailable` |
| gemini | `gemini-2.5-flash` | 404 `model_unavailable` |
| gemini | `gemini-3.1-pro-preview` | 429 `quota_exhausted` - **no credit** |
| anthropic | - | revoked 1 September, not probed |

Total cost of the whole exercise: **$0.000088**, at the pinned `openai:gpt-5.4-mini` rate of
$0.75/M input and $4.50/M output.

**OpenAI works.** The $10 top-up is live and the model half of a review is no longer a blocker.

**The fallback target does not.** `convex/lib/providerFallback.ts` will start a second review on
gemini when openai fails - and gemini has no credit and cannot reach two of the three models its
stored `availableModels` claims. So the cross-provider fallback is currently a mechanism with
nowhere to fall back *to*. It is correct and it is unusable, and those are different problems: the
code needs no change, the account does.

**Two things this probe found the hard way, recorded so the next person does not.** OpenAI's
`/v1/responses` refuses `max_output_tokens` below 16 outright. And the GPT-5 family spends output
tokens on reasoning before emitting anything, so a ceiling low enough to be "free" returns
`truncated` - which is indistinguishable from a real failure and answers nothing. 256 is the
smallest ceiling that reliably produces a verdict, and it still costs under a hundredth of a cent.

## undici advisory GHSA-3wwx-pv8p-q78v, carried and not reachable

`pnpm audit` reports it against `undici@7.29.0` (via `@vercel/sandbox@3.2.1`, production) and
`undici@8.10.0` (via `jsdom` under vitest, dev only). The gate warns rather than fails, which is
correct here.

The vulnerable path is a denial of service in undici's **WebSocket** `permessage-deflate`
decompression. BuildIT opens no WebSocket anywhere - grep across `packages/runner/src`,
`packages/broker/src` and `convex` returns nothing - so the code that would have to run for this to
matter is never entered. Both copies are transitive and neither is directly depended on.

**Deliberately not overridden.** Forcing a different undici under `@vercel/sandbox` would change the
HTTP client of the one component whose failures have cost the most in this project, to close a path
that is not reachable. The honest trade is to carry the advisory, state why, and revisit it when
`@vercel/sandbox` ships a bump of its own.

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

## A notification email would name a private repository while claiming to be source-free

Latent, not live. `convex/notifications.ts` holds `customerEmailDeliveryAvailable = false`, never
reassigned, and `tests/architecture/public-function-reachability.test.ts` records the whole
capability as off by construction. The outbox is additionally gated on local capture only
(`packages/operations/src/emailCaptureConfig.ts` refuses when `VERCEL` or `VERCEL_ENV` is set and
requires three loopback URLs), production Convex carries none of those variables, and no cron drains
the outbox. There is no transactional sender anywhere in the tree.

When it does run, `convex/notificationOutbox.ts` puts `repository: "owner/name"`, `prNumber` and
`commit: headSha` into the message, and `packages/operations/src/email.ts` asserts in the body that
*"This source-free message contains no code, diff, logs, findings, prompts, or credentials."*

That sentence is literally true — a repository name is metadata, not source. It is also the kind of
claim this product exists not to make loosely: for a private repository, the name and a commit sha
are the two things the recipient's mail provider now holds, and a reader who took the sentence at
face value would not expect either.

**Precondition before email ships.** One of:

- omit `repository` and `commit` from the body when the repository is not public, leaving the pull
  request link to carry the context for someone who already has access; or
- widen the sentence to name the metadata it does carry, so the claim matches the message.

Not a disclosure today, and not fixed today, because the capability cannot be reached. Recorded so
the choice is made before delivery is switched on rather than after.

## `organizations.fingerprintKeyVersion` promised per-tenant keying the product does not do

**Status: field removed on 3 October 2026 (#83 and its follow-up). The single deployment-wide key it misdescribed is unchanged and still recorded below.** Both write-only organization fields were retired together: `fingerprintKeyVersion`, and `planId`, which was hardcoded `"trial"` while /pricing said there is no trial clock. Production's two organizations were cleared by a migration before the schema dropped them, and the narrowing deploy's schema validation confirmed no row still carried either.

`convex/schema.ts` declares it and `convex/githubInstallationsData.ts` writes `1` at organization
creation. **Nothing reads it.** `convex/reviewAnalysisWorker.ts` derives both `pathHmac` and
`fingerprintHmac` from a single deployment-wide `FINDING_FINGERPRINT_SECRET`, so the same file path
in two different workspaces produces the same `pathHmac`, and `findings.by_fingerprint` is a
cross-tenant index.

Not a live leak, and the reason is worth stating precisely rather than trusting the index to be
unreachable: its only reader, `convex/findingFeedbackData.ts`, re-scopes every candidate to the
repository's own organization and then requires exactly one survivor, so a cross-tenant collision is
filtered out rather than followed. `reviews:getEvidence` does hand a viewer the full 64-hex
`fingerprintHmac`, but no public function accepts a fingerprint as a lookup key.

The defect is the name. A field called `fingerprintKeyVersion`, stored per organization, advertises
versioned per-tenant key derivation; the product has one key and no versioning.

**Why it is recorded rather than fixed.** Folding `organizationId` into the HMAC message breaks
legacy fingerprint-marker matching in `findingFeedbackData.record`, so a person's dismissal on an
older pull request silently stops being recorded — trading a naming defect for a data-loss defect.
Doing it properly means a versioned per-organization salt with dual-read fallback: derive with the
current version, accept the previous one on read, and re-stamp as rows are touched. Removing the
field instead is a schema narrowing that needs a production row migration first, because Convex
validates documents on write.

Versioned per-organization keys remain a deliberate piece of work, not a rename. Until then: one key,
no versioning - and, since the field is gone, the schema no longer says otherwise.

## Three webhook handlers could not fire, because the App did not subscribe to their events

**Resolved on 2 October 2026.** Recorded because the shape of it matters more than the fix.

`https://api.github.com/apps/buildit-agentic-review` was subscribed to exactly five events —
`check_run`, `check_suite`, `issue_comment`, `pull_request`, `push` — while `convex/http.ts` handled
seven. Three could never be delivered:

| Handler | What its absence cost |
|---|---|
| `repository` | A repository made private, public, renamed or transferred did not re-sync, so `repositories.visibility` stayed whatever it was when access was granted. This is why two repositories that had been made private were still stored as public. |
| `public` | A private repository opened to the world did not re-sync. |
| `pull_request_review_thread` | Resolving or unresolving a BuildIT finding thread recorded no feedback, so `findingFeedbackWorker.observe` had never received a single delivery and the demotion it drives had no input. |

**How it was found.** Ten `buildit-demo-*` repositories were made private, which should have produced
ten `repository` deliveries. `webhookDeliveries` recorded none and `visibilityVerifiedAt` stayed
absent on every row.

**A claim in the first version of this entry was wrong.** It also named
`installation_repositories` as dead. It is not: GitHub delivers installation lifecycle events to an
App without subscription — the settings page offers no checkbox for them, and an `installation`
delivery with action `new_permissions_accepted` arrived while the subscription change was being
saved. The true statement is narrower, and was the original finding: `installation_repositories` is
not sent when a repository changes visibility.

**Verified end to end after subscribing.** Flipping `buildit-demo-zod` public then private produced
`public`, `repository/publicized` and `repository/privatized` deliveries, each `processed`. One
delivery re-synced the whole installation: all 15 repositories in it now match GitHub and carry a
`visibilityVerifiedAt` stamp, including the two that caused the evidence leak, which finally read
`private`. The repository in the second organization's installation was untouched, which is correct.

**Why no test could catch it.** A handler for an unsubscribed event is indistinguishable, in code and
in every test, from a handler that works — GitHub simply never calls it.
`tests/architecture/webhook-events.test.ts` checked that each handled name is an event GitHub *can*
send, which all three were. It now checks each one against the App's subscription list, treats
installation events as always-delivered, and requires a handler for an unsubscribed event to be
declared with what its absence costs. That list is currently empty, which is the point.

**Subscribing was not enough for threads (found live, 5 October 2026).** Resolving a BuildIT thread on
`tanmayiift/buildit-demo-itsdangerous#3` delivered `pull_request_review_thread` and still recorded
nothing, for two reasons. The inline comment's marker carried the model's own finding id (`F1`), which
is neither a document id nor the stored fingerprint, so `findingFeedbackData.record` matched no
finding - on every review, not just this one. And the route scheduled the feedback and then fell
through to the final `else`, so the delivery was logged `rejected`. Inline comments now carry the
fingerprint the analysis stores (`convex/lib/findingFingerprint.ts`, used by both), and the route
completes the delivery as processed. Comments published before the fix still carry model ids and stay
unattributable; a re-review replaces them.

## Autofix died at the scanners segment on every round, and a retry hid why

**Found live on 5 October 2026** (`tanmayiift/buildit-demo-axios#2`, review `nx78rt59…`), the first
autofix run since execution was split into segments. The review ended `platform_failed` with
`autofix_artifact_conflict`, which was the second failure, not the first.

The first: autofix minted the artifact read grants for a round once and handed the same array to every
segment. A read grant is single-use and lives sixty seconds. `prepare` spent them, and `scanners` -
the next segment that reads the repository - presented spent grants, which the broker logged as an
unclassified `execution_failed`. Validation has always minted per request and says why in a comment;
autofix did not follow it. `segmentArtifacts` now mints per call.

The second: the round was retried, the model wrote a different patch, and its candidate was stored
under the round-only slot name the first attempt had used, so `reserveArtifact` refused it as a
conflict and the conflict became the reported cause. Slots now carry the candidate commit.

## A required check failing on both commits is reported as "All required checks passed"

**Status: fixed on 4 October 2026, found the same day** (`docs/evidence/review-measurement-2026-10-04.md`,
second run). Decision taken: a suite that fails entirely is inconclusive; the pre-existing rule stays for a
suite that otherwise ran.

**What changed:**

- **Verdict.** A required test suite that fails on both commits counts as pre-existing only when its own
  output shows tests passing (`passedTestCount` reads the summaries of vitest, jest, mocha, node:test, tap,
  ava and uvu). A suite with no test passing, or with no readable summary, is now `inconclusive`, reason
  `test_suite_failing`, next action `repair_test_suite`. Missing evidence is never read as a pass. A suite
  that ran with a few failures, the original `got` case, still counts as pre-existing.
- **Wording.** A pass no longer says "All N required checks passed" when a required check failed before
  this change. The PR comment says "This change introduced no new failure in its N required checks" and
  names the ones already failing. The review page heading reads "No new failures from this change" and
  names them.
- **Counts on the check.** The rerun after the fix still ended `checks_passed`: zod's output contained a pass
  count, but the page and the comment show only the last six lines, where vitest never prints its summary, so
  nobody could see what was counted. Validation now records the runner's own counts on the test check
  (`testCounts`: tests and test files, kept apart) and both readers print them from one formatter -
  for example "Failed · already failing on base · Tests: 7 passed, 5 failed · Test files: 6 passed, 192
  failed". Test files are shown whenever one failed. A count is read only from a summary line, never from
  prose or a code frame.
- **Most files failing is not a suite that ran (decided 4 October 2026).** The counts showed zod's suite on
  both commits loading 6 of 198 test files, with 7 of 12 tests passing. Under the #91 rule, which made a
  suite inconclusive only when no test passed, that stayed `checks_passed`. The rule is now
  `testSuiteRanTooLittle`: no test passed, **or more than half of the test files failed**, ends
  `inconclusive` (`test_suite_failing`). Exactly half is not most. A got-style suite, with a few failing
  files and most clean, still counts as pre-existing. The stored flag was renamed `noPassingTests` →
  `testSuiteFailing`; no production row carried the old name (0 of 2,420).

The original record follows.

**What happened.** On `buildit-demo-zod#1`, the required `test` check (all 194 tests failing to load)
and the required `gitleaks` check failed on the base and the head commit. The deliberate pre-existing
rule says a failure already on the base commit does not block, so the verdict was `checks_passed`.

**What the reader was told was false:**

- The PR comment opened "All 5 required checks passed with complete evidence", then listed `test` and
  `gitleaks` as already failing.
- The GitHub check was `success`, "Ready for human review".
- The review page heading read "All required checks passed — BuildIT found enough evidence for this
  exact commit", above a table showing Test and Secret scan as Required · Failed.

**Two separate questions:**

1. **The wording is simply wrong** and should change whatever the policy. "All N required checks passed"
   must not be printed when a required check failed, pre-existing or not. The page heading must say
   what happened, for example "No new failures from this change — 2 required checks were already
   failing on the base commit".
2. **Policy:** should a required test suite that fails on both commits still end `checks_passed`? The
   pre-existing rule was written for one unrelated failure in an otherwise working suite (a missing CA
   bundle in `got`). A suite that fails entirely gives no evidence about the change. By the rule that
   missing evidence is inconclusive, that case arguably should be `inconclusive`. This needs a decision
   before it changes.

## A repository without a lockfile gets no tests, and the verdict reads as a pass

**Status: fixed on 4 October 2026, found the same day** (`docs/evidence/review-measurement-2026-10-04.md`).

What changed:

- **Validation:** when `package.json` declares a test script but there is no lockfile, a required `test`
  check is recorded on both commits as not run, with the reason `no_lockfile`.
- **Verdict:** `computeReviewDecision` turns that into `inconclusive`, with reason `tests_need_lockfile`
  and next action `add_lockfile`, never "retry". The stored verdict, the GitHub check and the PR comment
  all derive it from the same evidence.
- **Consent panel:** it now lists only what will run, read from the repository root at the pinned commit.
- **Scanner durations:** recorded where each scanner runs, so the per-review sandbox ledger is no longer 0.

A repository with no `package.json` still passes on the scanners, as before. It declares no test BuildIT
skipped, and the consent panel now says so.

The original record follows.

**What happened.** `tanmayiift/buildit-demo-p-queue` has a `test` script but no lockfile, which is common:
many npm libraries set `package-lock=false`. BuildIT installs with `npm ci`, which needs a lockfile, so the
package manager resolved to `none`. Install, test, lint and typecheck never ran; only BuildIT's static
rules and Gitleaks did.

**What the reader was told:**

- The consent panel said BuildIT would run "dependency install, test, lint, typecheck".
- The verdict was `checks_passed`: "All required checks passed — BuildIT found enough evidence for this
  exact commit."
- Coverage showed "Partial".
- Nothing said the project's own test suite did not run, or why.

**Why it matters.** This is the claim BuildIT exists to refuse: a pass that does not say what it did
not check. Two parts need fixing:

1. The consent panel must name the checks that will actually run for this repository, or say that tests
   need a lockfile.
2. When the repository declares a test script that could not run, the verdict must say so. It should
   either be `inconclusive` with a stated reason, or carry a visible "tests not run: no lockfile" line
   beside the scanner results.

**Related measurement gap.** Scanner checks record `durationMs: 0`, so the per-review
`usageLedger` `sandbox_seconds` for a scanner-only run is 0. The real cost, about 13 s, shows up only
in the org and platform counters.

## The artifact stack's stored template described Pulsetrade; it is now update-protected

**Status: resolved on 3–4 October 2026.** `pnpm smoke:aws-boundary` passes (`oidcStackOwnership: matches`),
drift detection reports every resource `IN_SYNC`, and the stack policy still denies every update.

CI now runs that check on every push to `main` and before every release, through the read-only
`buildit-ci-boundary-reader` role (`infra/aws/ci-reader.yaml`, its own protected stack) assumed with GitHub's
OIDC token. No AWS key is stored anywhere.

How it was done, one operation at a time, each previewed as a change set and checked against backups of
the live trust, key and bucket policies taken beforehand:

1. Update to the stored template with three changes only: `DeletionPolicy: Retain` on the provider, the
   role trust as it already was live, and the key policy as it already was live. Rollback disabled, so a
   failure could not restore the Pulsetrade trust. Every live policy stayed byte-identical.
2. Remove `VercelOidcProvider` from the stack. Retained, so IAM kept it.
3. Import `oidc.vercel.com/buildit-agentic-review` under that logical ID. Imports cannot take a one-time
   stack policy override and the import's post-step applies stack tags, so the deny-all policy was swapped
   for one allowing updates only to `AWS::IAM::OIDCProvider` resources for that operation, then restored.
4. Update to `infra/aws/artifacts.yaml`, which now carries `Retain` and the live thumbprint so an update
   cannot delete the provider or strip its thumbprint list.
5. Delete the orphaned `oidc.vercel.com/pulsetrade` provider, after confirming no role trusted it.

One thing the original audit missed: drift detection reported `BuildITKey` in sync while its live key
policy matched the repo template rather than the stored one. KMS key-policy edits were invisible to it, so
the key policy was compared directly, not trusted to drift detection.

The record below is the state before the fix, kept because it explains why it was done this way.

**Earlier status: mitigated on 2 October 2026. The bookkeeping is still wrong, deliberately.**

`pnpm smoke:aws-boundary` ran for the first time on 2 October 2026 — no AWS credentials had ever been
configured, so it had only ever warned and exited 0. It passed every check of the artifact data
boundary on its first run: bucket region, KMS default encryption with the correct key, public access
fully blocked, the bucket not public, versioning disabled with no historical versions, the artifact
and replay-marker expiry rules, and KMS key state, single-region and rotation. Then it failed on
`aws_boundary_oidc_stack_drift`.

**Three things disagree.**

| | Team it describes |
|---|---|
| The live `ContentBrokerRole` trust policy | `buildit-agentic-review` — correct, hand-edited after the team moved |
| The stack's **stored** template | `pulsetrade`, as literal string keys |
| `infra/aws/artifacts.yaml` in this repo | parameterised — but it **could not be deployed at all** |

The repo template used `!Sub` as a map key in the trust condition. CloudFormation parses that as an
intrinsic-function map and rejects it: `Template format error: ... map keys must be strings`. So every
`aws cloudformation deploy` of this file failed validation before touching anything, and nothing ran
`validate-template` to notice. It is fixed — the condition is now a substituted JSON string — and
`validate-template` accepts it.

**What a deploy would actually do**, measured rather than guessed: a read-only change set created and
then deleted unexecuted on 2 October 2026 proposed seven changes. `VercelOidcProvider` would be
**replaced**; its target, `oidc.vercel.com/buildit-agentic-review`, already exists outside the stack, so
the create would fail with `EntityAlreadyExists` and the stack would **roll back** — and the rollback
target is the stored Pulsetrade state, which would leave the broker unable to assume its role. It would
also modify the KMS key and both bucket policies, for reasons not yet audited, which says the repo
template has diverged from the stack well beyond the team slug.

**Decision: protect, do not migrate.** The live system is correct and the broker works. Migrating the
stack's bookkeeping means several production IAM operations, each with a rollback that could break every
review, and touches the encryption boundary for unaudited reasons. None of that buys anything the live
system lacks. So instead:

- `infra/aws/stack-policy.json` is attached to `buildit-production-artifacts`. It denies `Update:*` on
  every resource, so the console's "use current template", `--use-previous-template`, and a deploy of
  this repo's template all fail safely instead of acting on the disagreement. It changes nothing about
  the working auth and is reversible.
- `scripts/verify-aws-boundary.mjs` checks the policy is still attached, **before** it checks trust, so an
  unprotected stack reports the more urgent problem first (`aws_boundary_stack_unprotected`).
- `tests/architecture/aws-boundary.test.ts` refuses an intrinsic used as a map key, pinned against the
  exact original lines, and pins the committed stack policy.

The gate continues to fail on `aws_boundary_oidc_stack_drift`. That is correct: the drift is real, and a
gate that passed while it existed would be asserting something untrue.

**When someone does want the bookkeeping fixed**, with nothing in flight and someone watching:

1. Audit why the change set modifies `BuildITKey`, `ArtifactBucket` and both bucket policies, and bring
   the template into line with the stack for those first. Do not proceed while the KMS key would change.
2. Add `DeletionPolicy: Retain` to `VercelOidcProvider`, and make `ContentBrokerRole`'s trust reference
   the provider ARN as a parameter rather than through the resource, so removing the resource does not
   rewrite the role.
3. Remove `VercelOidcProvider` from the stack (it is retained in IAM), then **import**
   `oidc.vercel.com/buildit-agentic-review` under that logical ID. Nothing is created or deleted, so the
   broker never loses its trust.
4. Delete the orphaned `oidc.vercel.com/pulsetrade` provider.
5. Re-run `pnpm smoke:aws-boundary`. Every step needs a single-operation override of the stack policy:
   `--stack-policy-during-update-body` with an explicit Allow for exactly the resources that step touches.


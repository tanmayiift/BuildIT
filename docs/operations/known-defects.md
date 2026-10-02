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

## `organizations.fingerprintKeyVersion` promises per-tenant keying the product does not do

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

Either way it is a deliberate piece of work, not a rename. Until then: one key, no versioning, and
the schema says otherwise.

## Four webhook handlers cannot fire, because the App does not subscribe to their events

Read from `https://api.github.com/apps/buildit-agentic-review` on 2 October 2026, the production
GitHub App is subscribed to exactly five events:

```
check_run  check_suite  issue_comment  pull_request  push
```

`convex/http.ts` handles seven. The four that GitHub will never deliver:

| Handler | What its absence costs |
|---|---|
| `installation_repositories` | Adding or removing a repository in GitHub does not reach BuildIT until somebody presses Refresh on `/repositories`. The comment in `http.ts` says this handler exists because "a customer could grant access and watch it be ignored" — which is still what happens. |
| `repository` | A repository made private or public, renamed or transferred does not re-sync, so `repositories.visibility` stays whatever it was when access was granted. |
| `public` | A private repository opened to the world does not re-sync. |
| `pull_request_review_thread` | Resolving or unresolving a BuildIT finding thread records no feedback. `findingFeedbackWorker.observe` has never received a single delivery, so the learning signal and the demotion it drives (`demotedByLearning` in `reviewPublicationWorker`) have no input. |

**How it was found.** Ten `buildit-demo-*` repositories were made private, which should have produced
ten `repository` deliveries. `webhookDeliveries` recorded none, and `visibilityVerifiedAt` stayed
absent on every row. The App's own event list confirmed why.

**Why no test caught it.** A handler for an unsubscribed event is indistinguishable, in code and in
every test, from a handler that works — GitHub simply never calls it. `webhook-events.test.ts` checked
that each handled name is an event GitHub *can* send, which all four are. It now also checks each one
against the App's subscription list, and requires a handler for an unsubscribed event to be written
down with its consequence. That is the assertion that would have caught all four.

**The fix is not in this repository.** GitHub App event subscriptions live in the App's settings and
have no REST endpoint — `PATCH /app` does not exist. Someone with admin on the App must add
`repository`, `public`, `installation_repositories` and `pull_request_review_thread` under *Subscribe
to events* at `github.com/settings/apps/buildit-agentic-review/permissions`. No code change is needed
once they are added; all four handlers already exist and are tested.

**What is not affected.** The evidence-publication leak fixed in #60 does not depend on any of this.
`publishAsEvidence` is absent on every row and `visibilityVerifiedAt` is absent too, so the public
query refuses on two independent conditions regardless of whether `visibility` is stale. That was the
point of requiring four conditions rather than trusting the column to converge.

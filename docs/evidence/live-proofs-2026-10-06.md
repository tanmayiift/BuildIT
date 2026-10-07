# Live proofs, 6 October 2026

What was shown to work in production on 6 October, and what is still unproven. Every entry names a review id, a pull request, a workflow run or a log line. Nothing here is inferred from a passing test.

## 1. Releases run from GitHub after CI, one per commit (#124)

| Commit | Release run | Trigger | preflight / release / confirm |
|---|---|---|---|
| `20c155b` (#124) | 37415256530 | `workflow_run` | success / success / success |
| `ffb8de1` (#125) | 37416251962 | `workflow_run` | success / success / success |
| `f9bbe96` (#130) | 37418165031 | `workflow_run` | success / success / success |

- **Broker health matched each merge in turn.** It reported `20c155b`, then `ffb8de1`, then `f9bbe96`.
- **Main's CI is no longer cancelled.** `32c4a5b` and `74d0a82` were pushed a minute apart, and both CI runs proceeded. Only the newer gets a release: preflight refuses a commit main has moved past.
- **The earlier "lease race" `verify` failure** (release run 37343020286, `execution_lease_hold_too_long`) was already fixed by one clock reading per checkpoint in `convex/lib/executionSegmentDriver.ts`. Release no longer runs `verify` at all, because CI did.

## 2. Inline comments post again (#125)

`@buildit review provider=openai` on `tanmayiift/buildit-demo-itsdangerous#3`, review `nx76d4bbv4ct0jsvehj6gm07qd8fr5cc`:
- **Verdict:** `changes_requested / blocking_findings`.
- **Convex log, 05:05:33Z:** `buildit_inline_publication { outcome: 'posted', selected: 1, posted: 1, skipped: 0 }`.
- **On GitHub:** an inline comment by `buildit-agentic-review[bot]` on `src/itsdangerous/signer.py:218` at 05:05:40Z.
- **Before #125:** the same review posted no inline comment. GitHub's `DELETE` returns 204 with no body, the JSON parse threw, and the catch swallowed it after deleting the old comments.

## 3. Autofix opens a stacked fix pull request again (#130)

`@buildit autofix provider=openai` on `tanmayiift/buildit-public-fixture#22`.

**First attempt:** review `nx7a3rddc1zkckyy6mb1eckhb98fr6bf`, at 05:04Z.
- Context, validation and analysis completed.
- Round 1's sandbox job completed (05:05:50–05:06:08Z), and its candidate passed every required check.
- The broker logged no `buildit_execute_failure` and no 5xx in the window.
- `reviewAutofixWorker:deliverPassed` then threw `autofix_passed_round_missing` three times (05:06:11–14Z).
- **Cause:** the round's validation artifact had been renamed to carry the candidate commit, and the reader still looked for the old name. **The sandbox was not the problem.**

**After #130:** review `nx7agjeaj6nzhpjz2wty8cfzkn8frvgt`, at 05:27Z.
- **Outcome:** `delivered / delivery_complete`.
- **Fix PR:** **`tanmayiift/buildit-public-fixture#25`**, opened by `app/buildit-agentic-review` at 05:28:38Z. Branch `buildit/pr-22/…` → `rates-tls-163652`, +1/−1.
- **Its `BuildIT / Autofix` check is green:** "Validated candidate `706524a` after 1 bounded Autofix round. BuildIT cannot merge this pull request; a human owns the merge decision."

**When autofix last delivered:** on 3 September (`#23`). It could not deliver at all between #119 (5 October) and #130.

## 4. The sandbox, with diagnostics deployed (#125)

- **Today's runs:** both reviews and both autofix rounds ran their sandbox segments. The broker logged no provider failure.
- **The two refusals of 5 October are still unexplained.** They predate the diagnostics. A recurrence will now log the provider's HTTP status, error code and failing operation (never its text) in `buildit_execute_failure`.
- **Capacity:** it was ruled out for those refusals (68 of 5,000 creations used then). It is a real constraint going forward:
  - Vercel Hobby includes **5 hours of sandbox CPU a month**, shared by every BuildIT user.
  - The last 7 days used 1 h 43 min over 27 reviews, **about 3.8 CPU-minutes a review**.
  - That is about 80 reviews a month for the whole platform.

## 5. The review page shows the lines a finding cites (#129)

Production web was deployed at 11:13:58 IST with release 37419719273. The signed-in review page for `nx76d4bbv4ct0jsvehj6gm07qd8fr5cc` (itsdangerous#3) now has "Show the cited lines". Opening it rendered:
- **The excerpt:** `src/itsdangerous/signer.py`, captioned "lines 215–218 cited". Ten lines in all: the cited range plus three either side, read from the reviewed commit's snapshot.
- **The cited lines:** marked `›`. They are the `django-concat` branch that derives the key from `self.salt` and ignores the per-call salt, which is the finding's claim.

Before #129, that page said "No source was shown" and the reader had to find the lines themselves.

## 6. The homepage and the review queue, as deployed (#131, #132)

Production web at `20fa09c` (release completed 11:31 IST):
- **Homepage `/`.** It renders the hero review card, with cited line 4 (the agent option that turns certificate verification off; the literal is not repeated here, because BuildIT's own scanner flags it anywhere in the tree), and the drawn accuracy-panel illustration.
- **Review queue `/reviews`, signed in.** It opens with the current results split by verdict:
  - Changes requested 16;
  - Checks passed 8;
  - Running checks 3;
  - Inconclusive 3;
  - BuildIT failed 2;
  - Fix delivered 2;
  - Reading context 1.

  It notes that "30 more results are for commits a pull request has since moved past, folded under each section". Before, the same queue listed every one of those rows inline.

## 7. Vercel Pro, and BuildIT's own sandbox allowance

- **Vercel plan.** At 11:20 IST the owner moved the Vercel team to Pro. Sandbox CPU is now metered at about $0.13 an hour, instead of the 5-hour monthly cap.
- **Workspace allowance.** BuildIT's own per-workspace allowance for the owner's workspace was raised from 9,000 to 18,000 sandbox-seconds this month, for the R0/R1 benchmark. This was done through the audited operator mutation `organizations:setCapacityLimits`; audit request `sandbox-allowance-benchmark-2026-10-06`.
- **Platform ceiling.** BuildIT's own platform ceiling moved from Hobby's 18,000 seconds to a 180,000-second (50-hour) spend guard in #133, merged 7 Oct. Before that it still capped the whole platform at about 80 reviews a month.

## 8. The R0 baseline, and cached tokens (#126, #134)

- **What ran.** `pnpm eval:production post --label R0`: 11 historical pull requests × 3 runs on production with findings-v6 (`historical-v2-R0-runs-2026-10-06.json`).
- **Valid runs.** 31 of 36 attempts were valid; every case ended with at least 2.
- **Platform failures, recorded separately.** Five attempts failed on zod and date-fns. GitHub refused file reads (`repository_access_refused`, status 403) after about 30 reviews in 30 minutes, which used up the installation's API budget. The runner now goes one repository at a time with a pause, and #136 waits out GitHub's undeclared secondary limit.
- **Scored** (`…-R0-critical-high-2026-10-06.json`):
  - **4 of 10 defects detected** (gson, express, zod, date-fns), each by a majority of valid runs;
  - the clean control passed all 3 runs;
  - $2.42 over 36 reviews.
- **Cached tokens.** **508,800 of 938,337 input tokens were served from OpenAI's cache.** Repeated runs of one pull request share long prefixes. This proves cached tokens above 0.
- **A bookkeeping defect, found and corrected.** R0's first runs were marked unparseable because the cross-check compared the report's `accepted` with the table's `open`, which is how a confirmed finding is stored. Fixed in #134. `revalidate` re-checked those runs from their saved reports and stored rows, and marks each record it corrected.

**A confirmed warning is advisory (#127).** R0's axios review `nx7ce66vj341n2pr0cw6brvqks8frvyq` published "**Warning · Advisory · Confirmed by evidence** · `lib/helpers/Http2Sessions.js:17`" under the sentence "Only Critical and High findings block a merge; Warning and Info are advisory". The verdict was `inconclusive`, not `changes_requested`.

## 9. Convex over its plan, and fixed (#138)

**The email.** Convex wrote on 6 Oct that the team had exceeded the Free plan.

**The cause.** The usage page showed **database I/O at 1.72 GB of 1 GB** after six days of October; every other resource was under its limit. Three live subscriptions accounted for 1.57 GB:

| Query | Reads |
|---|---|
| `publicProof.summary` | 862 MB |
| `activation.funnel` | 434 MB |
| `reviews.list` | 272 MB |

Each re-read hundreds to thousands of rows for every open page on every write.

**The fix (#138)**
- the `/proof` summary is now summarised every six hours into one row;
- the queue reads `activation.path` (five steps only) and a 100-review window;
- unhandled webhook events are no longer stored;
- `reviewLocks` (write-only) is gone;
- a daily `retention.sweep` runs.

**After the 09:41 IST release**

| Table | Before | After |
|---|---|---|
| `webhookDeliveries` | 5,564 | 651 |
| `authRefreshTokens` | 1,488 | 52 |
| `authSessions` | 14 | 3 |
| `authVerifiers` | 43 | 12 |
| `reviewLocks` | 267 | 0 |

Reviews (280), check results and usage rows were untouched.

**Checked live afterwards**
- Still signed in.
- `/reviews` shows the activation steps and the verdict summary.
- `/proof` reads "Production data · no account, no key" and "Summarised at 2026-10-07 04:06:51 UTC".

**Reads, measured after** (Convex usage page, UTC days, read 7 Oct about 05:00 UTC):

| Day | Database reads |
|---|---|
| 6 Oct, before the fix | 891.78 MB |
| 7 Oct, 00:00 to about 05:00 UTC | 35.7 MB |

The 7 Oct window holds the four hours before the 04:11 UTC release and the first hour of the R1 benchmark. A whole day after the fix has not been measured yet. October stands at 1.75 GB.

**Still the owner's decision.** October's reads were already past 1 GB before the fix. On Convex Starter (pay as you go) the overage costs about $0.22 per GB; Professional adds daily backups.

## 10. The GitHub failure emails

**Upstream automation in the benchmark demo repositories.** The repositories are copies of upstream projects and kept the upstream scheduled workflows, which failed in this account. Eleven were disabled with `gh workflow disable`, and each can be re-enabled:
- CodeQL in express, gson, requests and body-parser;
- Scorecard in express, gson and body-parser;
- the issue lockers in itsdangerous and zod;
- zod's npm lockstep check;
- axios's AI Moderator, which fired on our own `@buildit` comments.

The demo pull requests' own CI stays on.

**`sharp` 0.35.4.** A new advisory (GHSA-wq5f-xc86-pv6w) failed the release audit on every pull request. Patched to 0.35.5 in #138.

**Cancelled runs on main.** GitHub cancels older *waiting* runs in a concurrency group even with `cancel-in-progress: false`, so five quick merges cancelled three CI runs on main. #139 gives each push to main its own CI group and serialises only the deploy job.

## 11. R1: prompt v7 against v6 (#128, #142)

**What ran.** `pnpm eval:production post --label R1`: the same 11 pinned pull requests × 3 runs as R0. findings-v7, critic-v4 and arbitration-v4 were enabled for the ten demo repositories by allowlist (`historical-v2-R1-runs-2026-10-07.json`). **All 33 runs were valid.** The one-repository-at-a-time runner and #136's wait meant GitHub refused nothing.

**Scored** (`…-R1-critical-high-2026-10-07.json`, then `pnpm eval:compare` against R0):

| | R0 (v6) | R1 (v7) |
|---|---|---|
| Defects detected | 4 of 10 | **5 of 10** |
| Improved / regressed | — | **1 / 0** |
| Clean control | passed 3/3 | passed 3/3 |
| Schema-invalid stage outputs | 0 of 89 | 0 of 89 |
| Cached input tokens | 508,800 of 938,337 (54.2%) | 573,952 of 1,017,438 (56.4%) |
| Cost per review, recorded | $0.067 | $0.086 |
| Cost per review, at corrected prices (#146) | $0.060 | $0.073 |

- **Improved:** p-queue, from 1 run of 3 to 2 of 3.
- **Unchanged:** gson, express, zod and date-fns stay detected; body-parser, requests, itsdangerous, axios and got stay missed.
- **The cost gap is mostly a pricing bug.** $0.44 of R1's recorded $2.85 was two gpt-5 escalation calls charged at the generic $15/$75 ceiling (see §12).

**Decision.** No regression and no false block, so v7 became the default (#142), released at `cae1235`. `BUILDIT_PROMPT_CANDIDATE_REPOSITORIES` was removed from production.

## 12. Found by reading R1, fixed and released

Released at `cae1235` and `ba75b74`:
- **A confirmed blocker that did not block (#144).** R1's p-queue review `nx7d1v6y82f4e69m15wtbpn1zx8fvxyc` confirmed a High finding.
  - **What it published:** "1 blocking issue" under the heading "Review needs attention", with the next step "Commit a lockfile". The check was `neutral`.
  - **Cause:** any check that couldn't run outranked a confirmed problem.
  - **Now:** a confirmed blocker or a failed required check requests changes, and the report names what did not run.
- **The history clock (#145).** The same review's page listed every stage between 09:57:07 and 09:57:09. The database recorded 09:57:21, 09:57:42, 09:58:08 and 09:58:13; the page was showing the workflow's deterministic replay clock. The page also said "Coverage: Full" and "Coverage: Partial" for two different things.
- **Six mispriced models (#146).** gpt-5, Claude Sonnet 4.5 and 4.6, Opus 4.6, and Gemini 2.5 Pro and Flash had no pinned price and were charged at $15/$75. One gpt-5 second opinion was recorded as $0.2235; OpenAI's price for it is about $0.027.
- **From the scorecard's open list:**
  - a failed `@buildit` command now explains itself on the pull request (#140);
  - a commit is read as one archive, not one request per file (#141);
  - each finding stores why it ended accepted or uncertain (#143).

## 13. Staying inside the free limits (owner's decisions, 7 Oct)

**The owner's decisions:** keep review history for 30 days, and stay on Vercel Pro.

**Convex, as of 7 Oct about 07:15 UTC**

| Resource | Used | Free plan |
|---|---|---|
| Database I/O | 1.82 GB | 1 GB |
| Data egress | 416 MB | 1 GB |
| Database storage | 55.7 MB | 512 MB |
| Function calls | 78K | 1M |
| Action compute | 5.8 GB-h | 20 GB-h |

- **Reads by function, month to date.** The three queries #138 fixed are flat since it (`publicProof.summary` 881 MB, `activation.funnel` 434 MB, `reviews.list` 272 MB). What remains is small: `reviews.runHistory` 46 MB, the workflow pool's loops about 43 MB, and the benchmark's own polling 21 MB.
- **Egress by function.** 294 of the 416 MB was `reviewContextWorker.gather` uploading each review's source as plain JSON, roughly 3–4 MB a review. #148 gzips it: a 3.20 MB chunk of zod's source becomes 0.66 MB (0.207).
- **Retention (#147).** A finished review older than 30 days is deleted with everything it owns, including its workflow journal. Monthly billing totals, the audit log and learned suppressions stay.
- **October cannot be undone.** Its reads were counted before the fix, and deleting rows costs I/O rather than refunding it.

**Vercel (Pro).** This cycle used $1.79 of the $20 included credit, with 28 days left. Sandbox memory was $0.88 and sandbox CPU $0.40 of that.

## 14. One live review after the release (`ba75b74`, 7 Oct 15:19 UTC)

`@buildit review provider=openai` on `buildit-demo-p-queue#2`, the same commit R1 reviewed. Review `nx7ajxnfrg0bke6015fx9v02jd8fvjhj`:
- **v7 is the default.** The stage records show findings-v7, critic-v4 and arbitration-v4 with no allowlist set.
- **A confirmed blocker decides (#144).** The verdict is `changes_requested` / `blocking_findings`, where R1 got `inconclusive` / `tests_need_lockfile` on this commit. The check went up as `failure`, so it blocks the merge.
  - The comment reads: "**1 blocking issue**. `test` did not run at this commit because there is no lockfile to install from, so this verdict rests on the findings and the checks that did."
  - The inline comment posted (`buildit_inline_publication {outcome: posted, posted: 1}`).
- **One archive per revision (#141).** The log shows `buildit_repository_fetch {head: {archive: 'used', blobRequests: 0}, base: {archive: 'used', blobRequests: 0}}`: no per-file GitHub request on either revision.
- **The reason is stored (#143).** The High finding carries `critic_and_arbitration_supported`.
- **Real times (#145).** The review page's history reads 20:49:18 → 20:49:31 → 20:49:50 → 20:50:19 → 20:50:24 IST, the stored insert times. Before this, every stage showed the workflow's start time.
- **Cost:** $0.095, 66 s from comment to verdict.

## 15. Retention's first real run (#147, #150)

- **#147's first run deleted nothing** (7 Oct, 15:26 UTC, 8 passes). It keyed on `updatedAt`, and marking a review stale when a newer commit arrives touches it, so the 5 Sep reviews looked fresh. It also skipped a review `blocked` since 1 Sep, because `blocked` is not a terminal status.
- **#150 keys on creation and removes month-old blocked reviews.** Released at `54c7493`. Its first run (15:44 UTC) logged `buildit_review_retention {deleted: 3, waiting: 0, passes: 2, complete: true}`.
- **Afterwards:** 121 reviews remain, and none is more than 30 days old. The daily cron keeps it that way.

## Not yet proven live

| Claim | What is waiting |
|---|---|
| A failed `@buildit` command explains itself (#140) | A command failing in production. The path is tested end to end with GitHub stubbed |
| gpt-5 and the Claude and Gemini models charged at their own price (#146) | A review that escalates, or runs on an Anthropic or Gemini key. The price table is tested for every approved model |
| Context egress below 1 MB a review (#148) | Merging #148, then a day of reviews on the Convex usage page |

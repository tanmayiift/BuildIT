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
- **Homepage `/`.** It renders the hero review card, with the cited line `4 › export const agentOptions = { rejectUnauthorized: false };`, and the drawn accuracy-panel illustration.
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
- **Platform ceiling.** It is still the Hobby figure in code (`platformMonthlySandboxSeconds = 18,000`), which now caps BuildIT well below what Vercel allows. See the scorecard.

## Not yet proven live

| Claim | What is waiting |
|---|---|
| A warning-only finding is published as Advisory (#127) | #127 deploying, then one review with a warning-only finding |
| Cached input tokens above 0 (#128) | the candidate prompts enabled for a repository, then two reviews of it |
| Prompt v7 does no worse than v6 on the historical set | R0 and R1: 66 reviews, about 4.2 sandbox CPU-hours, more than the plan has left this month |

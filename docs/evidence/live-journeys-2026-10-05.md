# Live product journeys, 5 October 2026

These are journeys driven on production (`https://buildit-agentic-review.vercel.app`) against the owner's
own demo repositories, as user `tanmayiift`. Each is recorded with:
- review ids;
- what GitHub showed;
- where a journey failed, the real cause, read from the workflow component and the broker logs rather
  than from the last error the workflow recorded.

Production during these runs: `23e730a`, deployed by `release.yml` run 37364150555.

## Proven

| Journey | Run | Result |
|---|---|---|
| `@buildit review` comment | p-queue#2 → review `nx7ck0sqt6…` (19:17Z) | PR comment and neutral check posted; verdict `inconclusive`. |
| Automatic review on push | review `nx7fbx37…` (19:32Z) | Started by the push alone; repository trigger then set back to manual. |
| `@buildit ask` | p-queue#2 | Answered 9 s after the review finished. |
| Dismiss from the review page | gson#3, finding `m57a7gvg…` | Scope "This commit only". The page said "Dismissed by your team…". Production recorded `findings.resolution: dismissed` and a `findingFeedback` row `verdict: dismissed` at 20:17:21Z. |
| Refusal panel | user B's review opened as A | "Review evidence is unavailable": names nothing of B's (see `layout-audit-live-2026-10-05.md`). |

## Failed live, root-caused and fixed

### Dismissing by resolving the BuildIT thread (fixed in #118)

On itsdangerous#3 I resolved thread `PRRT_kwDOUPK8GM6fjvB3` at 20:04:14Z.
- **What GitHub did:** it delivered `pull_request_review_thread`.
- **What BuildIT recorded:** the delivery as `rejected`, and nothing about the finding.
- **Cause 1:** the inline comment's marker carried the model's own id, `F1`, which matches no finding.
  This affected every review.
- **Cause 2:** the route fell through to its final `else`, which marked the delivery `rejected`.
- **Fix:** inline comments now carry the stored fingerprint, and the route completes the delivery as
  `processed`.

### `@buildit autofix` (fixed in #119)

On axios#2, review `nx78rt59…` (mode autofix) went through:
1. context ✓
2. validation ✓ (job `validation:…` reached `complete`)
3. analysis ✓
4. `runConvergence`, which ended `platform_failed` with `autofix_artifact_conflict`.

The workflow component and the broker logs show the conflict was the second failure:

1. **20:07:11:** the patch call ran. The candidate was stored as `autofix-1-candidate-0/1`.
2. **20:07:56:** the autofix job's `prepare` segment succeeded.
3. **20:08:03:** `scanners` failed in 997 ms. The broker logged `execution_failed`, category
   `unexpected`, HTTP 503. The cause: the round's artifact read grants had been minted once and handed
   to every segment, and `prepare` had already spent them.
4. **20:08:09 and 20:08:58:** the round was retried. The new patch produced a different candidate under
   the same slot name, and `reserveArtifact` refused it as a conflict.

The fix:
- grants are minted per segment (`segmentArtifacts`);
- slots carry the candidate commit, so a retry with a different patch no longer collides.

### A misleading message on an expired review (fixed in #120)

gson#3's review is from 5 September, in a workspace with 24-hour retention. Its page said the finding
text "could not be loaded … check your workspace access". In fact the artifact was erased on
6 September, as designed. The page now says the text was erased, and on which date.

## Gemini review after #98

I commented `@buildit review provider=gemini` on p-queue#2 at 20:32:59Z, which started review
`nx7drheq…` on `gemini-3.1-pro-preview`.
- **Verdict:** `inconclusive / tests_need_lockfile`. This is correct: the fork has no lockfile, and
  OpenAI reached the same verdict on this PR.
- **Calls:** one model call (findings): 29,819 input tokens, 9 output tokens.
- **Cost:** $0.149 at the conservative pinned rate.
- **Time:** 6.1 s of model time, 60 s from consent to verdict.
- **Skipped stages:** requirements, critic and arbitration, because there was nothing for them to
  judge (#104/#106).

This is the first Gemini review since #98. The previous one, zod#1 at 16:27Z, failed `truncated`
because thinking tokens used up the output limit.

The run also shows the gap #114 targets: coverage `partial (analysis_budget)`, meaning a changed file
did not fit the 80 KB window whole.

## Not run

Invite → accept → switch workspace. It needs a write into user B's workspace, which this evaluation was
told not to make. Tests cover it (`convex/tenantIsolation.test.ts`, the invitation cases).

## After the fixes deployed (`f0960b9`, released from GitHub at 22:00Z)

- **Thread feedback (#118):** zod#1's new inline comment carried a 64-hex fingerprint marker.
  - Resolving thread `PRRT_kwDOUOypWs6pPKfv` produced a delivery `resolved processed completed` at
    22:19:26Z, and feedback `dismissed` at 22:19:27Z.
  - Unresolving it recorded `accepted`.
- **zod#1 with #114 (`nx737vt2…`):** `changes_requested`, with one high, blocking finding. It is the
  PR's seeded defect: `int16: [-32768, 32768]` should end at 32767. Earlier runs never saw
  `core/util.ts`.
- **Autofix after #119, axios#2 (`nx7asw5a…`):**
  1. Round 1 got past `prepare` and `scanners`, which #119 fixed, and on to `diagnostics`. That job
     failed there with a broker `execution_failed`.
  2. The retried round ran to `complete`, but its candidate failed the required `test` check. That
     check also fails on the base commit (129 of 132 files).
  3. In round 2 the model returned the file unchanged (`patch_empty`), which was reported as
     `platform_failed`.

  #123 makes autofix decline before spending in that situation, and say so in the report.
- **Autofix positive proof, public-fixture#22:** checks pass on base, and the PR breaks `test` and
  `static_analysis`. Two attempts (`nx7ec44e…`, `nx77yzwc…`) were refused by the sandbox provider with an error BuildIT could not classify (`sandbox_unavailable`, category `unexpected`) within 30 s
  of starting.
  - *Corrected 6 Oct:* the first version of this note blamed the plan's sandbox capacity. That was
    wrong: there was no 402, 68 of 5K creations, and no sandbox running. The cause is unknown, because
    the broker logged none of what the provider said; it now records the status and identifier code.


# BuildIT evaluation scorecard, 6–7 October 2026

This replaces the 5 October scorecard, which graded generously (see its errata). Every grade below cites a live proof (`docs/evidence/live-proofs-2026-10-06.md`), a pull request or a measurement. Plans are not evidence.

Each angle has a "still not done" list, and those lists are not optional reading.

Grades:
- **A**: done and proven live.
- **B**: done, with a known gap.
- **C**: partly done.
- **D**: not done.

| Angle | Grade | One line |
|---|---|---|
| UI/UX | **B** | The homepage leads with a drawn real review. Setup steps draw what they hand over. The review queue opens with its verdicts and folds superseded commits. The review page shows cited lines and failing output. Accessibility passes 136 of 136 page checks. The review page is still text-dense. |
| Product | **B** | Review, inline comments and autofix are proven live: fix PR `buildit-public-fixture#25`. Sandbox capacity moved from Hobby's ~80 reviews a month to a 50-hour Pro spend guard. Convex reads were cut at the source, but the plan decision is open. |
| Core customer | **B−** | A solo developer's path works and its cost is measured. The monthly cap that ruled out teams is lifted. Bursts are now bounded by GitHub's per-installation API budget: about 30 reviews an hour. |
| QA | **B** | The new tests drive code. Three live defects in two days each had a test that encoded the consumer's expectation instead of the producer's output. The release pipeline no longer fails or cancels in public. |
| CTO / LLM | **B−** | Measured now. Prompt v7 detects 5 of 10 historical defects against v6's 4, with no regression and no false block. It is the default. Reading R1 found three defects no test covered: a confirmed blocker that did not block, a history clock, and six mispriced models. All are fixed and released. 5 of 10 is still the ceiling to raise. |

## UI/UX: B

**Done, with evidence**
- **Homepage (#131).** The first screen draws one real review, `buildit-public-fixture#22` at `699dd5f`:
  - the cited line, marked;
  - the failing `test` output;
  - the one-line fix;
  - the stacked PR.

  It uses the review page's own components, and the copy around it is one line. The structure is measured against seven competitors in `docs/design/visual-direction-2026-10.md`. It is checked at 1440 px light and dark, and at 375 px (where a sideways scroll was found and fixed).
- **Illustration (#131).** The accuracy panel carries one illustration, drawn as SVG from the panel's tokens.
- **Setup (#132).** The GitHub-access and model-key steps open with a four-step drawn flow of where the access or key goes.
- **Review page (#129).** "Show the cited lines" reads the lines from the reviewed commit, redacted, and "Show where test failed" shows the last 30 lines of a failed check. Both load only when opened. Live, it shows `signer.py` lines 215–218 for itsdangerous#3.
- **Review queue (#132).** It opens with the current results split by verdict, as a bar and legend, and folds each section's results for commits a pull request has moved past.
- **Accessibility.** axe passes on all 136 route checks, desktop and mobile, light and dark. That includes a keyboard-scroll defect in the new code boxes, found by CI and fixed. New colours are measured at WCAG AA in both schemes.

**Still not done**
- **Generated illustration.** Google AI Studio refused image generation on this account, with "permission denied" on both Nano Banana Pro and Nano Banana 2 Lite. It needs a paid API key, which only the account owner can set up. The one illustration is drawn instead.
- **Text density.** The review page (~830 words) has no visual summary of its own yet. The queue now has one (#132): a verdict bar and legend, with 30 superseded results folded away live.

## Product: B

**Done, with evidence**
- **Review → report → inline comment:** live on `itsdangerous#3` (#125's fix).
- **Autofix → stacked fix PR:** live. `buildit-public-fixture#25` has a green `BuildIT / Autofix` check. It had been unable to deliver since #119; #130 found and fixed why.
- **Only critical and high findings block (#127).** A confirmed warning is advisory, and the report says so above the findings. Live in R0: axios `nx7ce66v…` published "Warning · Advisory".
- **Releases** run from CI on the commit CI tested, one per commit (#124). Nine releases went green on 6–7 Oct. #139 stops GitHub cancelling waiting runs on main in a burst of merges.
- **Capacity (7 Oct).** The owner moved Vercel to Pro, which meters sandbox CPU at about $0.13 an hour instead of capping it at 5 hours. BuildIT's own ceiling became a 50-hour spend guard (#133).
- **Convex (7 Oct).** It ran over the Free plan on database reads: 1.72 GB of 1 GB in six days, 1.57 GB of it from three live queries. Fixed at the source in #138, and the junk rows were cleared (5,564 → 651 webhook rows, 1,488 → 52 spent tokens).

**Still not done**
- **The Convex plan.** October was already past the Free plan's 1 GB of reads before the fix. Avoiding an interruption this month needs Starter (pay as you go, about $0.22 a GB over), which is the owner's purchase. Professional adds daily backups.
- **GitHub's API budget.** A review reads a few hundred files through the installation, and the installation allows 5,000 requests an hour, about 30 reviews. #136 waits out GitHub's per-minute limit, but the hourly one still bounds bursts. Fetching an archive instead of individual files is the structural fix.
- **A failed command still says nothing on the pull request.** #137 now records why; telling the commenter is next.
- **The two sandbox refusals of 5 October.** Unexplained. Diagnostics are deployed, and no refusal has recurred.
- **Invite → accept → switch workspace** is still not exercised live. It would need a write to the second test user's workspace.

## Core customer: B−

**Done**
- **Solo developers.** A medium PR costs about $0.11 of their own OpenAI key, and every call is on Usage.
- **Open-source maintainers.** Forks are reviewed only on a maintainer's command, and the kill switch covers automatic reviews.

- **Startups and scale-ups.** The platform-wide ceiling of about 80 reviews a month is gone: Vercel Pro and BuildIT's 50-hour guard (#133) leave room for roughly 2,500 reviews a month. A workspace's own default is still 3,600 sandbox-seconds (about 40 reviews), and an operator raises it per workspace.

**Still not done**
- **No self-serve way to raise a workspace's allowance.** A team that outgrows its default has to ask.
- **Bursts.** The GitHub API budget bounds them at about 30 reviews an hour per installation (see Product).

## QA: B

**Done**
- Every PR runs `pnpm verify` (2,501 tests on 7 Oct), `pnpm security:release` (919, plus the dependency audit), gitleaks, a release-plan dry run, and the e2e suite with axe and visual snapshots.
- The new tests drive code rather than read source:
  - a parser round trip through the real report composer;
  - autofix evidence found by the names the writer produces;
  - severity applied by arbitration to every level;
  - prompt invariants pinned byte for byte;
  - the /proof snapshot rewritten only on change;
  - retention keeping the live sign-in token.
- **The "git failures".** Eleven upstream workflows in the demo repositories were disabled, and the `sharp` advisory was patched. #139 stops waiting runs on main being cancelled.

**Still not done.** Three live defects in two days were covered by tests that encoded the consumer's expectation rather than what the producer emits:
- the 204 test used a JSON body GitHub never sends;
- the delivery test hand-wrote the artifact name the reader expected;
- the benchmark cross-check test fed `accepted` where the table stores `open`.

All three are fixed with production-shaped fixtures. The rule now in memory is to take a fixture from the writer, never from the reader.

## CTO / LLM: B−

**Done, with evidence**
- **One severity rule** (`blockingSeverities`), shared by arbitration, the report and the evaluation labels.
- **The benchmark runner (#126, `pnpm eval:production`).** It pins every case to its commits, parses what BuildIT published, cross-checks it against what was stored, and scores by majority of runs. It never counts a platform failure as a miss.
- **R0 against R1** (live proofs §8 and §11). The same 11 pinned pull requests, 3 runs each, on production:

  | | R0, findings-v6 | R1, findings-v7 |
  |---|---|---|
  | Defects detected | 4 of 10 | **5 of 10** |
  | Regressions / false blocks | — | **0 / 0** |
  | Valid runs | 31 of 36 | 33 of 33 |
  | Schema-invalid stage outputs | 0 of 89 | 0 of 89 |
  | Input tokens from OpenAI's cache | 54.2% | 56.4% |
  | Model cost per review, at corrected prices | $0.060 | $0.073 |

  v7 became the default for every repository (#142) and the allowlist was removed.
- **Anti-overfitting.** No case path, repository or distinctive phrase from either evaluation set appears in the prompts, and a test pins that against the prompts every repository now receives.
- **Defects found by reading R1, all fixed and released:**
  - **A confirmed High did not block a merge (#144).** Any check that could not run outranked it, so a repository without a lockfile got a neutral check.
  - **Six approved models were charged at the generic $15/$75 (#146).** These were gpt-5, which is the escalation critic, plus the Sonnet, Opus and Gemini 2.5 models. A $0.027 call was recorded as $0.22. Prices are now checked on each provider's page, and a test requires every approved model to have one.
  - **The review history showed the workflow's replay clock (#145).**
- **Where the money goes.** Cost by stage in R1: findings 63%, critic 26%, arbitration 6%, requirements 6%. Arbitration takes a median 2.9 s.

**Still not done**
- **5 of 10.** body-parser, requests, itsdangerous, axios and got are missed by both prompts. itsdangerous is found at High in every run, but its label requires Critical. Raising detection is the next prompt candidate's job, measured the same way.
- **Retiring arbitration is still data-gated.** The reason a finding ended uncertain is now stored (#143). The next benchmark is the first that can show whether arbitration's 6% buys anything.
- **v7 costs about 1.3 cents more a review** than v6, for longer instructions.

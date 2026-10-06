# BuildIT evaluation scorecard, 6 October 2026

This replaces the 5 October scorecard, which graded generously (see its errata). Every grade below cites a live proof (`docs/evidence/live-proofs-2026-10-06.md`), a pull request or a measurement. Plans are not evidence.

Each angle has a "still not done" list, and those lists are not optional reading.

Grades:
- **A**: done and proven live.
- **B**: done, with a known gap.
- **C**: partly done.
- **D**: not done.

| Angle | Grade | One line |
|---|---|---|
| UI/UX | **B** | The homepage leads with a drawn real review. Setup steps draw what they hand over. The review page shows cited lines and failing output. Accessibility passes 136 of 136 page checks. The review queue and the review page are still text-dense. |
| Product | **B** | Review, inline comments and autofix are proven live today: fix PR `buildit-public-fixture#25`. Platform capacity is about 80 reviews a month in total. |
| Core customer | **C+** | A solo developer's path works and its cost is measured. A team cannot adopt a product capped at about 80 reviews a month across every customer. |
| QA | **B** | The new tests drive code. Today's two live defects both had tests, and the tests encoded the wrong expectation. |
| CTO / LLM | **C+** | A severity rule, prompt v7 and a benchmark runner exist. None of it is measured: R0 and R1 have not run. |

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
- **Review page (#129).** "Show the cited lines" reads the lines from the reviewed commit, redacted, and "Show where test failed" shows the last 30 lines of a failed check. Both load only when opened.
- **Accessibility.** axe passes on all 136 route checks, desktop and mobile, light and dark. That includes a keyboard-scroll defect in the new code boxes, found by CI and fixed. New colours are measured at WCAG AA in both schemes.

**Still not done**
- **Generated illustration.** Google AI Studio refused image generation on this account, with "permission denied" on both Nano Banana Pro and Nano Banana 2 Lite. It needs a paid API key, which only the account owner can set up. The one illustration is drawn instead.
- **Text density.** The review queue (~1,500 words) and the review page have no visual summary yet. Their density is unchanged.

## Product: B

**Done, with evidence**
- **Review → report → inline comment:** live on `itsdangerous#3` (#125's fix).
- **Autofix → stacked fix PR:** live. `buildit-public-fixture#25` has a green `BuildIT / Autofix` check. It had been unable to deliver since #119; #130 found and fixed why.
- **Only critical and high findings block (#127).** A confirmed warning is advisory, and the report says so above the findings.
- **Releases** run from CI on the commit CI tested, one per commit, with no cancelled runs on main (#124). Three releases went green today.

**Still not done**
- **Capacity.** Vercel Hobby gives the whole platform 5 sandbox CPU-hours a month, about 80 reviews at the measured 3.8 CPU-minutes each. Past that, every review on every account fails until the reset. This is the largest product risk, and resolving it is a purchase only the owner can make.
- **The two sandbox refusals of 5 October.** Unexplained. Diagnostics are deployed, and no refusal has recurred.
- **Invite → accept → switch workspace** is still not exercised live. It would need a write to the second test user's workspace.

## Core customer: C+

**Done**
- **Solo developers.** A medium PR costs about $0.11 of their own OpenAI key, and every call is on Usage.
- **Open-source maintainers.** Forks are reviewed only on a maintainer's command, and the kill switch covers automatic reviews.

**Still not done.** Startups and scale-ups, two of the four named segments, run many reviews a week. A platform-wide ceiling of about 80 reviews a month makes BuildIT unusable for one team of five, let alone many teams. Until capacity changes, the product serves solo developers and maintainers well and teams not at all.

## QA: B

**Done**
- Every PR runs `pnpm verify` (about 2,460 tests), `pnpm security:release` (about 900), gitleaks, a release-plan dry run, and the e2e suite with axe and visual snapshots.
- The new tests drive code rather than read source:
  - a parser round trip through the real report composer;
  - autofix evidence found by the names the writer actually produces;
  - severity applied by arbitration to every level;
  - prompt invariants pinned byte for byte.

**Still not done.** Today's two live defects were both covered by tests that were wrong:
- the 204 test used a JSON body GitHub never sends;
- the delivery test hand-wrote the artifact name the reader expected, not the one the writer produced.

A test should take its inputs from the producer, not from the consumer's expectation.

## CTO / LLM: C+

**Done**
- **One severity rule** (`blockingSeverities`), shared by arbitration, the report and the evaluation labels.
- **Prompt v7 (#128).** It adds a rubric, the validator's evidence rule, confidence anchors, three synthetic examples and a 1,200-token instruction prefix that OpenAI can cache. It runs behind a repository allowlist; the current prompts are pinned unchanged.
- **Anti-overfitting.** No case path, repository or distinctive phrase from either evaluation set appears in the prompts, and a test pins that.
- **The benchmark runner (#126, `pnpm eval:production`).** It pins every case to its commits, parses what BuildIT published, cross-checks it against what was stored, and scores by majority of runs. It never counts a platform failure as a miss.
- **Label fixes.** The historical labels were corrected. zod's label named a file the defect was never in, and four "upstream" SHAs did not exist.

**Still not done**
- **R0 and R1 have not run.** Neither the 11 × 3 baseline nor the candidate comparison exists, because the 66 reviews need about 4.2 sandbox CPU-hours and Hobby has about 2 left this month.
- **So nothing yet says v7 is better, or even no worse.** A cached-token hit is also unproven. v7 stays opt-in until those runs exist.

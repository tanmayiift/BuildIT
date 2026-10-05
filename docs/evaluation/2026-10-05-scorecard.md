# BuildIT evaluation scorecard, 5 October 2026

This scorecard judges the product from five angles: UI/UX, product, core customer, QA and CTO. Each angle has a grade, the evidence behind it, and what is still at risk. Every claim points at a production run, a pull request or a test. Plans are not counted as evidence.

Grades:
- **A**: done and proven live.
- **B**: done, with a known gap.
- **C**: partly done.
- **D**: not done.

| Angle | Grade | One line |
|---|---|---|
| UI/UX | **B+** | A live signed-in audit is clean on 34 of 34 page loads. Two primitives replaced 27 hand-made copies. One copy defect was found live and fixed. |
| Product | **B** | Review, Ask, dismissal, isolation and release work live. Autofix and thread feedback were broken; both were found live and fixed, and await re-proof. |
| Core customer | **B** | All four segments are named the same way everywhere. Each segment's first question has a working path, and solo-developer cost is now measured. |
| QA | **B−** | 2,375 tests plus 888 release-gate tests run on every PR. Most architecture guards still read source text. |
| CTO | **B** | Model cost fell 54% and tokens 80% on the reference PR. The release now runs from GitHub. Remaining risks are named below. |

## UI/UX

**Evidence**
- **Layout audit in CI:** `tests/e2e/layout-audit.spec.ts` runs on every PR (#107). It fails on:
  - a button within 4px of text;
  - paragraphs over 100 characters a line;
  - horizontal overflow;
  - clipped text.
- **Live, signed in:** 14 workspace routes, two real reviews and another user's review, at 1440px and 375px. Result: **34 of 34 clean** (`docs/evidence/layout-audit-live-2026-10-05.md`). The one fault was the audit misreading a screen-reader-only label, and the audit is fixed (#117).
- **Primitives:**
  - `StatePanel` replaced 13 inline status panels (#107).
  - `EmptyState` replaced 14 empty-state copies (#117). Most copies had read their decorative mark ("GH", "ER") aloud to screen readers.
- **Copy:** the 32 longest strings were rewritten (#107). Phrases that tests pin were kept.
- **Stylesheet:** `flows.css` went from minified lines up to 3,500 characters to one declaration per line, verified equivalent, with six dead rules removed. 53 literals now read their design tokens (#117).
- **Found live and fixed (#120):** a review whose evidence retention had erased said "could not be loaded … check your workspace access". It now says the text was erased, and on which date.

**Residual risk**
- Visual snapshots are Linux-only, so a macOS developer can't refresh them locally. `pnpm snapshots:from-ci` covers this.
- `PageHeader` and `Facts` were not extracted. They have 3 call sites and 1, and none had drifted.
- Five tokens are pinned by the token-scale test but unused: `--duration-base`, `--ease-out`, `--line-subtle`, `--shadow-2`, `--text-3xl`.

## Product: each journey, with its live proof

| Journey | State | Proof |
|---|---|---|
| Sign in with GitHub → model key → review a PR | Live | Signed-in journey, 4 Oct (`docs/evidence/browser-evidence-2026-10-04.md`) |
| `@buildit review` comment on a PR | Live | p-queue#2, review `nx7ck0sq…`, PR comment plus neutral check, 5 Oct |
| Automatic review on push | Live | Review `nx7fbx37…`, 5 Oct |
| `@buildit ask` | Live | Answered 9 s after the review finished, 5 Oct; a PR with no review now gets a reply (#112) |
| Dismiss a finding from the UI | Live | gson#3 finding `m57a7gvg…` → `resolution: dismissed` plus a `findingFeedback` row at 20:17:21Z, 5 Oct |
| Dismiss by resolving the BuildIT thread | **Broken → fixed (#118)** | Delivery arrived, but the marker carried the model id "F1", so nothing matched. Inline comments now carry the stored fingerprint. To re-prove after deploy |
| `@buildit autofix` → stacked PR | **Broken → fixed (#119)** | axios#2, review `nx78rt59…`: read grants were minted once and reused, so `scanners` failed on every round; a retry then masked the cause. To re-prove after deploy |
| Two-user isolation | Live | A and B in separate browsers, plus API probes (`docs/security/two-user-production-proof.md`) |
| Gemini review | Live | p-queue#2, review `nx7drheq…`, 5 Oct. gemini-3.1-pro-preview, one call, $0.149, verdict correct. The last Gemini run before #98 failed `truncated` |
| Uninstall or suspend recorded | Behavioural test | #101 (signed deliveries through the real route) |
| Invite → accept → switch workspace | Not run | Needs a write to the other test user's workspace, which this evaluation was told not to make |

## Core customer: four segments, one story

- **Naming:** the landing page, pricing and README name the same four segments (pricing and README aligned in this change):
  - startup teams;
  - scale-ups;
  - solo developers;
  - open-source maintainers.
- **Solo developer (BYOK cost):**
  - zod#1, a medium PR, now costs **$0.31** of the developer's own OpenAI key. It cost $0.67 before PR-1/2.
  - The Usage page shows every call.
- **Open-source maintainer (fork safety):**
  - A fork is reviewed only when a maintainer with write access comments.
  - The kill switch now covers automatic reviews too (#100).
- **Startups and scale-ups (team review):**
  - Members, roles and an audit log are live.
  - Invites are proven by tests, not live (see above).

## QA

- **Every PR runs:**
  - `pnpm verify`: lint, typecheck, 2,375 tests, build;
  - `pnpm security:release`: 888 tests plus the dependency audit;
  - gitleaks;
  - e2e with axe and visual snapshots.
- **Behavioural tests added in this round:**
  - installation events (#101);
  - the kill switch on automatic reviews (#100);
  - command deliveries and Ask replies (#112);
  - thread feedback through the signed route (#118);
  - autofix grant freshness against the broker's own `consume()` (#119);
  - prompt-chain concurrency and usage pairing (#115);
  - context selection (#114);
  - cached-token accounting (#116).
- **Risk:** 76 of 78 `tests/architecture` guards read source text. Many pin real invariants, but a text guard can pass while behaviour breaks. The two live defects above (#118, #119) both passed every existing test.
- **Recommendation:** each new guard should drive the code, as #118 and #119 do.

## CTO

**LLM pipeline on zod#1, OpenAI, read from production with `scripts/measure-review.mjs`:**

| | Before (`nx77q8d1`, 4 Oct) | After PR-1/2 (`nx716ncp`, 5 Oct) | Change |
|---|---|---|---|
| Model calls | 5 | 2 | −60% |
| Input tokens | 473,999 | 95,330 | −79.9% |
| Cost | $0.6675 | $0.3052 | −54.3% |
| Model time | 62.9 s | 10.4 s | −83.5% |
| Analysis stage | 76.6 s | 24.2 s | −68.4% |
| Verdict / findings | inconclusive / none | inconclusive / none | unchanged |

The following PRs are measured after they deploy:
- PR-3: critic and arbitration see only cited evidence (#108).
- PR-4: a compact validation view, with memory out of the prompt (#109).
- PR-5: changed files whole or as hunk windows, plus import neighbours, instead of alphabetical filler (#114).
- PR-7: independent calls in parallel (#115).
- PR-0b: cached-token accounting (#116).
- PR-6: escalation to a genuinely different model (#113).

PR-9 (retiring the arbitration model call) waits for 30 production reviews of data, as planned.

**Release pipeline**
- `release.yml` deploys broker → Convex → web on every push to `main`, using a production deploy key created for it.
- First green release job: run 37364150555 (`23e730a`).
- Its `confirm` job never got a runner during GitHub's Actions incident (5 Oct, 19:12Z onward). The same checks were run by hand: the wiring matched and broker health reported `23e730a`.

**Security invariants kept**
- No secret-shaped literal anywhere in the tree; no long-lived cloud keys.
- CI holds no BuildIT login.
- The injection scan still covers the full context, and narrowed views only show less.
- Budget reservations still fail closed. Cached tokens are recorded but charged at the full rate.

**Open risks**
- Vercel Hobby sandbox CPU quota: 5 h a month on the platform; tanmayiift's workspace was raised to 9,000 s.
- One fingerprint key with no per-tenant versioning (`known-defects.md`).
- Email notifications are off.
- `completedAt` is a logical workflow timestamp, so ordering by it can mislead.
- Settling cost at cached prices is deliberately not done.

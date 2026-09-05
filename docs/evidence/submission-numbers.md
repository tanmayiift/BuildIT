# BuildIT — the week, in numbers

Every figure here was read from the production database or from git on 5 September 2026. Nothing is
estimated or rounded up. Where there is no number, that is stated instead of filled in.

**Track: AI Agent as a Service.**

---

## The three things

| | |
| --- | --- |
| **Live product** | https://buildit-agentic-review.vercel.app |
| **Public repo** | https://github.com/tanmayiift/BuildIT |
| **Core action, no account** | https://buildit-agentic-review.vercel.app/sandbox |
| **Live numbers, no account** | https://buildit-agentic-review.vercel.app/proof |
| **Operator dashboard, no login** | https://peacefulbumblebee2324.grafana.net/public-dashboards/070f5673609744cfaaacb0001989e35c |

The core action needs no sign-in: paste code, it is scanned server-side, nothing is stored. It is
the first button on the home page. The `/proof` page reads live from the database by a public query
that returns counts and nothing else — no repository, organization, person or finding is
identifiable from it.

---

## Production numbers

Open `/proof` to reproduce any of these live.

| | |
| --- | ---: |
| Pull requests reviewed | **147** |
| Distinct repositories | **9** |
| Findings raised | **153** |
| Decisive verdicts | **80** |
| Platform failures | **48** |
| Model spend | **$21.15** |
| Model tokens | **12,114,047** |

### Verdict mix

| Verdict | Count |
| --- | ---: |
| `changes_requested` | 53 |
| `platform_failed` | 48 |
| `checks_passed` | 27 |
| `inconclusive` | 11 |
| `delivered` | 4 |
| `budget_exhausted` | 2 |
| `blocked` | 1 |

**48 platform failures of 147 is nearly a third of every review ever run, and it is on the public
page.** Almost all of them are two defects and one billing failure, all now fixed:

1. A base/head selection mismatch that killed every review on any repository above 400 files whose
   pull request did not touch its manifests. No fixture repository was large enough to trigger it.
2. A single-use model grant minted once and re-sent on every provider retry, so any rate limit
   became a platform failure. The retry path was tested and had never once worked in production.
3. A declined card. Vercel's Sandbox reported "Hobby plan usage limit exceeded" for a team its own
   API reported as paid Pro, and every review died on it until the invoice cleared.

**The count has not moved since.** Every review run after those fixes landed reached a verdict; the
48 is entirely historical, and it stays on the page because a failure rate you delete once you have
fixed it was never evidence in the first place.

---

## Real output on real surfaces

Four public repositories, reviewed on real pull requests, verdicts posted as GitHub check runs that
anyone can open without an account.

| Pull request | Repository | Files | Verdict |
| --- | --- | ---: | --- |
| [buildit-demo-got#1](https://github.com/tanmayiift/buildit-demo-got/pull/1) | `sindresorhus/got` | 130 | Ready for human review |
| [buildit-demo-date-fns#1](https://github.com/tanmayiift/buildit-demo-date-fns/pull/1) | `date-fns` | 1,912 | Ready for human review |
| [buildit-demo-express#7](https://github.com/tanmayiift/buildit-demo-express/pull/7) | `expressjs/express` | 142 | Ready for human review |
| [buildit-demo-zod#1](https://github.com/tanmayiift/buildit-demo-zod/pull/1) | `colinhacks/zod` | 1,146 | Ready for human review |

`date-fns` is the scale evidence: 1,912 files, and the repository's own 3,248 tests executed in an
isolated sandbox on both the base and the head commit before any verdict was written.

`zod` is the attribution evidence. Three of its required checks — `test`, `lint`, `gitleaks` — have
been failing in that repository since before the pull request existed. BuildIT ran them on both
commits, reported *"already failing on `1a295bdeca5b` before this pull request. Not attributed to
this change"*, and let the verdict stand at green.

### What it found, and how reliably

Each of these pull requests carries a deliberately planted defect. Measured across ten runs of
`got#1` at the same commit:

| | |
| --- | ---: |
| Findings-stage context, every run | 45,823 – 48,235 input tokens |
| Findings-stage output | 279 – 804 tokens |
| Runs that reported the planted defect | some, not all |

On the runs where it landed, it landed by reasoning rather than pattern-matching:

> **Retry budget never accumulates across attempts when timings.start is per-attempt** —
> `source/core/calculate-retry-delay.ts:39-43`. *"that value is inspectably tied to a single
> attempt, not a persisted first-attempt deadline, so the check can reset on each retry instead of
> accumulating total wall-clock time."*

It also raised, on those runs, a second blocking finding: the added test cannot distinguish a
correct implementation from a broken one, because `attempts >= 1` passes either way. Both are true.

**The last two runs found neither, and the pull request currently shows no findings.** The context
handed to the model was the same size on every run; the model's output was not. The `express` pull
request's planted defect — a view cache keyed on `name` alone while the change adds a per-render
`root` option, so two roots collide — has not been reported on any run.

This is the honest state of it: **BuildIT's checks, attribution and evidence are deterministic, and
its findings are not.** The verdict machinery reruns identically — same checks, same base/head
comparison, same pre-existing attribution. The model stage samples. Nothing here reruns a review
until it looks good, and no screenshot of a luckier run is presented as the steady state.

The number this page does not print is precision and recall, for the same reason: they need blind
human adjudication over a labelled set, not a count of what the model happened to say.

---

## Observability

The Grafana dashboard above is public and needs no login. It renders live OpenTelemetry from both
Vercel and Convex: operation rate, service failure ratio, p95 latency broken out per operation
(`model.invoke`, `sandbox.execute`, `webhook.process`, `artifact.get/put/delete`), review stages and
outcomes, and provider and runner failures.

Fourteen alert rules with severities, actions and runbook links live in `observability/alerts.yml`,
and `pnpm alerts:check` runs in CI to prove every rule names a runbook section that exists.

**No duration statistic is published.** The reviews table re-stamps `createdAt` and `startedAt` per
execution generation, so no timestamp pair on it answers "how long did this take" — measured
per status, verdict-reaching reviews showed a 0.1s median against 87s for platform failures. Three
framings were tried and each produced a plausible, wrong number. It is absent rather than
approximated.

---

## Engineering

| | |
| --- | ---: |
| Commits | **525** (all since 29 August) |
| Tracked files | 612 |
| Tests | **1,455** |
| Release gates | `verify`, `security:release`, `reliability:release`, `eval`, `alerts:check`, `deploy:web:check` |
| Deployed surfaces | Convex, web, broker — sequenced, broker freshness asserted against the served commit |

---

## What there is no number for

**No web analytics.** No package was ever installed, so there is no visitor, signup or impression
data. Adding a counter on submission morning would produce a number with no history behind it. The
`/proof` page is the honest substitute: real product usage, not traffic.

**No revenue.** BuildIT is free and bring-your-own-key by design. Nobody has been charged.

This week produced a working product with real output on real repositories, and no audience numbers.

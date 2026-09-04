# BuildIT — numbers for the week

Every figure below was read from the production Convex deployment or from git on 4 September 2026.
Nothing is estimated, rounded up, or projected. Where there is no number, that is stated rather than
filled in.

**Track: AI Agent as a Service.**

---

## The three things

| | |
| --- | --- |
| **Live product** | https://buildit-agentic-review.vercel.app |
| **Public repo** | https://github.com/tanmayiift/BuildIT |
| **Core action, no account** | https://buildit-agentic-review.vercel.app/sandbox |

The core action needs no sign-in: paste code, it is scanned on the server, nothing is stored. It is
the first button on the home page. Verified logged out at 375×812 on the deployed site.

---

## Product numbers, from the production database

| Table | Rows |
| --- | ---: |
| `reviews` | 134 |
| `findings` | 75 |
| `repositories` | 8 |
| `organizations` | 2 |
| `githubInstallations` | 2 |
| `usageLedger` | 640 |
| `auditEvents` | 25 |
| `webhookDeliveries` | 2,922 |

### What those 134 reviews decided

| Verdict | Count |
| --- | ---: |
| `changes_requested` | 49 |
| `platform_failed` | 42 |
| `checks_passed` | 25 |
| `inconclusive` | 11 |
| `delivered` | 4 |
| `budget_exhausted` | 2 |
| `blocked` | 1 |

**74 of 134 reviews reached a decisive verdict.** 42 ended in a platform failure, and that number is
not hidden: it is on the public features page, regenerated from this same data today. A large part
of those 42 were the two defects found and fixed this week — a base/head selection mismatch that
killed reviews on any repository above 400 files, and a model grant that made every provider retry
fail. The most recent failures are a Vercel Sandbox plan limit, which is a bill, not a bug.

### Cost

**$17.89** of model spend, all of it on the developer's own key, across the whole month. BuildIT
adds nothing on top — every review's cost is itemised per review in `usageLedger`.

Typical review cost observed on public repositories: **$0.26 – $0.41**.

---

## Real output on real surfaces

Two public open-source repositories, reviewed on real pull requests:

| Repository | Size | Pull request |
| --- | ---: | --- |
| [buildit-demo-got](https://github.com/tanmayiift/buildit-demo-got) — snapshot of `sindresorhus/got` | 130 files | [#1](https://github.com/tanmayiift/buildit-demo-got/pull/1) |
| [buildit-demo-date-fns](https://github.com/tanmayiift/buildit-demo-date-fns) — snapshot of `date-fns/date-fns` | 1,912 files | [#1](https://github.com/tanmayiift/buildit-demo-date-fns/pull/1) |

On date-fns, all 5 required checks passed with complete evidence, including running the repository's
own 3,248 tests inside an isolated sandbox on both the base and head commits.

### What reviewing real code found — in BuildIT itself

Pointing the product at real open-source repositories, rather than at fixtures, surfaced six defects
in BuildIT's own pipeline this week. All six are fixed and merged:

1. **Reviews died on most real repositories.** Base and head disagreed about the package manager
   because head fetched `package.json` and the lockfile while base did not. Every repository above
   400 files whose pull request did not touch its manifests failed before a check ran. No fixture
   repository was large enough to trigger it.
2. **The provider retry path could never succeed.** A single-use model grant was minted once and
   re-sent on every retry, so any rate limit became a platform failure. The retry machinery was
   tested and had never once worked in production.
3. **Pull requests were blamed for failures the base commit already had.** The base/head comparison
   was computed and thrown away by the report.
4. **A repository configuration could never be approved.** The only trust route had no UI.
5. **A scanner rule reported the safe case and missed the dangerous one.** `password !== undefined`
   was flagged; a secret compared against a key-shaped literal could not match at all.
6. **The CI vulnerability gate depended on a dead npm endpoint**, failing ~1 run in 5 after nine
   minutes of retries. Replaced with the offline OSV database. Now 11 seconds.

---

## Engineering

| | |
| --- | ---: |
| Commits | 504 |
| Commits this week | 504 (the repository began 29 August) |
| Tests | 1,397 |
| Release gates | `verify`, `security:release`, `reliability:release`, `eval`, `deploy:web:check` |
| Deployed surfaces | Convex, web, broker — sequenced, with broker freshness asserted against the served commit |

---

## What there is no number for

**Web analytics are not instrumented.** There is no visitor count, no signup funnel, and no
impression data, because no analytics package was ever installed. Adding one in the final hour would
produce a counter with no history behind it, which would be a worse answer than this one.

**No revenue.** BuildIT is free and bring-your-own-key by design; nobody has been charged, so there
is nothing to report.

The honest position is that this week produced a working product with real output on real
repositories, and no audience numbers.

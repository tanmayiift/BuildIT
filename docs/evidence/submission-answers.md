# Submission — BuildIT

**Track: AI Agent as a Service.**

---

## 01 · Live product

**https://buildit-agentic-review.vercel.app**

Opens logged out, on a phone, on anyone's laptop. The first button on the page is **"Scan code now
— no account"**. Paste code, and BuildIT's own rules run on the server and cite the file and line.
Nothing is stored, no model is called, no repository is read — and the page says so, listing what it
did *not* run alongside what it did.

That is deliberately a fraction of a review. The whole product is on GitHub: BuildIT reviews a pull
request against pinned commits, runs your real tests and scanners in an isolated sandbox on both the
base and head commit, and posts findings on the exact lines they are about. It never merges.

Four live examples, all public, all real pull requests, all openable without an account:

- **https://github.com/tanmayiift/buildit-demo-got/pull/1** — `sindresorhus/got`
- **https://github.com/tanmayiift/buildit-demo-date-fns/pull/1** — 1,912-file repository, 3,248 of
  its own tests executed in a sandbox on both commits
- **https://github.com/tanmayiift/buildit-demo-express/pull/7** — `expressjs/express`
- **https://github.com/tanmayiift/buildit-demo-zod/pull/1** — three checks that were already broken
  in that repository, reported as *"already failing on `1a295bdeca5b` before this pull request"*
  instead of being blamed on the author

## 02 · Public repo

**https://github.com/tanmayiift/BuildIT**

Public, loads in a private window. It is the repo Vercel deploys from — web, the execution broker,
and the Convex backend all ship from it with one command.

## 03 · Numbers

Two links, both open with no account, both live rather than screenshots:

- **https://buildit-agentic-review.vercel.app/proof** — read straight from the production database
  by a public query that returns counts and nothing else
- **https://peacefulbumblebee2324.grafana.net/public-dashboards/070f5673609744cfaaacb0001989e35c** —
  OpenTelemetry from Vercel and Convex: operation rate, failure ratio, p95 latency per operation

| | |
| --- | ---: |
| Pull requests reviewed | 148 |
| Distinct repositories | 9 |
| Findings raised | 153 |
| Decisive verdicts | 85 |
| **Platform failures** | **48** |
| Model spend | $21.52 across 12,391,261 tokens |
| Commits | 526, all since 29 August |
| Tests | 1,455 |

**48 of 148 reviews failed on BuildIT's own account** — a third of everything it has ever run. That
number is on the public page next to the good ones. Almost all of it was three things, now fixed: a
base/head selection mismatch that killed reviews on any repository above 400 files, a single-use
model grant re-sent on every retry so the retry path could never once succeed, and a declined card
that left Vercel reporting Hobby limits for a paid Pro team. The count has not moved since those
landed.

**One thing it does not do reliably.** Each demo pull request carries a planted defect. BuildIT's
checks, attribution and evidence rerun identically every time; its *findings* do not — the same
commit, with the same 46k-token context, reported the planted bug on some runs and not on the last
two. That is written down in `docs/evidence/submission-numbers.md` rather than smoothed over, and no
review here was rerun until it looked better.

**No web analytics, no revenue.** Nothing was installed and nobody was charged. A visitor counter
added on submission morning would be a number with no history behind it.

---

## Say it out loud

> I spent the week building BuildIT — a code reviewer that has to show its work. Every finding names
> the file, the line, and the commit it was checked against, and if it can't prove something it says
> so instead of guessing.
>
> The part I didn't expect: pointing it at real open-source code, rather than my own test fixtures,
> found eight bugs. In BuildIT.
>
> Reviews were dying on any repo over 400 files. The retry path had been tested and had never once
> worked in production. Pull requests were being blamed for checks that were already broken before
> anyone touched them.
>
> All eight are fixed. It now reads real pull requests on four public repositories, runs one repo's
> own 3,248 tests in a sandbox on both commits, and tells you what changed.
>
> 148 reviews. 48 of them failed on my account, and that number is on the site next to the good
> ones, because a number you can only see when it flatters you isn't evidence.
>
> The thing I'd still fix first: the checks are deterministic, the findings aren't. Same commit,
> same context, and it caught the planted bug on some runs and not others. That's measured and
> written down, not rounded off.
>
> Paste code, no signup: buildit-agentic-review.vercel.app

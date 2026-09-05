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

Two live examples, both public, both real pull requests:

- **https://github.com/tanmayiift/buildit-demo-got/pull/1** — verdict *Changes need review*
- **https://github.com/tanmayiift/buildit-demo-date-fns/pull/1** — verdict *Ready for human review*,
  1,912-file repository, 3,248 of its own tests executed on both commits

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
| Pull requests reviewed | 141 |
| Distinct repositories | 7 |
| Findings raised | 150 |
| Decisive verdicts | 79 |
| **Platform failures** | **48** |
| Model spend | $18.26 across 10,065,863 tokens |
| Commits | 520, all since 29 August |
| Tests | 1,450 |

**48 of 141 reviews failed on BuildIT's own account** — a third of everything it has ever run. That
number is on the public page next to the good ones. Almost all of it was three things, now fixed: a
base/head selection mismatch that killed reviews on any repository above 400 files, a single-use
model grant re-sent on every retry so the retry path could never once succeed, and a declined card
that left Vercel reporting Hobby limits for a paid Pro team.

**No web analytics, no revenue.** Nothing was installed and nobody was charged. A visitor counter
added on submission morning would be a number with no history behind it.

---

## Say it out loud

> I spent the week building BuildIT — a code reviewer that has to show its work. Every finding names
> the file, the line, and the commit it was checked against, and if it can't prove something it says
> so instead of guessing.
>
> The part I didn't expect: pointing it at real open-source code, rather than my own test fixtures,
> found six bugs. In BuildIT.
>
> Reviews were dying on any repo over 400 files. The retry path had been tested and had never once
> worked in production. Pull requests were being blamed for checks that were already broken before
> anyone touched them.
>
> All six are fixed. It now reads a real pull request on a 1,900-file repository, runs that repo's
> own 3,248 tests in a sandbox on both commits, and tells you what changed.
>
> 141 reviews. 48 of them failed on my account, and that number is on the site next to the good
> ones, because a number you can only see when it flatters you isn't evidence.
>
> Paste code, no signup: buildit-agentic-review.vercel.app

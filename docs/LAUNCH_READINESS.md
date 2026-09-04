# Is BuildIT ready for public launch?

**Not yet. It is ready for design partners you can talk to.** The distance between those two is
smaller than it was this morning, and this document is the whole of it — what was fixed, what is
still open, and which open items are decisions rather than code.

Written 2026-09-04, against 109 reviews on 5 repositories.

---

## The question that found the real gaps

"Does it work?" was the wrong test, because it works — for me. The useful question turned out to be
narrower:

> **What can a stranger who signs up alone actually reach?**

Two shipped features failed that test. Both are now fixed.

### A repository configuration could never be approved

A review that reads a `.buildit.yml` it cannot trust says so in its receipt and names the version
hash. Nothing recorded that hash, and no screen offered to approve it.

This was worse than a missing button. Admin approval is not one of two trust routes — it is the
only one, because the protected-ref route needs `administration: read`, a permission the App does
not have and cannot get without every installation re-accepting. So `.buildit.yml` — review
profile, path filters, per-path instructions, the whole configuration surface — was unusable by
anyone who could not reach me directly.

Fixed: the review records the version it refused, and the Repositories page offers an admin that
exact version to approve. Four tests hold the line that recording is not trusting — an edited file
becomes a new version, an old approval never covers new text, and configuration from a pull request
head is still refused whether approved or not.

### The Policies page showed controls that did nothing

Five rows, each with a disabled button reading *"Configure after organization setup"* — a control
that was never coming, on settings that are mostly not settings. A stranger clicking through the
product found dead UI on the page named "Trusted configuration".

Fixed: it now states the boundaries that hold for every review, and points at the Repositories page
for the things a team actually chooses.

### A stale limit was turning away repositories that now work

The features page said BuildIT refuses repositories above roughly 1,300 files. That was true before
the selective-fetch fix and false after it: BuildIT now fetches the changed files, dependency
manifests and cited documents rather than the whole repository, so what it asks GitHub for scales
with the size of the *change*, not the codebase.

Corrected — and deliberately without a new number, because the new ceiling is unmeasured. The page
now says what is implemented and admits the top end has not been tested.

---

## What is still open

### 1. Platform reliability is a day old, not a record

28 of 109 reviews ended in a platform failure. The last 23 reviews are clean, because the causes
were found and fixed — the whole-repo fetch, the stale broker deployment, the config resolution
that computed problems and dropped them.

23 consecutive reviews is one good day. It is not evidence that a stranger's first review will
work, and the honest framing for launch is that the failure rate is *believed* fixed and *not yet*
demonstrated over time.

**This one only closes by waiting.**

### 2. Nobody can contact anyone

There is no support route in the product — no contact page, no address, no channel. A customer
whose review fails for a reason the receipt does not explain has nowhere to go.

**This is a decision, not code.** It needs an address or a channel to point at.

### 3. Alerts page one person

Grafana alerts on real user-visible failures, which is correct. They reach me. For a public launch
that is a single point of failure in the operational sense: nobody else is woken, and there is no
rotation.

**Also a decision** — whether a solo launch with best-effort response is acceptable, and if so,
whether the product should say so plainly rather than implying an SLA it does not have.

### 4. Nothing has been reviewed at real scale

The largest repository BuildIT has reviewed is small. The selective fetch means size *should* no
longer matter, and there is a test asserting it fetches one changed file rather than 2,746 blobs —
but that is a unit test, not a production run against a large codebase.

**Closes with one real review on a large repository**, which is worth doing before launch rather
than after.

---

## What is genuinely ready

Everything a design partner touches, end to end, and none of it depends on me:

- Sign in, install the App, bring a provider key, get a review. Self-serve, with a new workspace
  defaulting to 24-hour retention, a $50 monthly ceiling and 3 concurrent reviews.
- Automatic review on open and push, opt-in per repository, with `@buildit pause` per pull request.
- Repository configuration, now approvable.
- Inline findings anchored to the pinned commit, with the evidence gate deciding what may appear.
- Real checks run base-against-head, so a failure that was already there is not blamed on the
  change.
- Learning that only ever demotes, never quietens a blocking or scanner finding.
- History with real cost, duration, verdict and feedback per review.
- 1,309 tests, plus the security and reliability release gates.

## The recommendation

Launch to design partners now — people you can message when something breaks, who are getting
value from a tool that is honest about refusing. Hold the public launch until items 1 and 4 above
have evidence rather than reasoning behind them, and until item 2 has an answer.

The product's central promise is that it refuses rather than guesses. Launching it publicly while
its own reliability rests on one good day would be the same mistake in a different register.

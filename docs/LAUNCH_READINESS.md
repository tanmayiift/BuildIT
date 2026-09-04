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

Two shipped features failed that test. Chasing the answer turned up a third problem that was
breaking reviews outright. All three are now fixed.

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

### Reviews were dying on most real repositories, and the fixtures were too small to show it

Found by triggering a review on the pull request that fixes the two gaps above. It failed with
`package_manager_changed`, which reached the author as *"a required platform step failed"*.

Base and head are fetched with different selection rules on purpose — base file contents never
reach the model, so base is deliberately narrow. But `detectPackageManager` reads **both** path sets
and refuses the review when they disagree. Head kept `package.json` and the lockfile; base kept
neither. So on every repository above the 400-file selection threshold whose pull request happened
not to touch its manifests, head detected a package manager, base detected none, and the review died
**before a single check ran**.

That is most pull requests on most repositories.

It looked random because the trigger was "the diff did not include `package.json`" — not something
anyone thinks of as a property of a repository. And it never fired where the evidence was being
collected: **every fixture repository is under the 400-file threshold**, so the selection rules
never diverged there.

This is the most important thing in this document, and not only because of the fix. The 23
consecutive clean reviews cited below were run on repositories too small to exercise the code path
that breaks on real ones. The track record was measuring the wrong thing.

Fixed: both revisions now select the execution plan inputs through one shared predicate, and a path
filter cannot suppress them. Reverting the fix reproduces the production error in the new test.

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

23 consecutive reviews is one good day — and, as the section above establishes, one good day on
repositories small enough to miss the defect that breaks large ones. The honest framing is weaker
than it looked this morning: the failure rate is *believed* fixed, *not yet* demonstrated over time,
and the evidence gathered so far came from repositories that could not have exposed the worst bug in
the pipeline.

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

**Closes with one real review on a large repository**, which is now clearly a prerequisite rather
than a nicety: the fixture repositories are structurally incapable of exercising the selection
threshold, and that is exactly where the last defect lived.

That review is prepared and one click away. `tanmayiift/buildit-demo-date-fns` is a snapshot of
date-fns at **1,912 files** — comfortably above the threshold, and above the file count the old
stale limit claimed to refuse — with a pull request open against it. It needs only to be added to
the GitHub App installation.

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
- 1,316 tests, plus the security and reliability release gates.

## The recommendation

Launch to design partners now — people you can message when something breaks, who are getting
value from a tool that is honest about refusing. Hold the public launch until items 1 and 4 above
have evidence rather than reasoning behind them, and until item 2 has an answer.

The product's central promise is that it refuses rather than guesses. Launching it publicly while
its own reliability rests on one good day would be the same mistake in a different register.

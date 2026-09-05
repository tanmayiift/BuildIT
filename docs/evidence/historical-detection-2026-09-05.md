# Historical detection run — 5 September 2026

The first committed evaluation result in this repository. Everything before it was either a
threshold with no run behind it or a suite that graded the grader.

**Set:** `historical-v1` — ten real pull requests, four languages, nine planted defects and one
correct change. Defined in `packages/evaluations/src/historicalCases.ts`, every case openable on
GitHub.

**Prompt version:** `findings-v1`. **Provider:** OpenAI. Read from the check runs and review
comments BuildIT actually posted, not from a local re-run.

---

## Result: 3 of 9 defects found, no clean change blocked

| Case | Language | Family | BuildIT said | Outcome |
| --- | --- | --- | --- | --- |
| `hist-got-retry-budget` | TypeScript | regression | 2 findings, cited `calculate-retry-delay.ts:39-43` | **detected** |
| `hist-body-parser-async-verify-bypass` | JavaScript | error_handling | *"Async `verify` rejection can call `next()` after a successful parse"* | **detected** |
| `hist-gson-millisecond-carry` | Java | logic_edge_case | *"Rounding fractional seconds can produce an invalid 1000-millisecond field at second boundaries"* | **detected** |
| `hist-axios-evicted-session-leak` | JavaScript | performance_resource | 1 finding — but a **different, real** bug: the new cap rejects an explicit `0` because a falsy value is overwritten by the default | **missed** (see below) |
| `hist-p-queue-weighted-concurrency` | TypeScript | concurrency | Ready for human review, 0 findings | **missed** |
| `hist-requests-env-ca-override` | Python | configuration | Ready for human review, 0 findings | **missed** |
| `hist-itsdangerous-salt-ignored` | Python | authorization_tenant | Ready for human review, 0 findings | **missed** |
| `hist-express-view-cache-key` | JavaScript | logic_edge_case | Ready for human review, 0 findings | **missed** |
| `hist-zod-int16-off-by-one` | TypeScript | logic_edge_case | Ready for human review, 0 findings | **missed** |
| `hist-date-fns-holidays-clean` | TypeScript | — *(clean control)* | Ready for human review, 0 findings | **clean_pass** |

**Detection rate: 3 of 9 (33%). False blocking: 0 of 1.**

That is not a good number and it is the real one. It is here because the alternative — reporting
the suite that grades the grader as though it were a detection result — is the failure mode this
whole set exists to correct.

## The three it found, it found by reasoning

Not by pattern-matching a filename. On `got` it identified that `error.timings.start` belongs to the
attempt that just failed rather than the first, and separately that the added test asserts
`attempts >= 1`, which a correct implementation and a broken one both satisfy. On `body-parser` it
saw that a rejection reaching `.catch()` without a `return` lets control fall through to a
successful parse. On `gson` it read past the diff hunk to a non-lenient calendar.

## The one that is neither

`axios` **missed the planted defect** — evicted HTTP/2 sessions are never closed — and instead
reported a genuine unplanted bug in the same added code: the cap is applied with a falsy-coalescing
default, so an explicit `0` is silently replaced. That is a real finding on a real line, and it is
scored as a miss because the label asks for the planted defect. Both facts belong in the record.

## What the six misses have in common

Five of the six are a small wrong constant or a missing guard inside a large diff of otherwise
correct additions, and in every one the added test exercises the valid boundary and never the
invalid one:

- **zod** writes `int16`'s maximum as `32768` in two places and tests only that `32767` parses.
- **express** keys a view cache on template name while adding a per-render root, and no test renders
  one name from two roots.
- **p-queue** asks whether there is *any* room rather than *enough* room, and the added tests order
  the heavy task first.
- **requests** changes `verify is True or verify is None` to `verify is not False`, and all thirteen
  existing tests pass `verify=True`.
- **itsdangerous** threads a new salt into three key-derivation branches but not the default one,
  and the added test opts into a branch that does honour it.

None is subtle to a reader looking for it. All survived a review that read the file. If there is one
thing to fix in the prompt chain, it is that the findings stage does not systematically ask what the
added tests fail to cover — which is exactly what it *did* ask on `got`, the case it got right.

## A platform bug this run surfaced

The first attempt lost `requests` and `gson` to `scanner_unavailable`. osv-scanner cannot resolve a
Maven `pom.xml` or a Python `pyproject.toml` offline, the runner threw, and the whole review died as
a platform failure — sandbox working, the repository's own tests run on both commits, code read.
Fixed: an unusable dependency scan is now reported as `Advisory / Not Configured`, which never
claims a scan happened. Both repositories then produced real verdicts, and `gson` produced one of
the three detections. Two of the six new repositories would otherwise have been recorded as misses
for a reason that had nothing to do with judgment.

## Caveats a reader should hold against this

**Detection is not deterministic.** The same commit reviewed twice does not always produce the same
findings — `docs/evaluations/detection-suite.md` records why the live suite is deliberately not a CI
gate. Nine cases at one run each is an observation, not a rate; the 95% interval on 3/9 is roughly
12% to 65%.

**No version comparison yet.** `packages/evaluations/src/versionComparison.ts` implements it and is
tested, but it needs two runs at different prompt versions and this is the first. The next prompt
change produces the second, and that comparison is the artefact that answers whether judgment
improved.

**These are planted defects.** They were written to be findable by a careful reviewer. They say
nothing about defects nobody thought to plant — and the `axios` result is a small reminder that the
model sometimes finds those instead.

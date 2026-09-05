# findings-v1 → findings-v2: asking what the added test does not cover

The first version comparison this repository has ever been able to make, and the reason the
comparison machinery exists.

## The hypothesis

Five of the six misses in the `findings-v1` run shared one shape: a wrong constant or a missing
guard inside a large diff of otherwise correct additions, where the change also added a test that
exercised the valid side of a boundary and never the invalid side.

- **zod** wrote `int16`'s maximum as `32768` and tested only that `32767` parses.
- **p-queue** asked whether there was *any* room rather than *enough*, and ordered the heavy task
  first in both added tests.
- **requests** loosened a tri-state guard, and all thirteen existing tests pass `verify=True`.
- **itsdangerous** threaded a new salt into three key-derivation branches but not the default one,
  and the added test opted into a branch that does honour it.
- **express** keyed a view cache on template name while adding a per-render root, and no test
  rendered one name from two roots.

The one case `findings-v1` got right for this reason — `got` — is the one where the model reasoned
about the test unprompted: it noticed that `attempts >= 1` passes whether or not the retry budget
works. The change asks for that reasoning every time instead of when the model happens to think of
it, with a guard requiring a named failing input and a cited line, because "coverage could be
better" is true of every pull request ever written and a reviewer that says it on all of them is a
reviewer people stop reading.

## The result

```
findings-v1 → findings-v2  (historical-v1, 10 cases compared)

    hist-axios-evicted-session-leak            missed
    hist-body-parser-async-verify-bypass       detected
  + hist-date-fns-holiday-whole-week           missed → detected
  + hist-express-view-cache-key                missed → detected
  - hist-got-retry-budget                      detected → missed   (missed again on a repeat run)
    hist-gson-millisecond-carry                detected
  + hist-itsdangerous-salt-ignored             missed → detected
    hist-p-queue-weighted-concurrency          missed
    hist-requests-env-ca-override              missed
    hist-zod-int16-off-by-one                  missed

  improved  3
  regressed 1
  unchanged 6

no regression — 3 improved, 1 regressed
```

**Detection: 3 of 10 → 5 of 10.** Reproduce with:

```bash
pnpm eval:compare docs/evidence/historical-v1-findings-v1.json docs/evidence/historical-v1-findings-v2.json
```

All three improvements are cases the hypothesis named. `express` was cited precisely
(`lib/application.js:563-575`, *"View cache ignores per-render root and can render the wrong
template after a cached lookup"*), and `itsdangerous` named the untouched default branch. That is
the mechanism working, not a general uplift.

## The regression, and why it might not be one

`got` went from detected to missed. Two readings, and this run cannot separate them:

1. The prompt change genuinely hurt it. Plausible — `got`'s defect is *also* about a test that
   proves nothing, so pointing attention at test coverage may have crowded out the primary finding
   about `timings.start`.
2. Noise. `docs/evaluations/detection-suite.md` records that the same commit reviewed twice does not
   always produce the same findings, which is why the live suite is deliberately not a CI gate.
   Across ten earlier runs of `got` at one commit, the planted defect was found on some and not
   others.

So `got` was re-run a second time on `findings-v2`, unchanged commit, same provider. **It missed
again — zero findings.** One detection on v1, two consecutive misses on v2.

That is not proof; three runs cannot be. But it shifts the balance meaningfully toward reading 1 as
the explanation rather than 2, and the mechanism is plausible: `got`'s planted defect *is* a
test-coverage defect, so a prompt that directs attention to what the tests fail to cover may be
crowding out the primary finding about `timings.start` — trading the cause for the symptom.

That would make this change a genuine trade rather than a free win: three cases where naming the
test gap led to the defect, one where it appears to have replaced it. Worth knowing before the next
prompt change, and worth re-testing with more runs per case than a submission window allows.

## What this run also found: a wrong label

`hist-date-fns-holiday-whole-week` was labelled a **clean control**. It is not clean.
`differenceInBusinessDays` computes whole weeks in bulk — `result = weeks * 5`, then advances
`movingDate` by `weeks * 7` — and the holiday check was added only to the remainder loop that runs
afterwards. A holiday falling inside a complete week is silently ignored. Both added tests span less
than a week, so neither crosses the fast path.

`findings-v2` found it and was right. The label came from reading the diff and not the function the
diff sits inside — the same mistake the case itself is about.

**So the set lost its clean control, and false blocking is unmeasured rather than zero.** That is the
outcome this scoring treats as worse than a miss.

A replacement is now in the set — `hist-express-utils-unit-coverage`
([express#9](https://github.com/tanmayiift/buildit-demo-express/pull/9)): 203 added lines, all in
`test/utils.js`, nothing under `lib/`. That makes "no defect" structural rather than argued, since
there is no runtime behaviour to get wrong, and the assertions were mutation-tested against seven
deliberate breakages of `lib/utils.js` — every one caught — so they are not vacuous either. Its known
limitation is that it carries no production diff, so it cannot test whether BuildIT over-flags a
real code change.

**BuildIT has not yet reviewed it.** Four attempts returned `model provider is busy` — the OpenAI
key was rate limited by the ~18 reviews this exercise ran in one afternoon. So the false-blocking
number below is still missing, and the honest position is that it is unmeasured, not zero. The
review is a single comment away once the key resets.

### A partial substitute, until it lands

Counting findings is not the same as having a clean case, but it bounds the worry. Across all ten
pull requests, `findings-v2` produced **six findings in total** — one each on `express`, `date-fns`,
`body-parser`, `itsdangerous`, `gson` and `axios`, and none at all on the other four:

| | findings-v1 | findings-v2 |
| --- | --- | --- |
| Findings raised across the ten | at least 5 | **6** |
| Of those, identifying the planted defect | 3 | **5** |
| Of those, a real bug other than the planted one | 1 (`axios`) | **1** (`axios`) |
| Findings that were neither | 1 or more | **0** |
| Pull requests receiving more than one finding | 1 (`got`, 2) | **0** |

So two more defects were found for one extra finding raised in total, and **every finding v2 made
was either the planted defect or a genuine unplanted bug**. Nothing it said was wrong. A prompt
change aimed at test coverage could easily have produced a "your tests are incomplete" paragraph on
all ten pull requests; the guard requiring a named failing input and a cited line appears to be
doing its job.

This is weaker evidence than a clean control — a case with no defect at all is the only thing that
proves a reviewer can stay quiet — but it is not nothing, and it points the same way.

## Honest summary

A targeted prompt change moved three of the five cases it was aimed at, cost one case that may be
noise, and raised one extra finding in total to do it. It is an improvement on the evidence
available, and a smaller claim than "detection went from 30% to 50%" — that number rests on one run
per case of a set whose own labels this exercise proved capable of being wrong.

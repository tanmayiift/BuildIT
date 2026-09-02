# Detection suite

Answers the question nothing else here asked: **given this diff, does BuildIT find this defect?**

The existing suites cover Autofix fixtures, frozen stage inputs and human labelling. None of them
asks whether a defect in a diff is found, which is why a false negative on a real pull request went
unnoticed on 2026-09-02 until someone read the file by hand. Three runs over identical code
produced the correct finding once, nothing once, and an unrelated coverage finding once.

## The corpus

`packages/evaluations/src/detectionCases.ts`. Every case is a defect BuildIT was actually asked to
review, in the shape it appeared in — including `det-round-half-cent`, the one it missed.

A case names the file a correct finding must cite and the vocabulary it must use, because a finding
on the right file that does not understand the defect is not a detection. `det-clean-tax` is a
control: correct code that must not be blocked. Without it, a reviewer that flags everything scores
perfectly.

## What runs where

| | Where | What it protects |
|---|---|---|
| Grader and corpus tests | `pnpm verify`, every CI run | A grader that scored a miss as a pass would be worse than no grader |
| Runner over the real chain | `pnpm verify`, every CI run | Validation and arbitration still drop hallucinated findings and keep real ones |
| Detection rate against a live model | `pnpm eval:detection`, on demand | Whether the reviewer actually finds these defects today |

The live suite is deliberately **not** a CI gate. Detection varies run to run — that is the finding
that created this suite — and a gate that flakes is a gate someone switches off. Run it before a
release and whenever a prompt, the chain, or the stage plan changes.

```sh
ANTHROPIC_API_KEY=… pnpm eval:detection
pnpm eval:detection --out docs/evidence/detection-2026-09-03.json
```

It writes case ids, counts and a rate. No repository content and no model output, so a report can
be committed.

## Reading a result

`detectionGate` fails below an 80% detection floor, and fails at any rate if a clean case was
blocked. Blocking correct code is not a matter of degree.

A single run is weak evidence. The rate over several runs is the signal, which is why the report is
written to a file rather than only printed.

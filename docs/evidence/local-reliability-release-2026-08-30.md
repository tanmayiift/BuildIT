# Local reliability release — 2026-08-30

`pnpm reliability:release` passed 132 tests across 15 files.

The suite covers provider retry/refusal/malformed output, typed model-stage handoffs, prompt-injection boundaries, stale commits, missing evidence, runner and environment failure, cancellation generation fences, duplicate effects, repeated patches, six-attempt/three-round/time/spend bounds, full final validation, cleanup behavior, and source-free reports.

A 10,000-iteration decision load kept stale reviews and missing required checks inconclusive, and preserved round, attempt, repeated-patch, and spend stops in under two seconds on the development machine. This measures deterministic decision overhead only. It is not production queue latency, model latency, sandbox latency, or completion rate.

Live p50/p95 queue, provider, scanner, sandbox, cleanup, token, and cost measurements remain dependent on the coordinated broker and Convex rollout.

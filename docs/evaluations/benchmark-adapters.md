# External benchmark adapters

BuildIT imports only pinned, license-reviewed snapshots. AACR-Bench review rows use its standard repository/base/head/reference-comment contract under Apache-2.0. SWE-bench Verified Autofix rows use its issue/base/patch/test-list contract under MIT.

Each adapter returns two separate objects: `task`, which may enter the model chain, and `gold`, which stays with the grader. This prevents the reference review or solution patch from leaking into the model prompt. Every import requires a dataset version and SHA-256 digest; invalid commits, repositories, clone URLs, labels, or provenance fail closed.

The checked-in adapter tests use synthetic recorded rows, not copied benchmark cases. A live score must name the exact external snapshot and may be reported only after the separate blind holdout and execution harness complete.
# Release populations and label governance

The immutable release population is declared in `packages/evaluations/src/releaseEvidence.ts`. It pins AACR-Bench positive and negative files at commit `68a569759289a83654a59d06db2a72910edf0a4a`, and SWE-bench Verified at dataset revision `78f471bf655a3137b2e8a75af1501690ec009ec3`, with independently calculated SHA-256 hashes and reviewed Apache-2.0/MIT licenses. Dataset contents are not copied into BuildIT.

Official benchmark labels prove benchmark performance, not BuildIT customer accuracy. A production accuracy claim additionally requires hidden, pre-model human labels. Critical cases require two independent reviewers; disagreements require a separate adjudicator. Synthetic labels, labels created after the model run, gold exposed to model input, missing cases, and uncalibrated model judges fail the release evidence gate.

SWE-bench Verified is Python-only and measures issue-to-patch execution. It cannot substitute for multilingual review-finding accuracy. AACR-Bench supplies ten-language review coverage and true negative examples. BuildIT reports the two results separately.

Run `pnpm eval:populations` to download the pinned artifacts into ignored `.local/benchmarks`, verify every checksum, and parse all 351 AACR rows plus all 500 SWE-bench Verified rows through their official-schema adapters. The command emits counts and provenance only; it never prints benchmark source, comments, patches, or test gold.

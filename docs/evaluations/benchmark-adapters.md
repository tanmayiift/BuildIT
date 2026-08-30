# External benchmark adapters

BuildIT imports only pinned, license-reviewed snapshots. AACR-Bench review rows use its standard repository/base/head/reference-comment contract under Apache-2.0. SWE-bench Verified Autofix rows use its issue/base/patch/test-list contract under MIT.

Each adapter returns two separate objects: `task`, which may enter the model chain, and `gold`, which stays with the grader. This prevents the reference review or solution patch from leaking into the model prompt. Every import requires a dataset version and SHA-256 digest; invalid commits, repositories, clone URLs, labels, or provenance fail closed.

The checked-in adapter tests use synthetic recorded rows, not copied benchmark cases. A live score must name the exact external snapshot and may be reported only after the separate blind holdout and execution harness complete.

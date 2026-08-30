# BuildIT orchestration decisions

Status: accepted on 2026-08-30.

These decisions apply to the production review path. They may be revisited only with measured evidence from BuildIT's frozen evaluation suites.

## Hermes Agent: do not embed

BuildIT will not install or embed Hermes Agent in its review runtime. Hermes is a broad personal-agent environment with persistent memory, terminal and browser tools, messaging gateways, scheduled tasks, and its own tool loop. Those capabilities duplicate BuildIT's most security-sensitive control plane while expanding the amount of code that could reach customer source, credentials, and execution.

Hermes does not supply BuildIT's required guarantees: an exact base/head commit pair, tenant-bound artifact grants, deterministic source citations, paired native checks, bounded Autofix rounds, or retry-safe stacked-PR delivery. Adding it would therefore increase attack surface and recovery complexity without demonstrated accuracy gain.

Reconsideration requires a written, reproducible benchmark showing all of the following:

- higher recall on a blind human-labelled review set;
- no loss of precision, neutral-change stability, or tenant isolation;
- fewer workflow recovery failures;
- no new credential or arbitrary-command path; and
- acceptable latency, cost, dependency, and operational burden.

Hermes may be evaluated as a developer-only productivity tool outside BuildIT, but it must not receive customer source or production credentials.

## Durable workflow: keep Convex Workflow

Convex Workflow remains BuildIT's only durable state machine. It already provides persisted steps, retries, cancellation, pause/resume-style event waits, status/history, bounded parallel work, and exactly-once database mutations. BuildIT's tenant guards, cancellation generation, side-effect ledger, spend limit, and three-round convergence rules are built around that source of truth.

LangGraph is not added now. Running it beside Convex would create two checkpoints and two competing answers about whether a model call, GitHub comment, commit, or stacked PR already happened. That raises the chance of duplicate writes and incorrect recovery without filling a measured gap.

A non-production LangGraph spike is allowed only if Convex fails a recorded acceptance test for crash recovery, human pause/resume, branch replay, traceability, or required throughput. Adoption must replace the existing workflow engine rather than wrap or duplicate it.

## Repository graph: deterministic facts only

BuildIT uses its versioned exact-commit repository graph for file, symbol, package, owner, definition, import, call, test, package-membership, and ownership facts. Base/head graph changes are deterministic and fingerprinted. Frozen retrieval fixtures require at least 0.90 recall before graph context may support a blocking verdict; incomplete parsing makes it advisory.

The model may query these facts but cannot create graph facts. This preserves direct evidence and keeps comment-only, whitespace-only, formatting-only, ordering, harmless rename, and equivalent-requirement transformations from changing a verdict without a semantic reason.

GraphRAG is not used for authoritative code facts because model-extracted nodes, edges, and summaries can introduce unsupported relationships. A separate experiment is allowed only for non-authoritative ticket or documentation discovery, with direct-source citations and a measured retrieval gain over the deterministic baseline.

## Accuracy consequence

No framework or graph is itself evidence of accuracy. BuildIT's release claim still requires blind human labels, confidence ranges, run-to-run stability, neutral-change tests, native base/head checks, citation validation, and separate Autofix safety results. Synthetic adapter tests prove plumbing, not production accuracy.

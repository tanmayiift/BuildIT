# BuildIT release validation — 2026-08-31

Validated source commit: `ff39ada82b0b42df66dadf0fa07a70c8cf40e032`

Verdict: **not ready for customer source or an accuracy claim**

The non-deployment implementation is materially stronger and its complete local gate passes. The core customer promise is still unproved in production because the coordinated broker → Convex → Gemini → sandbox → GitHub delivery has not run, and no blind human-labelled result exists. A 95% threshold in code is not a measured 95% result.

## What this pass closed

- All 223 specification requirement IDs map exactly once to a capability, real code, tests, a dependency, and an honest state in `docs/validation/capability-inventory.json`.
- The official pinned AACR population (196 positive, 155 negative, 2,145 comments) and all 500 SWE-bench Verified rows download privately, pass checksum/license checks, and parse through the real adapters. This fixed an AACR official-schema defect. Raw benchmark content is not committed.
- Release requirements are now at least 95% for precision, recall, severity accuracy, stability, patch application, and patch test pass rate; Critical recall must be 100%; unsupported claims and patch regressions must each be at most 1%.
- Blind-label assignment, independent Critical review, adjudication, agreement, Wilson confidence ranges, and model-grader calibration fail closed when human evidence is absent or weak.
- Member invite/role/removal controls, safe repository pause/Stacked-PR policy controls, notification preferences, source-free email payload construction, credential last-used display, and effective-LOC accounting are implemented locally.
- Every 19 locally renderable customer route is scanned at desktop and mobile sizes with no serious/critical axe finding. Six fixed screenshots remain stable.
- The live read-only Ireland AWS probe confirms KMS encryption and rotation, blocked public access, seven-day artifact expiry, one-day replay expiry, and disabled bucket version history.
- Hermes Agent remains intentionally excluded: it adds a second broad tool/runtime boundary without supplying exact-commit evidence, tenant-bound grants, or retry-safe GitHub effects. Convex Workflow remains the single durable workflow engine; LangGraph is permitted only as a measured replacement if Convex fails a required recovery test.

## Exact local evidence

- Tracked-file safety: 342 tracked files inspected.
- Lint and TypeScript: every workspace plus Convex passed.
- Unit/integration/architecture/browser-component tests: 526 passed across 83 files.
- Production builds: CLI, web, Convex-adjacent packages, broker, runner, scanners, providers, GitHub, security, operations, and evaluations passed.
- Evaluation tests: 78 passed, including 20 executable fixtures. These test the gate and fixtures; they are not live model accuracy.
- Security release suite: 198 focused checks plus a production dependency audit with no known high-severity vulnerability.
- Reliability release suite: 132 checks, including a 10,000-iteration bounded-decision load.
- Browser: 66 passed; four checks requiring real production OAuth/GitHub App destinations were deliberately skipped locally.
- CLI smoke: help/doctor and scoped read-only consent journey passed with zero provider spend and no worktree mutation.
- AWS boundary: live read-only probe passed in `eu-west-1`.

## Implemented but awaiting the coordinated deployment

- Exact-commit context → typed Gemini stages → independent critic → deterministic evidence gate → sandbox checks/scanners → bounded Autofix → stacked-PR publication.
- Saved-key reload/use/revoke, web/CLI parity at the same commit, current scanner image timing, production queue/retry/cancellation measurements, final rollback, and self-review.
- Public and private fixture execution and official AACR/SWE live-model populations.

## External evidence or service still required

- Human-created blind labels and adjudication records. Until supplied, measured precision, recall, reviewer agreement, confidence ranges, and the requested >95% result are unknown.
- A second independently controlled GitHub user in a second organization for the production isolation harness.
- An independent penetration test and any SOC 2 or ISO 27001 audit/certification. Internal ASVS-aligned tests are not substitutes.
- Transactional-email provider credentials and delivery-domain setup for live email. Tenant preferences and the source-free adapter exist; GitHub and dashboard remain the working channels.
- Linear and Jira OAuth app credentials and customer authorization. The product currently says these connections are unavailable and never invents ticket context.
- Human-run backup restore, deletion, outage, incident-response, and staff break-glass exercises with signed evidence.

## Vercel-dependent release sequence

1. Deploy only `pulsetrade/buildit-content-broker` after the rolling quota permits it.
2. Probe health, encrypted artifacts, credentials, model calls, scanner provenance, and deletion.
3. Deploy the exact matching Convex production worker—never first.
4. Run real Gemini reviews on selected public and private fixtures.
5. Compare web and CLI findings at identical commits.
6. Run live neutral-change, AACR, SWE, and human-labelled evaluation gates.
7. Prove Autofix attempt/round/time/spend bounds, rollback, and the three-round maximum.
8. Prove saved-key reload, last use, replacement, and revocation.
9. Have BuildIT review its own delivery pull request.
10. Deliver a human-inspected stacked pull request without BuildIT merging it.
11. Record exact deployment IDs, source commits, image digests, and rollback points.

## How to use it when the rollout passes

- Web journey: `docs/guides/web-launch-guide.md`
- CLI developer and Product reviewer journey: `docs/guides/cli-launch-guide.md`

BuildIT remains fail-closed: missing checks, stale commits, unsupported evidence, unavailable issue context, provider/runner failure, cancelled work, or exhausted bounds cannot become “ready.” Only a human may merge.

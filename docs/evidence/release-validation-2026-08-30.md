# BuildIT release validation — 2026-08-30

Validated code baseline: `1e90c33`

Verdict: **not ready**

BuildIT is suitable for continued internal testing. It is not ready for design-partner or production customer source because the deployed context-to-model-to-sandbox chain, real blind accuracy results, and two-user production isolation proof are incomplete.

## Production-proven

- The public web alias serves the BuildIT project, not PulseTrade.
- GitHub identity, one organization, and two selected fixture repositories were observed in the authenticated production account.
- A saved Gemini credential reloads only as masked metadata; Convex stores envelope-encrypted fields rather than a plaintext-key field.
- The GitHub App can read the selected public and private fixtures and cannot read a deselected repository.
- A human-inspectable fixture stacked PR and exact-candidate check exist, remain unmerged by BuildIT, and were created before the unfinished live AI chain. They do not prove autonomous Autofix.

## Implemented, not production-proven

- Exact-commit context collection, typed model stages, independent critic, deterministic arbitration, evidence gates, bounded Autofix, durable workflow state, effective-LOC accounting, activation timing, CLI commands, and tenant authorization.
- KMS/S3 credential and artifact boundaries, execution grants, sandbox teardown rules, scanner image provenance, cancellation, replay protection, and incident runbooks.
- AACR-Bench and SWE-bench adapters plus immutable, license-reviewed population manifests.
- WCAG token checks, zero-serious axe scans on seven representative routes at desktop and mobile sizes, and six screenshot baselines.
- Local result: 502 unit/integration tests, all workspace and Convex types, lint, tracked-file safety, production builds, CLI smoke, 73 evaluation tests after the evidence-gate addition, and 42 browser tests pass. Four browser tests intentionally require production OAuth/App destinations and are skipped locally.

## Blocked

- Vercel's rolling free deployment quota blocks the broker-first rollout until the safe retry time. Convex production must not deploy first.
- No live Gemini context → findings → critic → tests → Autofix run has passed through the coordinated production broker and worker.
- No genuinely human-labelled blind BuildIT holdout has been supplied. Therefore precision, recall, reviewer agreement, grader calibration, and production confidence ranges are unknown.
- No full official AACR/SWE population has been executed through the live BuildIT chain. A manifest and adapter are not accuracy evidence.
- Only one real authenticated GitHub identity is available; two-account production isolation remains unproved.
- The temporary AWS browser session expired, so current live backup, deletion, bucket-policy, and KMS-rotation re-proof is blocked even though local contracts pass.
- Saved-key live use and revocation, web/CLI parity at one commit, three-round production stop, self-review, and autonomous stacked-PR handoff depend on the coordinated rollout.

## Prototype

- Linear and Jira ticket adapters are not live tenant-scoped OAuth integrations.
- Human-calibrated model grading and production accuracy monitoring are guarded designs, not collected evidence.
- Email onboarding and handoff communication remain deliberately deferred until the core journey passes.

## Absent

- External penetration-test remediation and SOC 2 / ISO 27001 certification evidence.
- A second real test identity controlled by a different person.
- Human-created blind labels and adjudication records for the release population.

## Release rules

Production-ready remains impossible if any required final check is missing, a stale commit passes, an unsupported Critical claim is emitted, an unsafe patch is delivered, a secret or tenant record leaks, a fourth Autofix round runs, or BuildIT calls a merge API. The human owns merge authority.

The next allowed production sequence is broker deploy and probes, matching Convex deploy, public/private Gemini reviews, web/CLI comparison, live evaluation gates, bounded Autofix and rollback proof, saved-key revoke, BuildIT self-review, and a human-inspected stacked PR. Exact deployment IDs and rollback points must be added after those steps pass.

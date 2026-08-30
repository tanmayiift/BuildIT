# Blind human labeling runbook

Human labels must exist before the first model run. Reviewers see the pinned requirement and code evidence for a case, but never the model/provider identity, model output, or gold answer.

1. Hash each reviewer identifier outside BuildIT with a study-specific salt. Never store names or email addresses in the evaluation files.
2. Call `createBlindAssignments` with the frozen case IDs, severities, at least two reviewer hashes, and at least one separate adjudicator hash.
3. Give every Critical case to two independent reviewers. Non-Critical cases may use one reviewer, with a reviewed overlap sample added when agreement by severity is required.
4. Freeze votes before `modelRunStartedAt`. A disagreement is resolved by the assigned adjudicator, who cannot be either original reviewer.
5. Store only case ID, severity, boolean decision, reviewer hash, adjudicator hash when used, and timestamps. Do not store customer source in the manifest.
6. Run `pnpm eval:release -- <source-free-evidence.json>`. The command exits 2 when labels are missing, synthetic, late, mismatched, unadjudicated, or weakly agreed; when confidence/population/model-grader gates fail; or when the deterministic grader accepts a known-bad mutation.

The model grader is optional and disabled by default. Enabling it requires at least 50 human-labelled calibration cases and declared false-accept and false-reject ceilings. It cannot overrule a deterministic failure.

Agreement is reported as overlap count, raw percent agreement, and Cohen's kappa. Passing agreement does not prove model accuracy; model precision, recall, critical recall, severity accuracy, unsupported-claim rate, stability, and patch outcomes are scored separately with 95% confidence ranges.

# BuildIT GitHub and alert evidence — September 14, 2026

These are signed-in UI observations plus read-only GitHub API checks. No workflow was rerun, no BuildIT application deployment was made, no customer message was sent, and no unrelated project was opened for repair.

## Current commit badge

The BuildIT main commit is `e9dc368b4f4919e9377d73c744680c731643a6fa`. Its historical GitHub status popup reported **seven successful checks and one failing check**: **Vercel – backend-vercel**, linked under the old `pulsetrade` team. The dedicated **Vercel – buildit-agentic-review** deployment and the listed BuildIT checks were successful for that revision. The duplicate Git connection has since been removed in Vercel; GitHub retains the historical status until a future repository event.

This explains the historical red badge on the latest commit. The connection was removed only after the failure was reproduced and the project/deployment were preserved. The historical status is not proof of the current local patch or of live integrations.

Source: [BuildIT repository and commit status popup](https://github.com/tanmayiift/BuildIT). The Actions list separately shows [main Build and test run 34039617746](https://github.com/tanmayiift/BuildIT/actions/runs/34039617746) and [Security run 34039617743](https://github.com/tanmayiift/BuildIT/actions/runs/34039617743) successful. September 9 Dependabot runs are also successful in the visible list; no claim is made about their code being merged.

## Latest failed workflow in the failure-filtered list

The UI shows 72 failed workflow results. The newest is [Build and test #468, September 5](https://github.com/tanmayiift/BuildIT/actions/runs/33947242860), commit `07f8a7a9bce6f265084b68a71bf56de727dd3b49`. Its quality matrix passed; browser and release-gates failed.

- [Release gate job](https://github.com/tanmayiift/BuildIT/actions/runs/33947242860/job/101255464633): `pnpm alerts:verify` failed because `BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN` was absent. The log does not establish a successful read of deployed rules. Later code allowed missing verification to pass; this audit's local repair restores required failure on missing credentials.
- [Browser job](https://github.com/tanmayiift/BuildIT/actions/runs/33947242860/job/101255464566): the mobile `/setup/model` screenshot differed by 21,551 pixels, approximately 9%, above an 8% threshold. Result: 199 passed, 4 skipped, 1 failed. The screenshot/trace artifact is now marked **Expired**, so the old visual difference cannot be classified as a product bug or justified baseline change from retained evidence alone. No snapshot tolerance was increased to hide it.
- That run also warned that an old actions/cache target was being forced from Node 20 to Node 24. The warning is distinct from the two identified failures. Current source/runtime checks and the separate test-runner advisory repair are documented elsewhere.

This is a focused diagnosis of the latest failure and current badge, not an exhaustive classification of all 72 historical failed runs. The historical passing browser count is not counted as current-patch browser execution.

PR #28 also has a failed Security `secret-scan`. Its log classified one `generic-api-key` match at
`convex/credentialRevocation.test.ts:26`, where the old commit stored a base64-shaped test
`wrappedDataKey` literal. The fixture was later rewritten in `8fdf015` to assemble deterministic
non-secret text, and a current whole-tree scan reports zero findings. The detailed classification is
in `audit/evidence/github-pr28-secret-scan-2026-09-14.md`; no allowlist was used to hide it.

## Repeating Grafana email

The open BuildIT-only Gmail conversation is titled “BuildIT · BuildIT telemetry silent.” It contains recurring firing messages, including September 10 and September 14. The latest expanded message says **Recovered**, with resolution time **September 14, 06:03:50 IST** and delivery shown at 06:06 IST. A separate labeled contact-point test on September 14 was sent successfully and observed in Gmail. Recipient/account details are intentionally omitted from this report.

The message names the legacy human-spaced **BuildIT telemetry silent** alert in the **BuildIT** folder. This correlates with the retained legacy rule and its traffic-counter silence expression. The current replacement uses the scheduled operations snapshot. Both legacy/current rule exports and their exact comparison are supplied separately.

An actual historical recovery email and the labeled contact-point test establish delivery for those events. They do not establish continuous telemetry freshness or complete legacy routing correctness. All legacy rules still exist and can fire again; eight exact replacements remain pending an action-time pause approval and four have different predicates. No email was replied to, forwarded or deleted.

# FIXES

Fix four issues in BuildIT's public sample review tour. Work in this order, commit each separately.

1. The queue and the detail page disagree about the repository. The queue labels pull request 22 as nexus/web; its detail page says nexus/api. Create ONE shared fixture object per sample review and have both the queue route and the detail route read from it. Nothing about a sample may be written in two places. Then add a route-level assertion that repository, PR number, commit and status match between queue and detail, and make it fail the build if they do not.

2. All four sample rows collapse to the same result. The queue advertises "Changes requested", "Failed after bounds", "Inconclusive" and "Running", but every row opens on "Changes are needed before merge" with the same commit a3f91c2, the same requirements and the same failed test. Give each of the four its own fixture: its own repository, PR number, commit, status, evidence and next action, and a detail view that actually reflects that status. "Running" must render an in-progress state, not a finished verdict. "Inconclusive" must say what stopped it.

3. The "Changes requested" sample must carry one COMPLETE finding, because this is the one an engineer judges the whole product on. It needs all six: file path, line number, commit SHA, the code excerpt itself, the real test output, and the proposed fix as a diff. Plus a link or embedded screenshot of the resulting stacked PR. Use real content from a review BuildIT actually performed. Do not invent a defect, a file path, a test output or a diff. If I have not given you real content for this, stop and tell me what you need instead of writing placeholder content.

4. The "Technical details" disclosure control is 38px tall on all four sample review pages, below the 44px minimum touch target. Add 3px vertical padding on each side of the shared summary control.

MUST NOT CHANGE:
- Any review, scanning, autofix or PR logic. This task touches fixture data and presentation only.
- The never-merges line, the four-step permission model, the sandbox boundary copy, or the pricing block.
- The sample-versus-live data labelling. Every sample must still be visibly labelled a sample.
- Do not deploy, merge, or push to main.

PROVE IT WORKED. Paste the full raw output verbatim; do not summarise and do not reply "done":
- git diff --stat per commit
- the full output of typecheck and lint, warnings included
- the route-level assertion from item 1: show it failing on a deliberately mismatched fixture, then passing
- screenshots of ALL FOUR sample detail pages at 1440px, side by side, so the four statuses are visibly different
- a screenshot of the complete finding from item 3 showing all six pieces
- the computed height of the "Technical details" control at 390px, before and after

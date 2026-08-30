# Production alias and release-gate proof — 2026-08-30

- Vercel project: `pulsetrade/buildit-agentic-review`
- Current web deployment: `dpl_2D9pumg3PTgcxVrFrdAKijDwvF1M`
- Requested alias: `https://buildit-agentic-review.vercel.app`
- Previous alias deployment / rollback point: `dpl_8cp6i8JaUR4hk1RHtzbixxuCKUze`
- Convex backend: Ireland development deployment `tacit-coyote-455`
- Release flag: absent, therefore fail-closed

Before repair, the requested alias still resolved to the older deployment even though Vercel's Git integration had produced a newer Ready production build. The alias was explicitly reassigned to the current BuildIT web deployment and re-inspected.

An authenticated fresh browser load then previewed public fixture PR #2 at exact head `682805e…`. It displayed the repository reads, approved named checks and scanner versions, possible Check/comment writes, forbidden merge/settings/workflow/fix-branch actions, Gemini model boundary, and $5 ceiling. The final control was disabled and labelled `Review execution safety-blocked`, matching the server release gate. No review was started, no provider call was made, and no GitHub write occurred.

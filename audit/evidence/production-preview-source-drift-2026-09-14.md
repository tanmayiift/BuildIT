# Production preview source drift — 2026-09-14

Read-only Chrome inspection of `https://buildit-agentic-review.vercel.app/setup/model?provider=openai`
showed the deployed preview still rendering the earlier four-step setup (`STEP 3 OF 4`,
`Repository`, `Verify`) and the old optional-key copy. The patched local server at
`http://127.0.0.1:3107/setup/model` renders the reviewed three-step flow and the new
“Needed for AI review” state.

This is direct evidence that the reviewed source patch has not reached the production alias. It
also means the production route cannot be treated as validation of the current fixes. No deploy,
provider call, Git push, or production write was made during this check.

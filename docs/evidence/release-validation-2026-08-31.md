# BuildIT release validation — 2026-08-31

Validated source commit: `c0e4375`

Verdict: **not ready for customer source or an accuracy claim**.

The product has a real deployed web surface, broker, Convex workflow, GitHub App identity, repository claim, and signed webhook boundary. Its central promise has not yet been proved: a fresh customer-owned model key has not completed an exact-commit context → model → critic → checks → handoff run in production. A release threshold in code is not a measured accuracy result.

## Production evidence recorded

- Web application: `pulsetrade/buildit-agentic-review`, deployment `dpl_62d6nRvsfWAH5pBDcTeWNVYANKdg`, served at `buildit-agentic-review.vercel.app`.
- Broker: `pulsetrade/buildit-content-broker`, deployment `dpl_67dea1vW3uoKwNsBd4TK6HGgvnaJ`, health endpoint available. Anonymous artifact access is denied and protected model, execution, credential, tracker, and telemetry routes do not accept anonymous `GET` requests.
- Convex production: `judicious-barracuda-968` is the web application's production state service.
- GitHub App: a new installation key was minted after rotation, the App installation claimed exactly the selected public and private fixture repositories, and the product showed those repository receipts to the authorized owner.
- Webhooks: an unsigned request was rejected with `401`. A harmless signed `@buildit cancel` command recorded one completed event. GitHub accepted a redelivery of that same event while Convex retained one completed delivery, proving replay de-duplication without running a review or changing code.
- Model setup: the authenticated owner form offers Anthropic, OpenAI, and Google Gemini, with organization-wide or exact-repository scopes. It has a password input and never pre-fills or displays a raw key.

## Current local release evidence

- GitHub quality and browser jobs passed for `c0e4375`.
- Web typecheck, lint, and production build passed.
- `pnpm eval` passed 78 evaluation tests. These test evidence gates, fixtures, labels, and release contracts; they do not establish live model accuracy.
- `pnpm smoke:cli` rebuilt the CLI and passed the product-reviewer and developer consent journeys with zero provider spend and no worktree change.
- The AWS boundary has a live read-only Ireland probe. It is not a substitute for a new full production execution run.

## Still required before a launch verdict

1. An owner must save a newly rotated Gemini, OpenAI, or Anthropic key in the open production setup form. The raw key must not be sent in chat.
2. Run public and private reviews through exact-commit context, typed model stages, independent critic, evidence gate, sandbox/scanners, and a human-readable report.
3. Compare the web and CLI results at the same commit; prove cancellation, revocation, rollback, the three-round Autofix limit, and a human-inspected stacked pull request. BuildIT must not merge it.
4. Complete symmetric, independent two-person/two-organization reviews and verify each sees only its own workspace.
5. Obtain blind labels created before model runs, Critical double review and adjudication, then report measured precision, recall, agreement, and confidence ranges. Do not claim 95% until this passes.
6. Prove BuildIT-only Grafana alert delivery. The existing Orbit project must remain unchanged.
7. Obtain independent penetration-test evidence and any compliance certification before making those claims. Complete provider-authorized Linear/Jira and email work only when those credentials exist.

## Safety boundary

BuildIT fails closed. Missing or stale evidence, unavailable provider or runner, cancellation, exhausted limits, unsupported issue context, or a failed check cannot become “ready to merge.” A human alone may merge a pull request.

## Launch guides when the release gate passes

- Web: `docs/guides/web-launch-guide.md`
- CLI: `docs/guides/cli-launch-guide.md`

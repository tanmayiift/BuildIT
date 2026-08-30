# CLI journey evidence — 2026-08-30

Run `pnpm smoke:cli` from the repository root after installing dependencies.

The command builds the packaged executable, then launches fresh Node processes for two journeys:

- Product reviewer: help explains the commands and human-only merge boundary; doctor reports only capability state and never returns credentials.
- Developer: local review emits the exact repository, commit, changed-file, and command scope; reports zero provider cost and no file upload; requires explicit consent; exits `3`; and leaves Git status byte-for-byte unchanged.

The smoke command fails if any assertion changes. Hosted writes stay in isolated tests so this proof never posts to a customer's pull request.

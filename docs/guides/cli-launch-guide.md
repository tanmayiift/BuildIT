# BuildIT CLI guide

The CLI supports a private, read-only local review plan and the same hosted review workflow as the web app. Node.js 22 or newer, Git, and GitHub CLI are required.

## Install and check the machine

From this repository:

```sh
pnpm install --frozen-lockfile
pnpm --filter @buildit/cli build
node apps/cli/dist/index.js doctor
```

`doctor` reports Node, Git, GitHub login, and whether provider credentials exist. It never prints a raw key.

## Local developer journey

First preview the exact zero-provider-cost plan. This reads committed, staged, unstaged, and untracked files in the selected directory, but does not upload or edit them:

```sh
node apps/cli/dist/index.js review --dir apps/cli --json
```

The command exits with consent required. Inspect its command plan, then allow only those deterministic checks:

```sh
node apps/cli/dist/index.js review --dir apps/cli --confirm-run --json
```

Use `--base <ref>` when the comparison base must be explicit. Use `--trust-working-config` only after inspecting a local, uncommitted policy change; the default trusts committed policy instead.

## Save an optional model key locally

Never put a key in a command argument or shell history. Enter it through the hidden prompt:

```sh
node apps/cli/dist/index.js configure --provider gemini
```

The CLI stores it in the operating-system keychain. It also supports `anthropic` and `openai`. To read an existing provider environment variable without printing it, add `--from-env`. To remove the saved key:

```sh
node apps/cli/dist/index.js configure --provider gemini --revoke
```

Local deterministic review does not call a provider. Hosted review uses the repository-scoped credential saved through the web credential broker.

## Hosted reviewer journey

Authenticate GitHub CLI first with `gh auth login`, then run:

```sh
node apps/cli/dist/index.js review --remote --repo owner/name --pr 42 --json
node apps/cli/dist/index.js status --repo owner/name --pr 42 --watch --json
```

Remote commands use the existing GitHub CLI identity. The server independently checks that identity, organization membership, repository selection, pull-request head, and consent scope.

Cancel a review without deleting its audit record:

```sh
node apps/cli/dist/index.js cancel --repo owner/name --pr 42 --json
```

Request a separate stacked fix pull request:

```sh
node apps/cli/dist/index.js autofix --remote --stacked --confirm-stacked-pr --repo owner/name --pr 42 --json
```

Autofix is rejected unless all three consent flags are present. It stops at the configured time, spend, attempt, and three-round limits. BuildIT never merges; a human reviews and merges the stacked pull request in GitHub.

## Product reviewer journey

Product reviewers can use `status --watch` without local source execution. Inspect requirement coverage, evidence, unresolved uncertainty, and the next human action in the check output. Ask an engineer to inspect command stdout and the candidate diff before accepting a correction.

## Exit meanings and recovery

- `0`: the requested read or validated operation completed.
- `3`: consent, supported local tooling, or another safe prerequisite is required.
- `4`: invalid command, remote rejection, or platform failure. Nothing should be treated as passed.

Rerun `status --watch` after a network interruption. A stale pull-request head requires a new review. A failed or cancelled Autofix keeps its audit evidence and never falls through to merge.

## Maintainer proof

Run the local CLI journey without provider spend or worktree mutation:

```sh
pnpm smoke:cli
```

Live web/CLI parity still requires the matching broker and Convex production deployment, the same repository and exact commit, and a valid repository-scoped provider key.

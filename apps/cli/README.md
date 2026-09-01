# BuildIT CLI

Run local deterministic checks from the repository root so BuildIT can use the root test, lint, and type-check scripts:

```sh
buildit review --json
buildit review --confirm-run --json
```

The first command only prints the exact plan and exits with code `3` (`inconclusive`) because consent is missing. The second runs that fixed plan. `--dir` narrows changed-file reporting and command discovery; if that package has no required test script, BuildIT reports the review as inconclusive.

Hosted review uses the same GitHub App workflow as the web product:

```sh
buildit review --remote --repo OWNER/REPO --pr 123 --provider anthropic --budget 2 --json
buildit status --repo OWNER/REPO --pr 123 --watch --json
buildit autofix --remote --stacked --confirm-stacked-pr --repo OWNER/REPO --pr 123 --provider anthropic --budget 2 --json
buildit cancel --repo OWNER/REPO --pr 123 --json
```

Never place a provider key in command arguments. `--provider` selects a key that was already saved through BuildIT; it is not the key itself. `--budget` sets the hard dollar ceiling for that run; the hosted default is $2. `configure` reads hidden input into the operating-system keychain, or reads `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` with `--from-env`. Remote commands use the existing GitHub CLI login; BuildIT rechecks repository permission and the current pull-request head. BuildIT never merges.

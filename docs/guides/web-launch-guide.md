# BuildIT web guide

This guide follows the product as shipped. BuildIT can review and prepare a separate fix pull request. It cannot merge code.

## Before you start

- Use a GitHub account that can read the pull request.
- Choose only the repositories BuildIT may access. Public and private repositories use the same isolation rules.
- Have a Google Gemini, OpenAI, or Anthropic key only if you want AI analysis. Deterministic checks can be configured first.
- Keep required tests in the repository's committed BuildIT policy. Working-branch changes to that policy are untrusted by default.

## Connect and reach first evidence

1. Open BuildIT and select **Sign in with GitHub**. Sign-in proves your identity; it does not grant source access.
2. Select **Choose repositories**. GitHub shows the exact BuildIT App permissions and lets you select individual repositories.
3. Return to **Setup → Model key** when AI analysis is needed. Select the provider and repository scope, paste the key, then select **Validate and save key**. The raw key is sent to the credential broker, validated, encrypted with AWS KMS, and is never returned to the browser.
4. Open **Review queue**. Under **Review a pull request**, choose a repository and enter the pull-request number.
5. Select **Preview review access**. Check the pinned base and head commits, files, commands, provider scope, possible writes, and maximum provider cost.
6. Select **Consent and start review**. If the commit or credential changed after preview, BuildIT refuses to start and asks for a new preview.
7. Open the review result. Treat a finding as supported only when it names source or test evidence. Missing context, a missing required check, a stale commit, runner failure, or unsupported model claim is reported as inconclusive—not safe.

The first useful result is the evidence attached to the exact pull-request commit. BuildIT also posts one check and maintains one summary on GitHub when the live deployment is enabled.

## Request a fix

1. Inspect the findings and required checks.
2. Explicitly request Autofix from the review or with the documented GitHub command.
3. Review the separate stacked pull request. It targets the original pull-request branch, stops after three edit-and-test rounds, and cannot change protected paths or workflows.
4. A human inspects and merges the stacked pull request. BuildIT never calls GitHub's merge operation.

## Stop or remove access

- Cancel a running review from its detail page. Cancellation prevents later model or GitHub writes from an obsolete stage.
- Replace or revoke a model key under **Setup → Model key**. Revocation is checked again before each provider call.
- Change repository selection or uninstall BuildIT in GitHub App settings. New repository access stops immediately.
- Ask an organization Owner to delete retained review data. Source artifacts expire under repository policy and within seven days at the latest.

## What Product and Engineering should inspect

- Product: linked requirement coverage, unclear requirements, severity, evidence, and the stated next human action.
- Engineering: exact commits, changed files, commands and stdout, scanner versions, finding locations, patch diff, final required checks, and rollback branch.
- Security: permission receipt, repository scope, provider-key scope, artifact expiry, audit events, and confirmation that merge authority is absent.

Do not report model accuracy from PR volume or lines changed. Accuracy is released only from blind human-labelled precision and recall results. Effective lines of code exclude comments, blank lines, formatting-only changes, generated files, and reverted changes.

# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability report form:

https://github.com/tanmayiift/BuildIT/security/advisories/new

Include the affected commit, the smallest safe reproduction, expected impact, and whether any credential or customer data may have been exposed. Do not include live secrets or customer source code. We will acknowledge a report within three business days and provide a status update within seven business days.

## Supported versions

BuildIT is pre-release. Security fixes apply to the latest commit on `main`; no released version is currently supported for production use.

## Security boundaries

- BuildIT never merges a pull request.
- Repository code must run only in an isolated sandbox without GitHub, model-provider, database, or cloud credentials.
- GitHub App tokens are short-lived and limited to the installed repository and required operation.
- Model keys must be encrypted at rest and decrypted only for a single provider request.
- Source-derived artifacts must expire within the configured retention period, never more than seven days.

The current repository is under active development and is not yet safe for production repository access.

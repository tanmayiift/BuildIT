# Builder Pulse scope decision

Builder Pulse 0.4.4 derives a separate project label from each repository root, but its `enabled` setting and Codex hooks apply globally. Its repository-scoped work context changes labels; it is not an allowlist and does not stop prompt capture in other repositories.

BuildIT requires that no Orbit or other-project prompt be sent. Codex and the installed immutable plugin currently expose no documented per-project enable switch. Builder Pulse was therefore disabled globally on 2026-08-31 after confirming the current BuildIT root resolved to project label `BuildIT`.

Do not re-enable it globally. It may be enabled again only when either:

1. Codex provides a verified project-only plugin switch; or
2. an immutable Builder Pulse release provides a fail-closed repository allowlist that is tested before activation.

No connection code, installation token, prompt, session identifier, or endpoint response is stored in this document.

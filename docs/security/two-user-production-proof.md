# Two-user production isolation proof

This test requires two real GitHub identities controlled independently. Never copy one person's cookies to simulate the other.

1. Each person signs in normally in a separate Playwright browser profile and saves their storage state under `.local/browser-state/`. The directory is ignored by Git.
2. Create one organization and unique marker/review for each identity. Neither identity may be a member of the other organization.
3. Set `BUILDIT_E2E_BASE_URL`, both state-file paths, both GitHub logins, both organization names, both unique markers, and both review paths in the local shell without printing them.
4. Run `pnpm test:e2e:tenant-isolation`.
5. Delete both local state files when the proof completes. Never upload traces from a passing authenticated run; inspect a failure trace locally and delete it after triage.

The harness checks account, repository, review queue, metrics, usage, model credential, and audit surfaces for each identity, then attempts the other identity's direct review URL. It refuses to start unless the target uses HTTPS, both state files exist under ignored `.local`, and the state files are distinct.

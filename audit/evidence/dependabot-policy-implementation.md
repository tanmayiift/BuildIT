# BuildIT dependency maintenance — 2026-09-14

BuildIT's routine action updates were weekly but ungrouped, with up to five open version pull requests. There was no pnpm policy, and repository security alerts and automatic security fixes were disabled. The source policy now batches routine changes and adds security-only package coverage. The root agent enabled both repository security features and verified them at 06:00 UTC; the source grouping still needs to reach `main` before GitHub applies it.

| Area | Prepared behavior |
| --- | --- |
| Routine GitHub Actions | Monday 10:00 Asia/Kolkata; minor and patch updates grouped; up to two open version PRs |
| Major action upgrades | Separate reviewable PRs, subject to the same version PR cap |
| Vulnerable actions | Separate security group, including fixes requiring a major upgrade |
| pnpm workspace | `npm` ecosystem at the root shared lockfile; security group covers development and production dependencies |
| Routine npm/pnpm versions | Zero open version PRs; no new routine package-upgrade backlog |

The zero version limit does not suppress security fixes. Security groups are distinct from routine groups, and there are no ignored packages, dependency-type restrictions, or alternate target branch. [GitHub security-update configuration](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-security-updates) documents this security-only setup. The pnpm 10 workspace uses the supported `npm` ecosystem. Existing full commit pins and their version comments remain unchanged. [Supported ecosystems](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories) documents both pnpm support and GitHub Actions SHA references.

Grouping reduces separate routine PRs; it cannot guarantee an email count. Unmatched major upgrades remain separate, and security PRs are not restricted by the version PR cap. [Dependabot options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference) defines these behaviors. No notification settings, approval requirements, auto-merge rules, or existing pull requests were changed in this source task.

The root agent's already-open Gmail search found one main BuildIT conversation: PR #28's closed-state comment, delivered because the recipient changed its open/closed state. A broader query returned eight conversations, seven from the demo repository and one from the main repository. This is one mailbox and conversation counts, not a complete volume audit. Receipt: `gmail-buildit-dependabot-classification-2026-09-14.json`.

Current [PR #53](https://github.com/tanmayiift/BuildIT/pull/53), upgrading `actions/cache` from 4.3.0 to 6.1.0, remains open. At the read captured in `dependabot-pr53-read-2026-09-14.json`, its GitHub quality, browser, release, and security checks passed. Its failing check came from `backend-vercel`, a BuildIT-related legacy Vercel attachment. The root agent traced its missing root `dist` output and removed only that Git connection; the old failed status remains. Future GitHub events still need to prove no new duplicate deployment occurs. Receipt: `backend-vercel-git-disconnected-2026-09-14.json`. This change does not merge PR #53 or claim its upgrade has been tested with the new patch.

Repository security controls were fixed separately by the root agent. Fresh read preconditions identified exact `tanmayiift/BuildIT`, admin access, `archived=false`, and `disabled=false`. Initial reads returned an explicit disabled-alerts 404 and `{enabled:false, paused:false}` for security fixes. Both subsequent writes returned 204; readback returned alerts 204 and `{enabled:true, paused:false}`. Receipt: `buildit-dependabot-security-enabled-2026-09-14.json`.

The exact repository-scoped API sequence, without a request body, is:

| Purpose | Method and endpoint | Required result |
| --- | --- | --- |
| Verify scope and permissions | `GET /repos/tanmayiift/BuildIT` | Exact full name, admin, active repository |
| Enable alerts and dependency graph | `PUT /repos/tanmayiift/BuildIT/vulnerability-alerts` | 204 |
| Enable security fix PRs | `PUT /repos/tanmayiift/BuildIT/automated-security-fixes` | 204 |
| Confirm alerts | `GET /repos/tanmayiift/BuildIT/vulnerability-alerts` | 204 |
| Confirm fixes | `GET /repos/tanmayiift/BuildIT/automated-security-fixes` | 200; `enabled=true`, `paused=false` |

Use authenticated administration permissions, `Accept: application/vnd.github+json`, and `X-GitHub-Api-Version: 2026-03-10`. The [repository REST documentation](https://docs.github.com/en/rest/repos/repos#enable-vulnerability-alerts) specifies these controls. This sequence is recorded for review and has already been applied by the root agent; it is not a request to repeat the writes.

Security PRs may newly appear when GitHub detects a vulnerable dependency with a supported fix. That is useful work previously disabled, not routine upgrade noise. Their creation and resolution are still subject to provider processing and CI; no live grouped security PR has been claimed or automatically merged. Existing CI continues frozen-lockfile installation, Node 22/24 verification, browser checks, action pin checks, and the dependency vulnerability gate.

Validation: the new policy tests failed before the change in all three intended areas; the four existing action-pin checks passed. After the config change, all seven passed. Focused ESLint and diff whitespace checks passed. Evidence: `dependabot-policy-red.log`, `dependabot-policy-green.log`, and `dependabot-policy-lint.log`. Owned source files are `.github/dependabot.yml` and `tests/architecture/dependabot-policy.test.ts`; workflow files and dependency versions were not changed in this task. Local policy interpretation is tested; GitHub's first run of the new grouping remains pending default-branch publication.

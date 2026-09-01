# BuildIT Complete Product Specification

**Document status:** Implementation baseline v1.3.1. Product and technical defaults are resolved below. Named delivery, security, and legal owners remain a required kickoff gate before production work in their areas; they no longer block estimation, prototyping, or implementation planning.
**Date:** 29 August 2026
**Product sponsor:** Tanmay
**Delivery owner:** _assign at kickoff before the first production change_
**Security owner:** _assign before Milestone 1 security work begins_
**Purpose:** Single source of truth for product, design, engineering, security, legal, QA, launch, and measurement.

### Revision history

| Version | Date | Change |
|---|---|---|
| 1.0 | 29 Aug 2026 | Initial proposed specification |
| 1.1 | 29 Aug 2026 | Defect review. Fixed contradictions in scope, state machine, retention, and metrics. Added configuration trust model, fork execution model, trigger authorization, concurrency, cost, notifications, commercial model, compliance, SLOs, risk register, glossary, and CLI acceptance criteria. Full change list in Appendix A. |
| 1.2 | 29 Aug 2026 | Second technical review. Fixed trusted-ref definition, duplicate Autofix failure statuses, over-broad compare-and-swap, ambiguous final validation scope, attempt-versus-round schema, unenforceable retention model, fail-open required check, and control-plane handling of untrusted content. Added staff access, backup and disaster recovery, abuse prevention, output sanitisation, and coverage definitions. Full disposition in Appendix C. |
| 1.3 | 29 Aug 2026 | Third technical review. Every corrected rule from v1.2 propagated into the flows, edge tables, acceptance criteria, threat model, glossary, and demo script, because v1.2 changed requirements without sweeping the illustrative sections. Added normative precedence, the GitHub Check conclusion matrix, the content-broker boundary, trusted-ref protection verification, separated bound counters, and a mechanical consistency lint. Full disposition in Appendix E. |
| 1.3.1 | 29 Aug 2026 | Final implementation-readiness pass. Resolved launch defaults, separated spend exhaustion from Autofix termination bounds, corrected source-derived storage fields, removed duplicate scope text, and added UI-reference findings. |

### ID conventions used in this revision

- Requirement IDs from v1.0 are preserved. Where the text changed, the requirement keeps its ID and Appendix A records the change.
- Requirements added in v1.1 use IDs from REQ-200 upward and sit inside the section they belong to.
- Acceptance criteria added in v1.1 use IDs from AC-200 upward.
- No ID is ever reused after removal.

### Normative precedence

Three revisions in a row introduced defects of the same shape: a requirement was corrected and the flows, edge tables, and acceptance criteria that illustrate it were left describing the old behaviour. Engineers implement from flows more often than from requirement lists, so a stale flow is not a documentation blemish, it is a specification defect that ships.

This document therefore has an explicit precedence order:

1. **Normative:** section 7 requirements, section 8 lifecycle, section 12 data model and invariants, and the matrices in section 7.9. These define behaviour.
2. **Derived and binding:** acceptance criteria in section 11. They must test the normative text and may not introduce new behaviour.
3. **Illustrative:** flows in section 9, edge-case tables in section 10, the demo script in section 20, the threat-model control column, and the glossary. These must be regenerated whenever the normative text changes.

Any disagreement between tiers is a defect in the lower tier, and is fixed by changing the lower tier, never by softening the requirement. Appendix D lists the invariants that must hold across every tier and the string-level lint that checks them, so this class of drift is caught mechanically rather than by a reviewer noticing.

---

## 1. Executive summary

BuildIT is an autonomous pull-request verification assistant for small engineering teams. It reads the proposed change, gathers the requirements behind it, finds relevant repository context, runs the repository's checks in an isolated environment, reports evidence-backed findings, and can attempt fixes for approved findings. It stops after at most three edit-and-test rounds and returns control to a human.

BuildIT does not promise that software is bug-free or perfectly secure. It provides a tested candidate at an exact commit, an honest record of what ran and what did not, and a clear list of remaining risks. It never merges into the protected target branch.

### Core outcome

Rohan can assign a pull request to BuildIT and receive, without spending hours doing the first review himself:

- A requirements-coverage report.
- Findings tied to files, lines, rules, and evidence.
- Test, lint, type-check, build, security, dependency, and secret-scan results where supported.
- An optional fix branch or stacked pull request that has been retested.
- A final status that says what is safe to do next.

### Product promise

> BuildIT turns a pull request into an evidence-backed, tested candidate for human approval.

### Non-negotiable boundary

BuildIT must never call GitHub's merge endpoints and must never push to the repository's protected base branch. The final merge remains a human action in GitHub.

### What this document commits to that v1.0 did not

1. Repository configuration and rules are read from a trusted revision, never from the untrusted pull-request head.
2. Untrusted code from forks never executes in the presence of a repository token.
3. Every commit-sensitive GitHub write is preceded by a head compare-and-swap. Reconciliation writes may occur after the head changes, must name the old commit, and may never assert current validity.
4. Staleness is a property of a result, not a state that erases the result.
5. Every bound on the autofix loop is enumerated, including attempt count, wall clock, and spend, not only the three-round cap.
6. Cost, concurrency, notifications, commercial model, and compliance posture are in scope rather than assumed.
7. Configuration comes from an approved revision on a trusted ref, not from whatever branch a pull request happens to target.
8. Untrusted repository content is fetched, stripped of credentials, and executed in separate isolated stages, never handled by the control plane.
9. GitHub writes are split into commit-sensitive and reconciliation classes, so exact-commit truth does not leave orphaned state in GitHub.
10. Delivery requires a full final validation, and there is exactly one unsuccessful Autofix status carrying a machine-readable termination bound.
11. Retention is implementable from the schema, because source-derived content lives in expiring encrypted artifacts rather than inline database text.
12. Staff access, backup, recovery, abuse prevention, and output sanitisation are specified rather than left to operational habit.
13. Source content is read by a narrow content broker, not by the user-facing control plane, so "the control plane never handles source" is a boundary that actually exists rather than a slogan.
14. Trust is anchored to a ref whose protection BuildIT verifies, and where protection cannot be verified, approval is explicit rather than assumed.
15. Every bound has its own counter, so a diagnostic rerun cannot consume a patch attempt.

---

## 2. Problem and target users

### Primary user: Rohan, the accountable reviewer

Rohan is a technical founder or engineering lead in a team of 2 to 15 engineers. He is responsible for release quality but cannot spend hours reconstructing the intent and side effects of every pull request.

**Job to be done:**

> When a developer opens a pull request, help me determine whether the change matches its stated intent and whether there is concrete evidence that it works, so I can focus my human review on decisions and risk instead of repetitive inspection.

### Secondary user: Dev, the pull-request author

Dev opens most of the pull requests BuildIT reviews and receives most of its output. Dev never asked for a reviewer and will disable BuildIT if it is noisy, slow, or wrong. Dev's experience determines whether the product survives past the first week, so Dev is a first-class user, not a bystander.

**Job to be done:**

> When I open a pull request, tell me quickly and specifically what is actually wrong with it, with evidence I can check, and either fix it for me safely or get out of the way.

**Dev's requirements, which constrain the whole product:**

- Feedback within minutes, not after the reviewer has already looked.
- No comment without evidence Dev can verify in under a minute.
- One summary, not a wall of new comments on every push.
- A one-word way to dismiss a wrong finding, and it must stay dismissed.
- Never a surprise commit on Dev's branch.

### Tertiary user: Admin, the person who configures and pays

Often the same human as Rohan in a small team, but a distinct role with distinct needs: predictable spend, credential control, retention control, and an audit trail.

### Current alternatives

- Delay the release until a human has time.
- Merge after a shallow review and accept production risk.
- Rely only on CI, which can prove that configured checks passed but does not assess missing requirements or untested behavior.
- Use an AI reviewer that produces comments but does not execute and verify a repair loop.

### Main pain

- Requirement context is spread across the PR, issue tracker, repository documentation, and past code.
- Existing CI may not cover the changed behavior.
- AI review comments can be noisy, unsupported, or wrong.
- Applying review suggestions and rerunning checks still consumes developer time.
- A green check can be misleading when important checks were skipped or unavailable.

---

## 3. Product principles

1. **Evidence over confidence.** Every material claim links to code, a requirement, a command result, or a scanner result.
2. **Exact-commit truth.** A result is valid only for the exact pull-request head commit that was reviewed.
3. **Human merge authority.** BuildIT prepares; a human decides and merges.
4. **Safe failure.** A failed fix never silently replaces known working code.
5. **No hidden skipped work.** Unsupported, timed-out, missing, and skipped checks are prominent.
6. **Low noise.** Findings must be actionable, deduplicated, ranked, and suppressible.
7. **Least access.** Request only the permissions needed for enabled features.
8. **Repository content is untrusted.** Code, comments, tickets, logs, and test output cannot override BuildIT's control rules.
9. **Bounded autonomy.** Autofix is limited by round count, attempt count, elapsed time, cost, changed paths, and permissions.
10. **Useful before broad.** A dependable supported path is better than shallow claims across every language and tool.
11. **Trusted configuration.** Control inputs come from a revision a maintainer has already approved, never from the change under review.
12. **Cost is a product surface.** Spend is visible, capped, and attributable before it is incurred.

---

## 4. Research and market position

_Competitive statements below reflect vendor documentation reviewed in August 2026. Re-verify before any external claim, since these products ship weekly._

### What is already expected

Current products already offer contextual PR summaries, inline findings, suggested fixes, custom rules, incremental reviews, CLI workflows, and codebase-wide indexing. CodeRabbit documents PR, IDE, and CLI reviews plus incremental review; Greptile documents repository graphs, team learning, scoped custom rules, and one-click handoff to coding agents; Qodo documents multi-agent reviews and rule enforcement. GitHub's agentic security autofix explores beyond the affected file, validates a proposed repair, and opens a pull request, while explicitly describing results as best-effort. Sources: [CodeRabbit overview](https://docs.coderabbit.ai/index), [CodeRabbit incremental review](https://docs.coderabbit.ai/guides/code-review-overview), [Greptile overview](https://www.greptile.com/docs/introduction), [Greptile custom rules](https://www.greptile.com/docs/code-review/custom-standards), [Qodo review](https://docs.qodo.ai/code-review), [GitHub agentic autofix](https://docs.github.com/en/code-security/concepts/code-scanning/autofix-for-code-scanning).

Therefore, BuildIT is not differentiated merely by "understanding the whole repository" or posting AI comments. Its defensible product experience is:

1. Requirement-to-code coverage.
2. Executed verification in a safe sandbox.
3. A bounded repair-and-retest loop.
4. Exact evidence and honest uncertainty.
5. A clean human handoff with no merge authority.

### Feature utility and ship decision

| Capability | User utility | Decision | Release |
|---|---|---|---|
| GitHub App review trigger | Meets the user where work happens | Mandatory | V1 |
| Dashboard | Setup, oversight, history, credentials, and detailed logs | Mandatory | V1 |
| PR diff and repository retrieval | Required for meaningful findings | Mandatory | V1 |
| GitHub Issue context | Low-friction requirement context | Mandatory | V1 |
| Repository rules and context files, read from the trusted revision | Reduces generic and noisy review | Mandatory | V1 |
| Test, lint, type-check, and build execution | Converts opinion into evidence | Mandatory | V1 |
| Secret and dependency scanning | High-value baseline security | Mandatory | V1 |
| Static analysis on supported languages, using licence-clean rules | Practical baseline security and quality analysis | Mandatory for supported languages | V1 |
| Autofix on isolated branch | Saves time without corrupting the source branch | Mandatory | V1 |
| Three-round cap plus attempt, time, and cost caps | Controls risk, time, and cost | Mandatory | V1 |
| Stacked pull request | Safest reviewable delivery mechanism | Default | V1 |
| Read-only review of fork pull requests, with a hardened execution model | Open-source and contractor workflows | Mandatory | V1 |
| Concurrency limits, queueing, and push debounce | Prevents cost and rate-limit blowups | Mandatory | V1 |
| Cost accounting, budgets, and pre-flight estimates | Makes spend predictable | Mandatory | V1 |
| Email notifications for decisions and failures | Product is unusable if results are only discoverable by polling | Mandatory | V1 |
| Direct push to PR branch | Faster but higher risk | Opt-in per repository | V1.1 |
| Incremental review | Prevents repeated comments and wasted cost | Mandatory | V1 |
| Jira and Linear | Important requirement sources but add OAuth complexity | Mandatory after the GitHub Issues path is stable | V1.1 |
| CLI local review | Useful before a PR exists | Mandatory product surface, not a launch blocker | V1.1 |
| Slack notifications | Convenience over email | Nice to have | V1.1 |
| Autofix on fork pull requests | Requires a maintainer-owned branch and a stronger trust model | Later | V2 |
| Cross-repository context | Useful for shared libraries and services | Later, explicit allowlist only | V2 |
| Deep cross-service taint tracking | High utility but language-specific and framework-specific | Do not claim in V1 | V2 research |
| Team feedback learning | Reduces noise over time | Add only with transparent controls | V2 |
| GitLab and Bitbucket | Expands market, not required to prove core value | Later | V2 |
| Self-hosting and customer cloud | Enterprise procurement and code control | Enterprise roadmap | V3 |
| Automatic merge | Violates the trust boundary | Never | Excluded |

### Static-analysis licensing constraint (blocking, resolved in this revision)

v1.0 named Semgrep as a mandatory V1 component without addressing licensing. That is a legal blocker for a SaaS product:

- The Semgrep Community Edition engine is open source under LGPL 2.1, which is workable when the engine is invoked as a separate process and is not modified or statically linked.
- Semgrep-maintained registry rules are licensed under the Semgrep Rules License v1.0, which limits use to internal, non-competing, and non-SaaS contexts. Rules from third-party repositories in the registry carry their own licences, some of them AGPL-3.0.
- BuildIT is a SaaS code-review product, which is precisely the category those rule terms exclude.

**Required position for V1:** ship static analysis with (a) rules BuildIT authors itself, (b) third-party rule sets whose individual licences have been reviewed and permit SaaS redistribution, or (c) a commercial agreement with the vendor. Do not bundle vendor-maintained community rules by default. Legal sign-off on the chosen rule inventory is a launch gate, tracked as open decision OD-02.

Sources: [Semgrep licensing](https://semgrep.dev/docs/licensing), [Semgrep rules licence change](https://semgrep.dev/blog/2024/important-updates-to-semgrep-oss/).

---

## 5. Scope

### V1 launch scope

- GitHub Cloud repositories.
- GitHub App installation and GitHub OAuth login.
- Private and public repositories where the app is installed.
- TypeScript and JavaScript repositories using npm, pnpm, or yarn.
- Pull requests from branches in the same repository, with full review and Autofix.
- Pull requests from forks, with read-only review under the hardened execution model in section 7.7. Autofix is unavailable for fork pull requests in V1.
- GitHub Issues and repository or PR documentation as requirement context.
- Review on demand through `@buildit review`, a dashboard action, or repository automation rules.
- Autofix through `@buildit autofix` or a dashboard action.
- Stacked pull request delivery by default.
- Test, lint, type-check, build, static analysis, dependency, and secret scanning where configured or safely detected.
- Convex-backed state, events, settings, and metrics.
- Vercel-hosted Next.js control plane.
- Vercel Sandbox or an equivalent isolated microVM for repository execution. Vercel describes Sandbox as an ephemeral environment for untrusted and agent-generated code; the ordinary Edge runtime is a V8 isolate and is not the execution runner. [Vercel Sandbox](https://vercel.com/docs/sandbox), [Vercel Edge runtime](https://vercel.com/docs/functions/runtimes/edge).
- Anthropic and OpenAI BYOK through a provider-neutral model adapter.
- Cost accounting, per-review and per-organization budgets, and concurrency limits.
- Email notifications for decisions, failures, and budget events.
- One hosting region, stated explicitly to customers before their first review.

### V1.1 scope

- Linear and Jira OAuth connections.
- Local CLI review and autofix.
- Explicitly enabled direct pushes to the PR branch.
- Python repositories with PyTest, Ruff, mypy, and pip, uv, or Poetry detection.
- Scheduled automatic reviews and repository-level cost budgets.
- Slack notifications.
- Nested directory-scoped rules.

### V2 scope

- Autofix for fork pull requests.
- Cross-repository context with an explicit allowlist.
- Team feedback learning with transparent controls.
- GitLab and Bitbucket.
- Region selection.

### Explicitly out of V1

- Guaranteed bug-free or secure claims.
- GitHub Enterprise Server.
- Autofix on forked pull requests.
- Arbitrary languages.
- Cross-repository semantic indexing.
- Browser end-to-end testing unless the repository supplies a supported, noninteractive command and required test environment.
- Production deployment or merge.
- Autonomous architecture migrations.
- Self-hosting.
- Localisation of the product interface. English only in V1, stated on the marketing site.
- Any SOC 2 or ISO 27001 claim.

---

## 6. Roles, permissions, and trigger authorization

### Product roles

- **Organization owner:** manages billing, retention, integrations, repositories, and members.
- **Organization admin:** manages repositories, review policies, provider keys, issue trackers, and approval of repository configuration changes.
- **Developer:** starts reviews, requests approved fixes, views results, and provides feedback.
- **Viewer:** reads reviews and metrics but cannot start cost-bearing work or expose credentials.
- **BuildIT service:** performs only operations allowed by installation and repository policy.

### GitHub App permissions

GitHub Apps start with no permissions and should request the minimum required. HTTP Git access requires Contents permission. [GitHub permission guidance](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app).

Minimum V1 repository permissions:

- **Metadata:** read-only, implicit and required. This also covers the collaborator permission lookup used for trigger authorization.
- **Contents:** read for review-only installations; write only when Autofix is enabled.
- **Pull requests:** read and write, for reading PRs, reviews, and comments, and for opening stacked PRs.
- **Issues:** read and write, because PR issue comments use the Issues API.
- **Checks:** read, for existing CI results. Write only if BuildIT publishes a GitHub Check Run.
- **Commit statuses:** read. Write only if BuildIT publishes a status.
- **Workflows:** no access by default. Request only if editing workflow files is explicitly supported later.
- **Actions:** read only if BuildIT must inspect workflow runs or artifacts.

BuildIT must not request Administration permission for V1.

### Events

- `pull_request`: opened, reopened, synchronize, ready_for_review, converted_to_draft, closed.
- `pull_request`: `edited` as well, because the PR body carries requirements. An edited body marks requirement context changed and refreshes the requirements list; by default it does not start a full new review.
- `issue_comment`: created only. Edited and deleted comments are recorded but never trigger work.
- `pull_request_review_comment`: created only.
- `installation`, `installation_repositories`: created, deleted, suspend, unsuspend, added, removed.
- `repository`: renamed, transferred, deleted, archived.
- `push`: on the default branch only, and only when base-result warming or fix-reversion measurement is enabled.
- `check_suite` or `workflow_run`: only if CI reconciliation is enabled.

`merge_group` is not subscribed. Repositories using GitHub merge queues receive review on the pull request only, and BuildIT must not be configured as a merge-queue required check in V1. This is a stated limitation, not an assumption.

Rationale for the `push` subscription: v1.0 promised a fix-reversion trust metric and base-comparison regression classification, neither of which is measurable without observing default-branch history. Either subscribe or drop the metric. This revision subscribes.

### Trigger authorization model

- **REQ-205 P0 (new):** The command surface is `@buildit <verb> [flags]`. Supported verbs in V1: `review`, `autofix` (flags `stacked`, `push`), `cancel`, `status`, `help`. An unrecognised verb produces exactly one short reply listing valid verbs and starts no work.
- **REQ-206 P0 (new):** Only `issue_comment.created` and `pull_request_review_comment.created` may trigger work. Editing an existing comment to contain a command never triggers work, because edits are replayable by anyone with comment-edit rights and carry no fresh authorization signal.
- **REQ-207 P0 (new):** Comments authored by BuildIT's own app, by any other GitHub App, or by any account whose type is `Bot` never trigger work. A per-PR loop guard caps BuildIT-authored comments and check updates per hour; exceeding it pauses the repository and raises an operational alert.
- **REQ-208 P0 (new):** The trigger actor's permission is resolved server-side against GitHub, using the repository collaborator permission endpoint with the installation token. That endpoint is available to installation access tokens with Metadata read, so no Administration permission is required. The webhook payload's `author_association` is used only as a corroborating signal, never as the sole basis for authorization. Minimum permission to start a review or an Autofix is `write`. [GitHub collaborators API](https://docs.github.com/en/rest/collaborators/collaborators).
- **REQ-209 P0 (new):** Authorization is re-evaluated at each cost-bearing or write-bearing step, not only at trigger time, so that a permission revoked mid-job stops further work.

---

## 7. Product requirements

Priority labels: **P0** blocks a safe launch of the release the requirement belongs to; **P1** completes the expected product; **P2** is a later enhancement. Where a P0 requirement governs a feature that ships after V1, the release is stated inline, for example "P0 for V1.1". v1.0 marked V1.1 features as unqualified P0, which made the priority scheme unusable.

### 7.1 Setup and organization

- **REQ-001 P0:** Users authenticate with GitHub OAuth and join or create a BuildIT organization.
- **REQ-002 P0:** Setup guides an authorized user through GitHub App installation and repository selection.
- **REQ-003 P0:** BuildIT verifies installation permissions and shows missing permissions without pretending setup succeeded.
- **REQ-004 P0:** A setup health check validates GitHub access, model key, runner availability, and a repository's detected commands.
- **REQ-005 P1:** A repository can be paused without uninstalling the GitHub App.
- **REQ-006 P1:** Organization owners can invite, remove, and change member roles.
- **REQ-200 P0 (new):** An installation that GitHub reports as suspended puts every repository in that installation into a blocked state with a specific remedy, and does not silently queue work that can never run.
- **REQ-201 P0 (new):** Organization deletion removes members, credentials, repository links, and all source-derived data within the documented deletion window, and produces an auditable completion record.
- **REQ-202 P0 (new):** Repository rename and transfer are handled without losing history, because every internal lookup keys on the immutable GitHub repository ID rather than owner and name.

### 7.2 BYOK and provider management

- **REQ-010 P0:** Admins can add an Anthropic or OpenAI API key in BuildIT's dashboard.
- **REQ-011 P0:** The key is encrypted before persistence using authenticated encryption with a unique nonce, a key version, and envelope encryption under a master key held in a managed key service. The additional authenticated data binds the ciphertext to the organization ID, provider, and key version, so a ciphertext cannot be replayed into another tenant's record. The master key is not stored solely as a platform environment variable.
- **REQ-012 P0:** Plaintext keys exist only long enough to call the selected model API and are never sent to repository sandboxes, logs, analytics, or clients.
- **REQ-013 P0:** The UI displays provider, masked suffix, creator, creation date, last successful use, and current validation state.
- **REQ-014 P0:** Admins can replace and revoke a key. Revocation prevents new work immediately and cancels queued work that has not yet called the provider.
- **REQ-015 P0:** Master-key rotation supports decrypting old versions while new records use the latest version.
- **REQ-016 P0:** Invalid, exhausted, or rate-limited keys produce a clear blocked state without exposing provider response secrets.
- **REQ-017 P1:** Repository settings can select an allowed provider and model from an organization allowlist.
- **REQ-018 P0 (raised from P1):** Per-review and monthly model budgets stop work before uncontrolled spend. A budget with no enforcement is not a budget, and BYOK spends the customer's money, so this is a launch requirement rather than an enhancement.
- **REQ-019 P0:** GitHub Actions repository secrets are not used as remotely retrievable BYOK storage, because GitHub's API does not reveal secret values. [GitHub Actions secrets API](https://docs.github.com/en/rest/actions/secrets).
- **REQ-203 P0 (new):** Before the first key is saved, the UI states plainly that BYOK requests are sent to the customer's own provider account under that provider's terms and retention policy, and links to each provider's data-handling documentation.
- **REQ-204 P0 (new):** A provider key is validated with a minimal, non-billable-where-possible request on save and re-validated on a schedule, with the result surfaced in Integrations.

### 7.3 Repository configuration and the configuration trust model

- **REQ-020 P0:** BuildIT detects package manager, workspace structure, supported languages, and candidate commands without executing repository code.
- **REQ-021 P0:** An admin confirms or edits commands before Autofix is enabled.
- **REQ-022 P0 (revised):** Version-controlled `.buildit/` configuration overrides dashboard defaults, except organization security limits. Configuration is read from the **trusted revision**, defined in REQ-210, never from the pull-request head.
- **REQ-023 P0:** `.buildit/config.json` supports include and exclude paths, commands, per-command required or optional designation, timeouts, environment allowlist, network allowlist, Autofix mode, cost limits, severity thresholds, and trigger rules.
- **REQ-024 P0:** `.buildit/rules.md` holds repository-wide review rules, read from the trusted revision.
- **REQ-025 P1:** Nested `.buildit/` folders support directory-scoped rules with clear inheritance.
- **REQ-026 P0:** Configuration is validated against a published schema; invalid configuration blocks Autofix and identifies the exact field.
- **REQ-027 P0:** Protected paths such as workflows, infrastructure, migrations, lockfiles, generated files, and security policies require explicit human permission before modification.
- **REQ-210 P0 (revised in v1.2, critical):** The **trusted configuration revision** is the latest approved configuration revision for the repository, sourced from the repository's **trusted ref**. The trusted ref defaults to the protected default branch and can be changed only by an Admin, as an audited action. BuildIT never derives control input from the pull-request head, and never automatically trusts an arbitrary pull-request base branch. v1.1 said "the base branch commit of the pull request," which is unsafe: a pull request can target an unprotected feature branch that a contributor controls, including the branch BuildIT itself creates for a stacked delivery, so "base branch" does not mean "maintainer approved."
- **REQ-211 P0 (revised in v1.2):** When a pull request modifies any file under `.buildit/`, BuildIT runs with the trusted configuration revision, raises an informational finding that the configuration is changing, shows a diff of the effective settings, and states that the new configuration takes effect only after it is merged into the trusted ref, or after an Admin explicitly approves that revision in the dashboard.
- **REQ-212 P0 (new):** Organization security limits cannot be relaxed by any repository file. These are: Autofix enablement, direct-push enablement, protected-path list, network egress allowlist, resource ceilings, per-review and monthly spend ceilings, and retention policy. Repository files may only make these stricter.
- **REQ-213 P0 (new):** Each check declared in configuration is marked `required` or `optional`. Only required checks gate a passing result. A required check that cannot run produces `inconclusive`, never a pass, and never a silent skip.
- **REQ-214 P0 (new):** Blocking severity threshold is explicit. Default: Critical and High findings block. Configuration may raise the threshold but the floor is Critical, which can never be made non-blocking.
- **REQ-300 P0 (revised in v1.3):** Approving a configuration revision creates an immutable, content-addressed record with `approvedBy`, `approvedAt`, `contentHash`, and `provenance`. Approved revisions are never mutated. There are exactly three provenance values and they are shown to the user:
  - `protected_ref_merge`: the configuration was merged into a trusted ref whose protection BuildIT verified. The repository's own merge controls provided the approval.
  - `explicit_admin_approval`: a BuildIT Admin approved this revision in the dashboard.
  - `defaults_only`: the trusted ref carries no valid `.buildit/` configuration, so organization defaults apply.
  A merge into an unprotected ref is never approval. v1.2 treated any merge into the trusted ref as implicit approval, which assumed a protection that may not exist.
- **REQ-330 P0 (new in v1.3):** BuildIT verifies that the trusted ref is actually protected before treating a merge into it as approval. Verification uses the branch rules endpoint, which returns the active rules applying to a branch, including organization-level rulesets, and works with an installation token under Metadata read. Classic branch protection is readable only with Administration read, which BuildIT does not request, so it may be invisible to this check. Therefore:
  - Rules found and adequate: protection is `verified`, and merges into the ref carry `protected_ref_merge` provenance.
  - No adequate rules found: protection is `unverified`. Merges are not treated as approval, every configuration change requires `explicit_admin_approval`, and the dashboard offers a one-click path to enable protection or to acknowledge the unverified state.
  BuildIT states which of the two applies rather than assuming the safe case. [GitHub branch rules endpoint](https://docs.github.com/en/rest/repos/rules), [GitHub branch protection endpoint](https://docs.github.com/en/rest/branches/branch-protection).
- **REQ-331 P0 (new in v1.3):** "Adequate" protection for this purpose means, at minimum, that direct pushes are restricted and that changes arrive through pull requests. The exact rule set BuildIT accepts is configuration, published in the documentation, and evaluated identically for every repository, so the answer to "why did BuildIT ask me to approve this" is always inspectable.
- **REQ-301 P0 (new in v1.2):** When a pull request's base is not the trusted ref, which is normal for stacked pull requests and feature-branch pull requests, the review still runs, configuration still comes from the trusted ref, and the summary names the ref and commit that supplied the configuration. The reader should never have to guess which rules were applied.
- **REQ-302 P0 (new in v1.2):** BuildIT does not automatically review pull requests it opened itself. A maintainer may trigger a review of a stacked pull request manually, and the same trusted-ref rule applies. Without this, a stacked delivery would trigger a review whose base branch is a BuildIT-created branch, which is both a cost loop and a trust-boundary confusion.
- **REQ-303 P0 (new in v1.2):** If the trusted ref contains no valid `.buildit/` configuration, BuildIT runs on organization defaults, marks configuration provenance as `defaults_only`, and says so in the report rather than silently inventing a policy.

### 7.4 Review initiation, concurrency, and queueing

- **REQ-030 P0:** Reviews start from `@buildit review`, a dashboard action, or a configured automatic trigger.
- **REQ-031 P0:** Autofix starts only from `@buildit autofix`, a dashboard action by an authorized user, or an explicit repository automation policy.
- **REQ-032 P0:** `@buildit autofix stacked` forces isolated stacked-PR delivery.
- **REQ-033 P0:** Every job stores the repository, PR number, base commit, head commit, trusted configuration revision, trigger actor, trigger source, and provider and model selection.
- **REQ-034 P0:** GitHub webhook receipt is acknowledged within 10 seconds after signature verification and durable enqueueing; processing happens asynchronously. GitHub recommends a 2XX response within 10 seconds. [GitHub webhook handling](https://docs.github.com/en/webhooks/using-webhooks/handling-webhook-deliveries).
- **REQ-035 P0:** GitHub delivery IDs make webhook handling idempotent, meaning the same delivery cannot create duplicate jobs.
- **REQ-036 P0:** Only one active review may own a given PR head commit and mode. Repeated triggers attach to or report the existing job.
- **REQ-215 P0 (new):** Draft pull requests are not automatically reviewed by default. A manual trigger always works, and `ready_for_review` starts a review when automatic triggers are enabled.
- **REQ-216 P0 (new):** `pull_request.closed` cancels active work for that pull request, destroys the sandbox, and leaves the last published result in place marked as closed.
- **REQ-217 P0 (new):** Rapid consecutive pushes to the same pull request are debounced. BuildIT waits for a configurable quiet period, default 60 seconds, and then reviews only the latest head. Superseded heads are recorded, never reviewed, and never billed.
- **REQ-218 P0 (new):** Concurrency is bounded per organization and per repository, with configurable ceilings and a visible `queued` position. Human-triggered reviews are ordered ahead of automatic ones. When the queue depth ceiling is reached, new triggers receive an explicit "queue full, try again" response rather than being silently dropped.
- **REQ-219 P0 (new):** BuildIT tracks GitHub API budget per installation, since installation rate limits are shared across all repositories in that installation, and applies proactive backoff before exhaustion rather than reacting to 403 and 429 responses.
### 7.5 Context acquisition

- **REQ-040 P0:** BuildIT reads the PR title, body, diff, commits, review threads, labels, base and head metadata, and repository configuration.
- **REQ-041 P0:** It extracts supported issue links and explicit issue keys from the PR body and branch name.
- **REQ-042 P0:** GitHub Issue context includes title, body, acceptance criteria, labels, and linked child issues the installation can access.
- **REQ-043 P0 for V1.1:** Linear and Jira context is fetched only through an authorized OAuth connection and with read-only scopes.
- **REQ-044 P0:** If no issue is linked, review continues using the PR description and reports reduced requirements confidence.
- **REQ-045 P0:** If issue context is inaccessible or conflicting, the report states that limitation; it does not invent intent.
- **REQ-046 P0:** Retrieval begins with changed symbols and expands to callers, callees, tests, types, configuration, schemas, and relevant documentation.
- **REQ-047 P0:** The final report lists inspected and materially skipped areas. BuildIT does not claim it read an entire repository unless it did.
- **REQ-310 P0 (revised in v1.3):** `coverageLevel` describes coverage of the **affected review scope**, never of the whole repository and never of every file the include rules permit. The affected review scope is the changed files plus the context the retrieval stage determined to be affected: callers, callees, tests, types, schemas, and configuration touching the change. `full` means every requirement source resolved, every element of the affected review scope retrieved within budget, and every required check executed against the reviewed commit. `partial` means scope or budget forced exclusions, or an optional check did not run, with the exclusions enumerated. `limited` means no resolvable requirement source, or required checks could not run. BuildIT never states or implies that it understood the entire repository, and `full` is never read as a claim about the repository.
- **REQ-048 P1:** Repository indexes are commit-aware and incrementally refreshed after pushes.
- **REQ-049 P0:** All external text and source content is marked as untrusted data and cannot alter system permissions, budget, merge boundary, or tool policy.
- **REQ-220 P0 (new):** Context assembly operates under an explicit token budget per stage. When the relevant context exceeds the budget, BuildIT selects by relevance, records exactly which files and symbols were included and excluded, and reports reduced coverage rather than silently truncating.
- **REQ-221 P0 (new):** Excluded paths from configuration are enforced at the retrieval layer, so excluded content is never placed in a prompt, never written to an artifact, and never quoted in a finding.
- **REQ-222 P0 (new):** Requirement records pin the fetched version and fetch timestamp of every external ticket, so a ticket edited mid-review is detectable and reportable.

### 7.6 Review and findings

- **REQ-050 P0:** The review evaluates requirement coverage, correctness, regression risk, error handling, concurrency where relevant, security, dependencies, tests, compatibility, and repository rules.
- **REQ-051 P0:** Findings use severities: Critical, High, Medium, Low, and Info.
- **REQ-052 P0:** Each finding includes a stable fingerprint, title, category, severity, confidence, file and line when applicable, impact, evidence, requirement or rule link, and recommended action.
- **REQ-053 P0:** A Critical finding represents a credible path to severe data loss, unauthorized access, secret exposure, remote code execution, or major outage. Severity is not chosen merely to attract attention.
- **REQ-054 P0:** Duplicate findings from the model, scanners, and existing review threads are merged while preserving all evidence sources.
- **REQ-055 P0:** Findings without enough evidence are labeled uncertain and cannot alone produce a passing or failing status.
- **REQ-056 P0:** Previously dismissed findings remain suppressed on unchanged code unless new evidence appears.
- **REQ-057 P1:** Developers can mark findings helpful, incorrect, accepted risk, or resolved, with an optional reason.
- **REQ-058 P0:** The report provides an evidence summary, not private model reasoning or hidden chain-of-thought.
- **REQ-225 P0 (new):** Confidence is a defined three-point scale, not a free-form number.
  - `high`: supported by an executed command result, a scanner result, or a directly quoted code path that demonstrates the claim.
  - `medium`: supported by code reading with a clear mechanism, but no executed evidence.
  - `low`: pattern or heuristic only.
  Only `high` and `medium` findings may block. `low` findings are informational and never contribute to a failing status.
- **REQ-226 P0 (new):** The finding fingerprint is computed from normalised rule identity, normalised code context, and path, so that it survives line-number drift and unrelated edits. Fingerprint stability is tested, because suppression correctness depends entirely on it.
- **REQ-227 P0 (new):** Suppression scope is explicit at dismissal time: this commit, this pull request, this path, or this repository. Dismissals record actor, timestamp, scope, and optional reason.
- **REQ-228 P0 (new):** Incremental review scope is defined as the diff between the last reviewed head and the current head, plus context affected by that diff, plus a re-run of all required checks. Findings from the prior head are carried forward with an explicit status of resolved, unchanged, or changed.

### 7.7 Execution, isolation, and untrusted-code handling

- **REQ-060 P0:** Repository code runs only in a fresh isolated sandbox, never in the web application or Convex process.
- **REQ-061 P0:** The sandbox receives a short-lived repository token with the minimum access required for that stage, and only in the stages that require it.
- **REQ-062 P0:** Model provider keys, Convex credentials, Vercel credentials, webhook secrets, master encryption keys, and production credentials never enter the sandbox.
- **REQ-063 P0:** Network egress is denied by default during test execution. Dependency installation uses an explicit allowlist and a separate stage.
- **REQ-064 P0:** CPU, memory, disk, process count, command duration, total job duration, and output size are limited.
- **REQ-065 P0:** Commands execute as argument arrays without shell string interpolation.
- **REQ-066 P0:** Only approved commands from the trusted-revision configuration or a narrowly defined detector may run automatically.
- **REQ-067 P0:** Every command records sanitized command identity, start and end time, exit code, timeout state, and redacted output.
- **REQ-068 P0:** Output is scanned for credentials and sensitive values before storage or model use.
- **REQ-069 P0:** V1 checks include configured tests, lint, type-check, build, static-analysis rules, dependency audit, and secret scan, each marked required or optional per REQ-213.
- **REQ-070 P0:** Missing tools, unsupported checks, and environmental failures remain distinct from code failures.
- **REQ-071 P0:** A passing BuildIT result requires at least one configured executable validation command plus every check marked required. A repository with no runnable validation receives `inconclusive`, never a pass.
- **REQ-072 P1 (revised in v1.3):** Flaky-test detection reruns a failing test once without an edit when the command supports targeted reruns. A diagnostic rerun is not a patch, so it consumes neither an Autofix round nor a patch attempt. It consumes the diagnostic-run counter and, like everything else, wall-clock and spend. v1.2 charged it against the patch-attempt budget, which was wrong once an attempt was defined as a proposed patch.
- **REQ-230 P0 (revised in v1.2, critical, untrusted-content execution model):** The control plane never unpacks, parses, or executes repository content. Preparation and execution are separate isolated runner stages, and this model applies to every repository, not only forks:
  1. **Fetch stage.** An isolated runner receives a short-lived, minimally scoped GitHub token, clones the exact base and head commits, and writes a workspace snapshot. No repository command runs in this stage.
  2. **Credential teardown.** The token is removed from the environment, git remote credentials and credential helpers are stripped from the snapshot, and the installation token is explicitly revoked through GitHub's token-revocation endpoint. Teardown completion is recorded as an event, and execution cannot start without it.
  3. **Execution stage.** A fresh sandbox boots from the snapshot holding no GitHub token, no provider key, and no control-plane credential.
  v1.1 placed cloning in the control plane, which put attacker-controlled archive extraction inside the trusted tier. This closes both that hole and the standard "pwn request" pattern.
- **REQ-335 P0 (new in v1.3):** "The control plane never handles repository content" is only true if something else does, because model calls must be assembled from source. The trusted tier is therefore split into two services with different privileges:
  - **Control plane:** users, organizations, authorization, state, orchestration, billing, and metadata. It never reads repository content, and no code path gives it that ability.
  - **Content broker:** a narrow, short-lived service that reads approved artifacts, applies redaction and exclusion rules, assembles model requests, calls the provider, and returns structured results to the control plane. It holds no GitHub write token, no administrative database credential, and no long-term storage. Its inputs are artifact references and its outputs are structured findings and patches.
  v1.2 asserted a boundary that its own architecture contradicted, since model calls originate in the trusted tier and require source. Naming the broker makes the claim testable: the assertion to verify is that the control plane holds no path to source content, not the impossible claim that no trusted service ever reads it.
- **REQ-336 P0 (new in v1.3):** The content broker is treated as a blast-radius boundary. It is separately deployed, separately credentialed, has its own egress allowlist limited to the model providers, and its access to artifacts is scoped per review and expires with the job.
- **REQ-304 P0 (new in v1.2):** Delivery, meaning branch push and stacked-PR creation, happens in a separate stage that runs no repository code and mints a fresh short-lived token for that operation alone. Execution and delivery never share a credential or a process.
- **REQ-305 P0 (new in v1.2):** Installation tokens are re-minted per stage rather than held for the life of a job. No stage holds a credential longer than the stage needs it, which also removes the class of failure where a long Autofix job outlives its token.
- **REQ-231 P0 (new):** For fork pull requests, the executable command set comes from the trusted revision only, automatic triggers are off by default, and a maintainer with write access must trigger the run. Autofix is unavailable.
- **REQ-232 P0 (revised in v1.2):** Dependency installation uses lockfile-respecting, non-resolving modes by default: `npm ci`, `pnpm install --frozen-lockfile`, or `yarn install --immutable`. Lifecycle and postinstall scripts are disabled by default, but a blanket repository-wide switch is not acceptable, because native modules and code generators legitimately need to build. The control is a reviewed per-package build-script allowlist entry bound to package name, exact version, and the lockfile integrity hash for that version. A name-only allowlist would let a later compromised version of an already-approved package execute, which is precisely the supply-chain event the control exists to stop. A version bump requires re-approval, and the report says so rather than failing silently. Entries are changed only by an Admin and recorded in the audit log. Every skipped script is listed in the report with the package that requested it, so the remedy is one click rather than a global override.
- **REQ-233 P0 (new):** No process inside the sandbox may call a model provider. All model calls originate from the control plane. The sandbox has no route to the provider and no key to use if it did.
- **REQ-234 P0 (new):** The sandbox timeout is always set explicitly at creation. BuildIT never relies on the platform default, which is short. Total review wall-clock, total sandbox lifetime, and per-command timeouts are separate limits, all enforced and all reported.
- **REQ-235 P0 (new):** Sandbox lifetime is a design constraint, not an assumption. Vercel Sandbox instances are ephemeral, default to a 5-minute timeout, and are capped by plan, so a multi-round Autofix job may outlive a single sandbox. BuildIT either keeps a sandbox alive with an explicit long timeout for the whole job, or re-provisions and re-installs deterministically between rounds. Whichever is chosen, the cost and the elapsed time are recorded and counted against the budget. [Vercel Sandbox](https://vercel.com/docs/sandbox).
- **REQ-236 P0 (revised in v1.2):** Base-comparison results are cached with the key (repository ID, base commit, command fingerprint, configuration revision, runner image version, resolved tool and scanner versions, CPU architecture, network-policy version) and a bounded TTL. Any change in that tuple is a cache miss. A cache keyed only on commit, command, and configuration would serve results produced by a different toolchain and quietly corrupt regression classification. Regression classification requires a base result from this cache or a fresh base execution; when neither is available, the finding is labeled "pre-existing status unknown" and is excluded from the caught-regression metric.
- **REQ-237 P1:** Base results for the default branch are warmed on default-branch pushes, subject to budget, so most reviews avoid a synchronous base run.

### 7.8 Autofix convergence and bounds

- **REQ-080 P0:** Autofix operates on an agent branch created from the exact reviewed PR head.
- **REQ-081 P0 (revised in v1.2):** A round is one proposed edit set followed by execution of the required validation commands affected by that change. Intermediate rounds may run the affected subset, which is what makes the loop affordable.
- **REQ-082 P0:** An edit that is not followed by validation is not a completed round. It may be retried within the attempt budget but cannot be reported as successful.
- **REQ-083 P0:** At most three completed Autofix rounds are allowed per review.
- **REQ-084 P0:** Infrastructure failures and provider retries are tracked separately and cannot reset or increase the three-round cap.
- **REQ-085 P0:** Each round is also bounded by path, file-count, line-count, time, and cost limits.
- **REQ-086 P0:** The model may use `read_file`, `search_code`, `inspect_context`, `propose_patch`, and `request_validation`; it has no general-purpose production shell.
- **REQ-087 P0:** Patch application rejects binary changes, submodule changes, paths outside the repository, and protected paths without explicit authorization.
- **REQ-088 P0:** After each patch, the orchestrator, not the model, chooses and runs required validation.
- **REQ-089 P0 (revised in v1.2):** Delivery requires a full final validation. Before a candidate can reach `delivered`, every required check in the effective configuration must have executed against the final candidate commit and passed. A subset run is never sufficient for delivery. If any required check cannot execute against the final commit, the candidate is reported `inconclusive` and is never described as validated. The final full run is recorded as a distinct `final_validation` marker with its own check rows, so the evidence for delivery is unambiguous and cannot be confused with an intermediate subset.
- **REQ-090 P0 (revised in v1.3.1):** There is exactly one unsuccessful terminal status caused by Autofix repetition or time bounds: `failed_after_bounds`. The record carries `terminationBound`, one of `round_limit`, `attempt_limit`, `wall_clock_limit`, `repeated_patch`. A spend ceiling ends as `budget_exhausted` and records its ceiling and consumption; it never uses `terminationBound`. `Failed after three rounds` is display text used only when `terminationBound = round_limit`. BuildIT lists unresolved failures grouped by severity and type and never updates the source PR branch.
- **REQ-091 P0 for V1.1:** Direct-push mode requires repository opt-in and authorized user confirmation. Before pushing, BuildIT verifies the source head has not moved.
- **REQ-092 P0:** Default delivery is a stacked PR targeting the original PR branch.
- **REQ-093 P0:** BuildIT never force-pushes, rebases, merges, or changes the protected base branch.
- **REQ-094 P0:** Commit messages and PR bodies are sent as data through GitHub APIs or Git argument arrays; here-documents are not treated as a security boundary.
- **REQ-245 P0 (new, closes the unbounded-attempt loophole):** The Autofix loop stops at whichever bound binds first:
  - three completed rounds, or
  - six patch attempts in total, counting applied, rejected, empty, and repeated patches, but not diagnostic reruns or infrastructure retries, or
  - the Autofix wall-clock limit, or
  - the Autofix spend limit, or
  - two attempts producing the same patch fingerprint.
  v1.0 excluded empty patches, rejected patches, and unvalidated edits from the round count without capping them separately, which permitted an unbounded loop that never completed a round.
- **REQ-246 P0 (revised in v1.3):** Every Autofix job records five independent counters, and the terminal report names which one ended the loop:

  | Counter | Ceiling | What increments it |
  |---|---|---|
  | `completedRoundCount` | 3 | A patch applied and followed by validation |
  | `patchAttemptCount` | 6 | Any proposed patch, including rejected, empty, and repeated |
  | `diagnosticRunCount` | configured | Flaky-test reruns and other non-editing diagnostics |
  | `providerRetryCount` | configured | Model provider retries after 429 or 5xx |
  | `commandRetryCount` | configured | Infrastructure retries of a validation command |

  All five consume wall-clock and spend budgets. Only proposed patches consume patch attempts, and only validated patches consume rounds. Conflating them, as v1.2 did, would let a flaky test suite exhaust the repair budget without a single bad patch being written.
- **REQ-247 P0 (new):** When a candidate patch increases the count of blocking findings or breaks a previously passing required check, the workspace is restored to the previous round's snapshot before the next attempt.
- **REQ-248 P0 (new):** The Autofix requester must hold write access at request time and must not be a bot account. The PR author has no implicit authority to trigger Autofix on a repository where they lack write access.

### 7.9 Results and the GitHub experience

- **REQ-100 P0:** BuildIT creates one continuously updated summary comment per review rather than posting a new summary on every step.
- **REQ-101 P0:** Confirmed findings appear as inline review comments only when a stable changed-line position exists; other findings remain in the summary.
- **REQ-102 P0:** The summary shows status, exact commit, requirement coverage, check matrix, findings by severity, Autofix rounds, changed files, remaining risk, and next action.
- **REQ-103 P0:** Status wording is factual: `Checks passed`, `Changes requested`, `Inconclusive`, `Stale`, `Failed after three rounds`, `Cancelled`, `Blocked`, or `Platform failed`. Never "bug-free" or "secure."
- **REQ-104 P0:** When the PR head changes, the existing result becomes visibly stale and any configured incremental review starts against the new head.
- **REQ-105 P0 (revised in v1.3):** BuildIT publishes a GitHub Check whose conclusion is derived from the normative matrix below, not from ad-hoc mapping in configuration. The Check Run is created at trigger time so that work in progress is visible. The matrix is the single source of truth; any flow, edge case, or UI copy that disagrees with it is a defect in that text.

  **Normative status to GitHub Check conclusion matrix**

  | BuildIT status | `advisory` (default) | `fail_open` | `fail_closed` |
  |---|---|---|---|
  | `checks_passed` | success | success | success |
  | `changes_requested` | failure | failure | failure |
  | `inconclusive` | neutral | neutral | failure |
  | `delivered` | success | success | success |
  | `failed_after_bounds` | failure | failure | failure |
  | `blocked` | action_required | action_required | action_required |
  | `budget_exhausted` | action_required | action_required | action_required |
  | `cancelled` | action_required | action_required | action_required |
  | `platform_failed` | neutral | neutral | failure |

  Two rules explain every cell. First, GitHub treats success, neutral, and skipped as satisfying a required check, so neutral is a fail-open outcome and is used only where the organization has chosen availability over gating. Second, anything a human must act on publishes `action_required`, which does not satisfy a required check, so neither cancellation nor a budget stop can be used as a merge bypass. Every conclusion is accompanied by summary text naming the commit and the reason.
- **REQ-106 P0:** Passing BuildIT checks cannot approve or merge the PR.
- **REQ-107 P1:** Replies to findings support `explain`, `dismiss`, `fix`, and `recheck` actions with authorization checks.
- **REQ-250 P0 (revised in v1.2):** GitHub writes are classified, because a blanket prohibition on writing after the head moves leaves an in-progress Check hanging forever.
  - **Commit-sensitive writes** (branch push, stacked-PR creation, new or updated findings, pass or fail check conclusion, requirement-coverage claims) require a head compare-and-swap immediately before the write and are aborted if the head has moved.
  - **Reconciliation writes** (marking a prior summary stale, concluding an orphaned in-progress Check, linking to the replacement review, publishing a cancellation notice) are permitted and required after a head change. They must name the old commit SHA explicitly and must never assert a current pass or fail for the new head.
  No third class exists. Every write is one or the other, and the classification is a property of the operation in code, not a judgement call at runtime.
- **REQ-306 P0 (new in v1.2):** A watchdog reconciles orphaned GitHub state. Any BuildIT Check left in progress beyond a defined threshold is concluded with a reconciliation write that names its commit and states that the review did not complete. GitHub must never show a BuildIT check running indefinitely, and the reconciliation lag is an operational metric with an alert.
- **REQ-251 P0 (new):** Published output respects GitHub payload limits. Comment bodies, check output text, and annotation batches are sized to the platform's documented maxima, annotations are batched, and any overflow is moved to the dashboard behind a link with the truncation labeled. Exact current limits are verified during implementation and encoded as constants with tests.
- **REQ-252 P0 (revised in v1.2):** Required-check behaviour is an explicit repository policy, because GitHub treats `success`, `neutral`, and `skipped` as satisfying a required status check. A neutral conclusion is therefore a fail-open outcome, and v1.1 published neutral on both platform failure and cancellation, which meant a BuildIT outage silently stopped gating and an authorized developer could cancel BuildIT to bypass the gate. Policies:
  - `advisory` (default, and the only policy offered at launch): BuildIT should not be configured as a required check. Conclusions are informational. The dashboard warns loudly if the check is configured as required while the policy is advisory.
  - `fail_open`: platform failure publishes `neutral` with prominent text stating that BuildIT did not evaluate this commit. Merges proceed. The organization has chosen availability over gating.
  - `fail_closed`: platform failure publishes `failure`. A BuildIT outage blocks merges. The organization has chosen gating over availability and is told so at the point of configuration.

  `advisory` is the V1 default and `fail_closed` is deferred to V1.1, gated on measured control-plane availability meeting the objective in section 17 over a sustained period. Offering a policy that can block every merge in an organization before availability has been measured would be selling a promise BuildIT has no evidence it can keep.
  Cancellation never publishes `neutral` under any policy. It publishes `action_required`, which does not satisfy a required check, so cancellation can never be used as a merge bypass. [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
- **REQ-253 P1:** The summary comment includes a one-line, copy-safe verdict at the top for reviewers who read only the first line.

### 7.10 Dashboard and product experience

- **REQ-110 P0:** The dashboard contains Review Queue, Review Detail, Repositories, Integrations including Provider Keys, Policies, Metrics, Usage, Members, and Audit Log.
- **REQ-111 P0:** Review Queue prioritizes items needing human action rather than vanity metrics.
- **REQ-112 P0:** Review Detail has one focal element: the decision header showing status, exact commit, confidence limits, and next action.
- **REQ-113 P0:** Review progress is a stage timeline: queued, context, analysis, validation, Autofix rounds, delivery, complete.
- **REQ-114 P0:** Logs stream through confirmed Convex records. Optimistic UI is limited to immediate acknowledgement of user actions, never fabricated test output.
- **REQ-115 P0:** Every view supports loading, empty, permission-denied, error, stale, disconnected, and partial-data states.
- **REQ-116 P0 (revised):** Keyboard access, visible focus, semantic HTML, screen-reader labels, reduced motion, and WCAG 2.2 AA contrast are required. Interactive targets meet WCAG 2.2 AA target size at minimum, and BuildIT additionally adopts a 44 by 44 CSS pixel target as its own product standard. v1.0 attributed the 44 pixel figure to WCAG AA; the AA success criterion is smaller and 44 by 44 is the AAA enhanced criterion, so the two must not be conflated in a document engineering will cite.
- **REQ-117 P0:** Desktop is the primary work surface. Mobile supports monitoring, cancellation, and result reading; complex policy editing may direct users to desktop.
- **REQ-118 P0:** Destructive actions such as key revocation, repository disconnect, and artifact deletion require confirmation and explain the consequence.
- **REQ-119 P1:** A command palette offers fast navigation and safe actions.
- **REQ-255 P0 (new):** A Usage view shows, per organization and per repository, model spend, sandbox compute, review counts, and budget consumption against the current period, with the exact period boundaries displayed.

### 7.11 CLI

- **REQ-120 P0 for V1.1:** `buildit configure` stores provider choice and optionally uses OS keychain storage; environment variables override local configuration.
- **REQ-121 P0 for V1.1:** `buildit review [--dir path] [--base ref]` reviews local committed and uncommitted changes without uploading unrelated files.
- **REQ-122 P0 for V1.1:** `buildit autofix [--dir path]` uses the same bounded state machine, including all five bounds in REQ-245.
- **REQ-123 P0 for V1.1:** `--dir` is enforced on reads and writes, not treated as a prompt suggestion.
- **REQ-124 P0 for V1.1:** Local mode executes approved commands locally only after displaying the detected command plan and obtaining consent on first use.
- **REQ-125 P0 for V1.1:** Remote mode uploads a minimal encrypted workspace to an isolated sandbox and explains retention before upload.
- **REQ-126 P1:** Output supports human-readable, JSON, and CI-friendly formats with stable exit codes.
- **REQ-127 P0 for V1.1:** Cancellation handles interrupt signals, cleans temporary credentials, preserves local user changes, and reports whether a remote job remains active.
- **REQ-256 P0 for V1.1 (new):** The CLI reads configuration from the checked-out trusted revision and refuses to apply `.buildit/` changes present only in the working tree unless the user passes an explicit flag acknowledging that local configuration is being trusted.
- **REQ-257 P0 for V1.1 (new):** The CLI never writes to the user's working tree unless Autofix was explicitly requested, and it never creates commits or pushes without explicit confirmation.

### 7.12 Reliability, retries, and lifecycle

- **REQ-130 P0:** The job is a durable workflow with persisted stage transitions, retry counts, and idempotent side effects. Convex documents durable scheduling and workflow components for long-running flows. [Convex scheduling](https://docs.convex.dev/scheduling/overview).
- **REQ-131 P0:** Provider 429 and transient 5xx responses use exponential backoff with jitter, a maximum attempt count, and the provider's `Retry-After` where present.
- **REQ-132 P0:** GitHub and issue-tracker retries follow the same bounded policy for retryable failures.
- **REQ-133 P0:** Anthropic client tool calls preserve assistant blocks and pair every `tool_use` with its matching `tool_result`. [Anthropic tool-use loop](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works).
- **REQ-134 P0:** Strict tool schemas set `strict: true`, use the supported JSON Schema subset, and set `additionalProperties: false` on objects. Strict mode guarantees schema-shaped tool input, not correct engineering judgment. [Anthropic strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use).
- **REQ-135 P0:** Users can cancel queued or active work. Cancellation prevents future rounds and branch delivery, then destroys the sandbox.
- **REQ-136 P0:** A watchdog marks abandoned jobs and releases locks.
- **REQ-137 P0:** Side effects such as posting a comment, creating a branch, or opening a PR use stable idempotency records to avoid duplicates after retries.
- **REQ-258 P0 (new):** REQ-133 and REQ-134 are provider-specific conformance rules held in a per-provider adapter annex, not in the core contract. The core contract requires only: schema-validated tool input, a preserved and replayable message history, and explicit handling of refusal, truncation, and malformed output. v1.0 claimed provider neutrality while writing Anthropic message semantics into core P0 requirements.

### 7.13 Privacy, retention, and governance

- **REQ-140 P0:** Repository snapshots exist only inside ephemeral execution storage and are destroyed on completion, cancellation, or timeout.
- **REQ-141 P0:** Source-derived records, including diffs, names, graphs, snippets, and logs, are classified and encrypted.
- **REQ-142 P0:** Default source-derived retention is 24 hours; admins may choose immediate deletion or up to seven days.
- **REQ-143 P0:** Metadata and redacted audit events may be retained according to account policy.
- **REQ-144 P0:** Deletion cascades across logs, artifacts, indexes, model caches controlled by BuildIT, and backups according to a documented deletion window.
- **REQ-145 P0:** Raw test output and model prompts are not used for model training by BuildIT.
- **REQ-146 P0:** The product exposes subprocessors and provider data-handling links before a key is used.
- **REQ-147 P0:** Audit events record actor, action, organization, repository, PR, commit, result, timestamp, and request ID without plaintext secrets.
- **REQ-148 P0:** BuildIT must not claim SOC 2 or ISO 27001 compliance until independently audited and certified. Retention features alone do not establish compliance.
- **REQ-149 P1:** Organization admins can export audit events and request organization deletion.
- **REQ-260 P0 (revised in v1.2):** Suppression state must outlive source-derived retention, otherwise every dismissed finding returns after 24 hours and the product becomes unusable. Finding fingerprints are stored as keyed HMACs computed with a per-organization key held in the managed key service, not as salted hashes, because a salt stored beside the value does not resist guessing against a small, enumerable space of file paths and rule identifiers. The key is never exposed to a client. Rotating it invalidates existing suppressions, since the original content is gone and cannot be re-derived, so rotation is an explicit, warned admin action and not a routine schedule.
- **REQ-307 P0 (new in v1.2):** Source-derived content is not stored inline in the transactional database. Convex holds identifiers, statuses, counts, timestamps, and artifact references. Every piece of source-derived content, meaning configuration snapshots, requirement statements, finding titles and impact text, evidence excerpts, review-event public messages, command lines, base-result output, and patches, lives in an encrypted object-storage artifact carrying `expiresAt`. Deleting the artifact is what deletes the content. v1.1 declared that all source-derived records carry `expiresAt` while several entities stored source-derived text inline with no expiry, so the retention promise was not implementable from the schema.
- **REQ-308 P0 (new in v1.2):** Where a small amount of source-derived text must be denormalised into the transactional database for query performance, that field is explicitly marked in the schema, carries its own `expiresAt`, and is nulled by the expiry job. The retention test enumerates every such field, so the list cannot drift silently as the schema grows.
- **REQ-309 P0 (new in v1.2):** Prompts sent to the customer's own model provider under BYOK are retained according to that provider's policy and are outside BuildIT's deletion control, in the same way as content published to GitHub. This is stated before the first key is saved.
- **REQ-261 P0 (new):** Content BuildIT writes into GitHub, meaning comments, check output, branches, and pull requests, lives in the customer's repository and is outside BuildIT's retention control. BuildIT states this before the first review and does not imply that its retention setting deletes data already published to GitHub.
- **REQ-262 P0 (new):** A Data Processing Addendum is available, the subprocessor list is published and versioned, and customers receive notice before a new subprocessor is added.
- **REQ-263 P0 (new):** The hosting region for the control plane, sandboxes, and artifact storage is stated explicitly in the product and in the security documentation. Region selection is a V2 feature; V1 states one region honestly instead of implying choice.
- **REQ-264 P0 (new):** A published security contact and vulnerability disclosure policy exist before public launch, with a documented triage commitment.

### 7.14 Reporting and metric definitions

- **REQ-150 P0:** Metrics are derived from immutable events, not mutable current review rows.
- **REQ-151 P0:** "PR reviewed" means a unique repository, PR number, and head commit reached a terminal review state.
- **REQ-152 P0 (revised):** "Regression caught" means a required check failed on the reviewed head and a cached or freshly executed base result per REQ-236 shows that the same check passed on the base, or a confirmed requirement violation was accepted by a human. These two sources are reported separately. Where no base result exists, the outcome is "pre-existing status unknown" and is excluded from the metric.
- **REQ-153 P0:** "Autonomous fix applied" means BuildIT produced a commit containing a patch that a human subsequently merged. Opened but unmerged patches are counted as delivered, never as applied.
- **REQ-154 P0:** Round-pass counts record the first completed round whose final required checks all passed.
- **REQ-155 P0:** Weekly reporting uses the organization's timezone and a displayed start and end timestamp, not the ambiguous phrase "since Sunday."
- **REQ-156 P1:** Noise metrics include finding acceptance, dismissal, duplicate, and reopened rates.
- **REQ-157 P1:** Product metrics include median review duration, runner failure rate, provider failure rate, stale-review rate, and human time to merge.
- **REQ-265 P0 (new):** Fix reversion is measured by observing default-branch history for reverts or reversals of a merged BuildIT commit within 7 and 30 days. This requires the `push` subscription in section 6. If that subscription is not enabled for an organization, the reversion metric is reported as unavailable for that organization rather than as zero.
- **REQ-266 P0 (new):** Every review records model token usage, model spend, sandbox seconds, vCPU-minutes, artifact bytes, prompt version, evaluation-set version, and model version. v1.0 required version recording in the model policy but provided no field to record it in.

### 7.15 Notifications

- **REQ-270 P0 (new):** Once a transactional-email provider is connected and production-proven, BuildIT sends an email notification for: a review that finished and needs a human decision, an Autofix delivery, an Autofix failure after the final bound, a budget threshold crossing at 80 percent and 100 percent, an invalid or revoked provider credential, a suspended installation, and a failed retention-deletion job. Each recipient is the exact active BuildIT member whose email address was separately verified and who explicitly opted in inside that organization. The GitHub App owner, installation account, organization owner, PR author, or another member is never used as a fallback recipient. Until the provider and recipient verification are live, no customer email is sent and the UI says `Not connected`.
- **REQ-271 P0 (new):** Notifications contain status, repository, pull request, commit, and a link. They never contain source code, diffs, log output, finding evidence, or secrets.
- **REQ-272 P1:** Per-user, per-organization notification preferences, including explicit email opt-in, digest mode, and per-repository muting. Delivery rechecks active membership, current address verification, consent, repository scope, and muting immediately before sending; the browser never supplies the recipient address.
- **REQ-273 P1:** Slack delivery for the same event set, added in V1.1.

### 7.16 Cost, budgets, and commercial enforcement

- **REQ-275 P0 (new):** Every cost-bearing action is attributed to an organization, repository, review, and round, and is written to an append-only usage ledger.
- **REQ-276 P0 (new):** Before a review starts, BuildIT computes a pre-flight estimate from repository size, diff size, and historical cost, and refuses to start when the estimate exceeds the remaining budget. The estimate is shown in the dashboard and in the CLI.
- **REQ-277 P0 (revised in v1.2):** Reaching a hard per-review or per-period spend ceiling stops work and produces the `budget_exhausted` terminal status with the counters that triggered it. It never produces a passing result. Time ceilings never produce this status; they resolve as described in section 8 under "Where time limits land."
- **REQ-278 P0 (new):** Sandbox compute, storage, and BuildIT platform costs are BuildIT's cost of goods in V1, while model spend is the customer's through BYOK. This split is stated to customers so that "bring your own key" is not misread as "free."
- **REQ-279 P1:** Plan entitlements, meaning seats, connected repositories, and monthly review volume, are enforced server-side with a clear upgrade path.

### 7.17 Supportability and operations

- **REQ-280 P0 (new):** Runbooks exist for: stuck job, sandbox provider outage, model provider outage, GitHub outage or rate-limit exhaustion, duplicate side effect, failed deletion job, redaction failure, and suspected tenant-isolation incident.
- **REQ-281 P0 (new):** Kill switches exist per model provider, per runner, for Autofix, for direct push, and per organization, and are exercised in staging before launch.
- **REQ-282 P0 (new):** Operational alerting covers queue depth, review failure rate, provider failure rate, deletion-job failure, redaction-failure events, webhook signature failures, and loop-guard trips.
- **REQ-283 P0 (new):** A public status page and an incident communication template exist before public launch.
- **REQ-284 P1:** Support channel and response commitments are documented per plan.

---

### 7.18 Staff access, backup, and disaster recovery

- **REQ-315 P0 (new in v1.2):** BuildIT staff have no standing access to customer source-derived data. Access is break-glass: time-boxed, justified, approved by a second person, written to the customer-visible audit log, and notified to the organization owner. A support product that can read customer source at will is not compatible with the retention and confidentiality posture the rest of this document promises.
- **REQ-316 P0 (new in v1.2):** Production access requires multi-factor authentication and hardware-backed credentials. No shared accounts, no long-lived personal tokens against production.
- **REQ-317 P0 (new in v1.2):** Backups are encrypted, access-controlled, and inside the deletion cascade. The maximum backup-retention window is documented and the deletion promise in section 7.13 is stated in terms that account for it, rather than implying instant erasure from every copy.
- **REQ-318 P0 (new in v1.2):** Recovery objectives are stated: RPO 24 hours and RTO 8 hours for the control plane. In-flight reviews are explicitly not recovered. They are re-triggerable, results are commit-pinned, and a redone review is cheap, so recovery effort goes to state and credentials rather than to job resumption.
- **REQ-319 P0 (new in v1.2):** Vendor concentration is documented. The control plane depends on one hosting vendor, one database vendor, and GitHub. The runner sits behind an interface so it can be replaced, and the position on each vendor's unavailability is written down rather than discovered during an incident.
- **REQ-320 P0 (new in v1.2):** Audit events are tamper-evident through a per-organization hash chain, and the chain head is recorded so that gaps and rewrites are detectable. An audit log that the operator can edit silently is not evidence.
- **REQ-321 P1 (new in v1.2):** Product telemetry contains no source-derived content, and the telemetry field list is published in the security documentation.

### 7.19 Abuse prevention

- **REQ-325 P0 (new in v1.2):** Sandbox compute is BuildIT's cost, which makes a free trial a compute-theft vector: any repository can declare a validation command that mines cryptocurrency or otherwise burns CPU. Controls are egress denial by default, CPU and wall-clock ceilings, a trial-scoped compute quota, verification for new organizations, and anomaly detection on the ratio of CPU consumed to evidence produced. Suspected abuse suspends the organization pending human review.
- **REQ-326 P0 (new in v1.2):** All BuildIT-generated text published to GitHub is sanitised before posting. User and team mentions are neutralised, BuildIT command strings are escaped so that BuildIT cannot trigger itself or another integration through its own output, raw HTML and remote images are stripped, and secret redaction runs over model output as well as command output. Model-authored text is untrusted output as well as untrusted input.
- **REQ-327 P1 (new in v1.2):** A repository whose validation commands consistently consume compute far out of proportion to the evidence produced is flagged for pricing review rather than silently subsidised.

---

## 8. Review lifecycle

### Design correction

v1.0 modelled `stale` as a terminal state. That is wrong in two ways. It discards the actual outcome, so a result that passed at commit X becomes simply "stale" with no record of having passed, and it contradicts the section 12 invariant that a terminal review cannot change state. Staleness is a property of a result relative to the current head, not an outcome of the work.

v1.0 also placed `awaiting_autofix_authorization` inside the first review's state graph while Flow C describes Autofix being requested after a review has already reached `changes_requested`, which the same invariant forbids. Autofix is therefore modelled as a linked follow-on job.

### Corrected model

A review has:

- a **status**, exactly one of the values below,
- an independent boolean **isStale** with `staleSince` and `observedHeadSha`,
- a **terminationBound** where applicable,
- an independent **nextAction** label.

```text
Review job
  queued
    -> gathering_context
    -> analyzing
    -> validating
         -> checks_passed
         -> changes_requested
         -> inconclusive

Autofix job (separate job, linked by parentReviewId, requires an authorized request)
  autofix_queued
    -> autofixing_round_N        (N in 1..3)
    -> validating_round_N
         -> validating_final
              -> delivered        (every required check ran and passed at the final commit)
              -> inconclusive     (a required check could not run: missing environment,
                                   unsupported check, or a tool that is absent)
         -> autofixing_round_(N+1)   (only if N < 3 and no bound in REQ-245 is reached)
  -> failed_after_bounds  + terminationBound
  -> budget_exhausted     + budget ceiling and consumption (when spend binds)

Nonterminal, pausable:
  any active status -> blocked -> resumed to the prior stage
                                -> cancelled (reason: blocked_expired) after the blocked TTL

Terminal from any nonterminal status:
  -> cancelling -> cancelled
  -> budget_exhausted        (money only)
  -> platform_failed

Staleness is a flag applied to any status at any time, and never replaces it.
```

### Statuses

- `queued`: accepted and waiting for capacity. Position is visible.
- `gathering_context`, `analyzing`, `validating`: active work.
- `checks_passed`: every required check passed at the reviewed commit and no blocking finding remains.
- `changes_requested`: one or more blocking findings remain.
- `inconclusive`: evidence is insufficient because required checks were missing, unsupported, environmentally blocked, or could not complete within the review wall-clock limit. The reason is always attached. **An Autofix job can also end `inconclusive`**, when a patch was produced but the full final validation could not run. That is different from `platform_failed`, which is reserved for BuildIT's own failure, and different from `failed_after_bounds`, which means the loop ran out of budget or repetitions. The distinction matters to the reader: "we made a change but could not prove it" is not the same message as "we could not finish" or "we gave up."
- `delivered`: a candidate passed a full final validation against its final commit and was delivered for human review.
- `failed_after_bounds`: the Autofix loop stopped without success because a repetition or time bound was reached. `terminationBound` names one of `round_limit`, `attempt_limit`, `wall_clock_limit`, `repeated_patch`. Display text for `round_limit` is `Failed after three rounds`.
- `blocked`: **nonterminal and pausable.** BuildIT cannot proceed for a reason the customer can fix, such as an invalid credential, a suspended installation, or a lost permission. No cost accrues while blocked. When the cause clears, the job resumes at its last confirmed stage if the pinned head is still current and retained artifacts are still valid; otherwise resumption creates a new linked attempt. A blocked job that is not cleared within the blocked TTL becomes `cancelled` with reason `blocked_expired`. v1.1 listed `blocked` among terminal-looking statuses while Flow J described it as resumable, which was a contradiction.
- `cancelled`: work stopped by an authorized actor or by policy.
- `budget_exhausted`: **money only.** A spend ceiling stopped the work. Time limits never produce this status. v1.1 used it for both spend and time, which made cost reporting unreadable.
- `platform_failed`: BuildIT could not complete because of a non-code system failure.

### Where time limits land

Time is a bound, not a budget. A review that exceeds the review wall-clock limit is `inconclusive` with reason `timeout`, because the honest statement is that BuildIT did not finish gathering evidence. An Autofix loop that exceeds its wall-clock limit is `failed_after_bounds` with `terminationBound = wall_clock_limit`. A single command that exceeds its own timeout is a check with conclusion `timed_out`, which is a code-adjacent result rather than a job outcome. Only spend produces `budget_exhausted`.

### Status invariants

- A terminal status never becomes an active status. A retry creates a new job linked to the previous one.
- `isStale` may be set on any status, including terminal ones, and never erases the recorded status.
- A stale result may never be presented as current evidence and may never satisfy a required check.
- `checks_passed` always names a commit. A passing status without a commit is invalid data.

---

## 9. End-to-end user flows

### Flow A: First-time setup

1. Rohan signs in with GitHub.
2. He creates or selects a BuildIT organization.
3. BuildIT explains requested GitHub permissions and why each is needed.
4. Rohan installs the GitHub App on selected repositories.
5. He adds an Anthropic or OpenAI key, after reading the statement that requests go to his own provider account.
6. BuildIT validates the key with a minimal provider request and stores only the encrypted form.
7. BuildIT inspects repository metadata without executing code and proposes detected validation commands, each marked required or optional.
8. Rohan confirms commands and their required or optional status, protected paths, trigger mode, monthly budget, retention, hosting region acknowledgement, the required-check policy, and the stacked-PR default.
8a. BuildIT verifies protection on the trusted ref and states whether configuration approval will be `protected_ref_merge` or `explicit_admin_approval`. Neither is presented as a failure; the unverified case is a normal path with a different approval route.
9. A health check shows GitHub, provider, configuration, runner, and budget status.
10. Setup finishes only when mandatory checks pass; otherwise the exact incomplete step remains visible.

### Flow B: Review through GitHub

1. A developer opens or updates a PR.
2. The developer comments `@buildit review`, or an automatic policy triggers.
3. BuildIT verifies the raw webhook signature, records the delivery ID, resolves the actor's repository permission against GitHub, enqueues one job, and acknowledges.
4. BuildIT pins the PR head commit and resolves the approved configuration revision from the repository's trusted ref, which is not the pull request's base branch. The summary will name the ref and commit that supplied it.
5. A Check Run is created in progress so the work is visible in GitHub immediately.
6. The fetch-stage runner clones the exact base and head commits with a short-lived token and writes a workspace snapshot. The control plane orchestrates and never handles repository file content.
7. Credential teardown strips the token and git credential helpers from the snapshot and revokes the installation token. Teardown is recorded as an event, and execution cannot start without it.
8. A fresh execution sandbox boots from the snapshot with an explicit timeout, no credential of any kind, and egress denied. Dependencies install under the install-stage network policy, with build scripts limited to the reviewed allowlist and every skipped script recorded.
9. Static analysis and configured commands run. Base comparison uses the base-result cache where the full cache key matches.
10. The content broker reads approved artifacts, redacts, assembles model requests, and returns structured findings. The orchestrator deduplicates them and validates every cited evidence identifier against a real artifact.
11. Before publishing, BuildIT re-reads the head. This is a commit-sensitive write, so a moved head aborts it.
12. A single GitHub summary comment and Check Run update throughout the review, with the Check conclusion taken from the matrix in REQ-105.
13. The result becomes `checks_passed`, `changes_requested`, or `inconclusive`, and the sandbox is destroyed.
14. The human reviews the evidence and decides whether to request Autofix or work manually.

### Flow C: Autofix through GitHub

1. An authorized developer with write access comments `@buildit autofix stacked` or uses the dashboard.
2. BuildIT verifies that the referenced review is current and not stale, that Autofix is enabled, and that budget remains.
3. It opens a new Autofix job linked to the review. The working branch exists only inside the sandbox at this point. No GitHub branch is created yet, because a branch created before a patch succeeds is repository litter when the loop fails and a confusing artifact when it is cancelled.
4. The Builder receives only accepted and eligible findings, scoped context, and named edit tools.
5. The Builder proposes a patch within policy. Each proposal consumes a patch attempt whatever its outcome.
6. The orchestrator applies it and runs required validation. This is round one.
7. If checks fail for fixable reasons, failure evidence informs the next bounded round, subject to the counters in REQ-246. A flaky rerun consumes a diagnostic run, not a patch attempt.
8. When the affected subset passes, BuildIT runs the full final validation: every required check in the effective configuration, against the final candidate commit. A subset never qualifies for delivery.
9. If the full final validation passes, the delivery stage re-verifies the head as a commit-sensitive write, mints a fresh token, pushes the agent branch to GitHub for the first time, and opens a stacked PR targeting the original PR branch.
10. If a required check cannot run against the final commit, the job ends `inconclusive`, the candidate is not described as validated, and BuildIT says exactly which check could not run and why.
11. On reaching a round, attempt, time, or repeated-patch bound without success, BuildIT stops with `failed_after_bounds` and names the `terminationBound`. On reaching the spend bound, it stops with `budget_exhausted` and names the ceiling and consumption. In either case it reports remaining failures and preserves work according to repository policy. The source PR branch is never modified.
12. A human reviews and merges or closes the stacked PR. BuildIT never merges either PR.

### Flow D: Incremental PR update

1. A developer pushes a new commit while or after a review runs.
2. BuildIT observes the new head and flags the prior result stale immediately, preserving its recorded status.
3. Pushes within the debounce window collapse; only the latest head is reviewed.
4. An active job is cancelled before delivery when safe; already-created artifacts keep their original commit label.
5. BuildIT reuses commit-aware index data and base results, and reviews the diff since the last reviewed head plus affected context, then re-runs required checks.
6. Resolved findings close; unchanged dismissed findings remain suppressed by fingerprint; new or materially changed findings appear.
7. GitHub shows one current summary and links to prior runs.

### Flow E: No linked issue

1. BuildIT finds no supported issue reference.
2. It uses the PR title, body, tests, repository rules, and context documents.
3. Requirement coverage is labeled `limited`.
4. The absence of an issue does not block code checks unless repository policy requires a ticket.

### Flow F: Jira or Linear context

1. An admin connects the tracker through OAuth with read-only access.
2. BuildIT maps issue URLs and keys only within connected workspaces.
3. A review fetches fields the authorized account may view, and pins the fetched version and timestamp.
4. Attachments and comments are excluded by default; admins can opt in where needed.
5. Access failure is reported as a context limitation and never downgraded to "no requirements."
6. Jira access remains constrained by both OAuth scopes and the connecting user's Jira permissions. [Jira OAuth scope guidance](https://developer.atlassian.com/cloud/jira/platform/scopes-for-oauth-2-3LO-and-forge-apps/).

### Flow G: Dashboard monitoring

1. Rohan opens Review Queue and sees items grouped by `Needs decision`, `Running`, `Queued`, and `Finished`.
2. He opens a review and sees the exact commit, staleness, and next action first.
3. A stage timeline updates from confirmed Convex events.
4. Findings and check results appear as their stages complete.
5. Large logs remain collapsed, searchable, downloadable within retention, and visibly redacted.
6. Rohan may cancel, authorize Autofix, retry a platform failure, or open GitHub, subject to role and state.

### Flow H: CLI review

1. The developer runs `buildit review --dir packages/billing`.
2. The CLI identifies the repository, current changes, provider source, and the applicable `.buildit` policy from the checked-out trusted revision.
3. It displays the files, commands, and estimated cost in scope.
4. After first-run consent, it runs local checks or creates a remote sandbox according to mode.
5. Progress streams to the terminal; JSON mode emits stable events.
6. The CLI exits `0` for checks passed and documented nonzero codes for findings, inconclusive, blocked, budget exhausted, and platform failure, and preserves user files unless Autofix was explicitly requested.

### Flow I: Cancellation

1. An authorized user clicks Cancel or comments `@buildit cancel`.
2. BuildIT records the request immediately and disables new model and tool work.
3. The runner terminates the active command, revokes temporary tokens, destroys the sandbox, and prevents branch delivery.
4. The review ends `cancelled` with the last confirmed stage and no misleading pass or fail claim. The Check conclusion is `action_required` under every policy, per the matrix in REQ-105, so a cancellation can never satisfy a required check and can never be used as a merge bypass.

### Flow J: Reauthentication or key failure

1. A tracker token or provider key fails.
2. BuildIT distinguishes invalid credentials, missing scope, rate limit, quota, and provider outage.
3. Retryable failures retry within policy; permanent failures move the job to `blocked`, which is nonterminal and pausable, before any cost-bearing or write action.
4. Admins receive an email notification and a targeted reconnect or replace-key action in the dashboard.
5. The existing review remains resumable if its pinned commit is still current and retained artifacts are valid.

### Flow K: Fork pull request

1. An outside contributor opens a PR from a fork.
2. Automatic review does not trigger by default. A maintainer with write access comments `@buildit review`.
3. BuildIT resolves configuration and the command set from the trusted ref only.
4. The fetch-stage runner, not the control plane, clones the exact commits with a short-lived token and writes a workspace snapshot. The control plane orchestrates and stores metadata; it never handles repository file content.
5. Credential teardown removes the token and git credential helpers from the snapshot and revokes the installation token through GitHub. Teardown is recorded as an event and execution cannot start without it.
6. A fresh execution sandbox boots from the snapshot with egress denied, lifecycle scripts limited to the allowlist, and no GitHub or provider credential present.
7. The report states that this was a fork review, that Autofix is unavailable, and which checks were restricted.

### Flow L: Budget or capacity limit reached (new)

1. A trigger arrives when the organization is at its concurrency ceiling, or the pre-flight estimate exceeds the remaining budget.
2. For capacity, the job enters `queued` with a visible position, and the acknowledgement states the wait.
3. For budget, the job does not start. The status is `budget_exhausted`, the summary names the ceiling and the current consumption, and an admin notification is sent.
4. No partial result is published as a pass. The Check conclusion for `budget_exhausted` is `action_required` under every policy, because a human has to decide whether to raise the ceiling or narrow the scope.

### Flow M: Configuration change inside a pull request

1. A PR modifies `.buildit/config.json` or `.buildit/rules.md`.
2. BuildIT runs entirely on the approved configuration revision from the trusted ref.
3. The summary contains an informational finding showing the effective-settings diff and stating how the change becomes active. If the trusted ref's protection is verified, merging into that ref activates it with `protected_ref_merge` provenance. If protection is unverified, only `explicit_admin_approval` in the dashboard activates it, and the summary says so plainly rather than implying a merge will suffice.
4. No command, path, budget, or network setting from the PR head is honoured in this run.

---

## 10. Edge-case catalogue and required behavior

### Repository and Git edge cases

| Case | Required behavior |
|---|---|
| PR from a fork | Read-only review under the hardened model in REQ-230 and REQ-231. Autofix unavailable in V1, with the reason stated. |
| Branch protection rejects push | Preserve agent branch or patch, report the permission failure, and do not retry endlessly. |
| Head changes during review | Flag stale, preserve the recorded status, and prevent delivery against the old head. |
| Force-pushed or deleted branch | Stop writes, preserve audit metadata, destroy the workspace. |
| Merge conflict in stacked PR | Report the conflict and affected files; do not merge or rebase automatically. |
| Submodules | Do not initialize unless explicitly allowlisted and credentials are available. |
| Git LFS | Detect pointers; report unsupported assets unless LFS is configured. |
| Binary or generated files | Review metadata only; do not Autofix by default. |
| Huge PR | Apply configured file and line limits, report partial coverage, and return `inconclusive` if required coverage is impossible. |
| Empty or documentation-only PR | Run applicable rules; skip code execution with an explicit reason. |
| Monorepo | Determine affected workspaces and their commands; avoid whole-repo execution unless policy requires it. |
| Lockfile changes | Validate package-manager consistency and dependency audit; modification requires policy permission. |
| Workflow or infrastructure change | Treat as a protected path; analyze read-only and require explicit Autofix authorization. |
| Repository renamed or transferred | Continue by immutable repository ID; update the stored owner and name. |
| Repository deleted or archived | Cancel active work, stop triggers, and begin the configured deletion. |
| `.buildit/` modified in the PR | Run on the trusted revision and raise a configuration-change finding (REQ-211). |
| PR base is a contributor-controlled feature branch or a BuildIT stacked branch | Configuration still comes from the trusted ref; the summary names the ref and commit that supplied it. |
| Trusted ref has no verifiable protection | Protection is `unverified`; merges into it are not approval; configuration changes need explicit Admin approval; the dashboard offers a path to enable protection. |
| Autofix produced a patch but a required check cannot run at the final commit | End `inconclusive`, name the check and the reason, do not describe the candidate as validated. |
| Flaky test triggers a diagnostic rerun during Autofix | Consumes the diagnostic-run counter only. Rounds and patch attempts are unaffected. |
| Allowlisted package publishes a new version | The allowlist entry is bound to version and lockfile integrity, so the new version is not covered and needs re-approval. The report says so. |
| Repository uses a merge queue | Review the pull request only; do not act on merge-group events and do not allow BuildIT to be a merge-queue required check in V1. |
| PR title or body edited | Refresh requirements, mark requirement context changed, do not auto-start a full review. |
| Base branch changed on the PR after review | Treat as a material context change, flag stale, and require a new run before delivery. |

### Requirements edge cases

| Case | Required behavior |
|---|---|
| No ticket | Continue with limited requirement confidence. |
| Broken or private link | Report inaccessible context. |
| Multiple tickets | Build a list; flag conflicts instead of choosing silently. |
| Ticket changes mid-review | Pin the fetched version and time, and mark context changed when detected. |
| Ticket contains prompt injection | Treat instructions as quoted requirement data, never control commands. |
| Acceptance criteria only in an image | Mark unread unless image extraction is explicitly supported. |
| Ticket is enormous | Apply the context token budget, record what was excluded, and lower coverage confidence. |

### Execution edge cases

| Case | Required behavior |
|---|---|
| No test command | `inconclusive`; recommend setup. |
| Existing base-branch failure | Separate pre-existing failure from PR-introduced regression using the base result cache; when no base result exists, label "pre-existing status unknown." |
| Flaky test | One diagnostic rerun; label flaky evidence; never claim a stable pass from alternating results. |
| Dependency registry outage | Platform or environment failure, not a code failure. |
| Test requires a database or service | Start only allowlisted ephemeral dependencies; otherwise report the missing environment. |
| Test hangs | Terminate at the timeout and show a timeout rather than a generic failure. |
| Output exceeds the limit | Truncate safely, retain the summary and tail, and label the truncation. |
| Test attempts network access | Block and report the destination category without leaking tokens. |
| Malicious code tries to read secrets | Secrets are absent; log a sandbox-policy event. |
| Package install script is malicious | Lifecycle scripts are disabled by default; if enabled, the install stage remains sandboxed with restricted egress and no control-plane secrets. |
| Scanner disagrees with the model | Preserve scanner evidence; the model cannot silently dismiss it. |
| Job outlives the sandbox lifetime | Re-provision deterministically or fail cleanly with `platform_failed`; never report partial validation as complete. |
| Installation token expires mid-job | Tokens are minted per stage, so no stage outlives its credential; a stage that needs longer re-mints rather than holding a long-lived token. |
| Package legitimately needs a build script | Allowlist the package; otherwise the script is skipped and named in the report with the one-click remedy. |
| Trial repository declares a CPU-burning validation command | Compute quota and anomaly detection stop it and suspend the organization for human review. |
| Repository build requires secrets BuildIT does not have | Report the missing environment as `not_run` with a reason; never guess values. |

### Autofix edge cases

| Case | Required behavior |
|---|---|
| Patch touches an out-of-scope path | Reject the patch, consume one attempt, and allow a corrected proposal within the attempt budget. |
| Patch is empty | Do not count a completed round, consume one attempt, and stop when the attempt budget is exhausted. |
| Tests pass but a required scanner fails | The round fails. |
| Model repeats the same patch | Detect the patch fingerprint; a second identical fingerprint ends the loop. |
| Fix increases blocking findings | Restore the previous round snapshot before another attempt. |
| Third round fails | Stop exactly once; no fourth edit; isolate partial work. |
| Spend ceiling reached first | Stop with `budget_exhausted`, naming the ceiling and the consumption. |
| Wall-clock limit reached first | Stop with `failed_after_bounds` and `terminationBound = wall_clock_limit`. |
| Direct-push head moved | Abort the push and offer a new run; never force-push. |
| User cancels during push | Complete or reconcile the atomic GitHub operation, then report the exact resulting artifact. |
| Stacked PR already exists for this job | Reconcile through the idempotency record and update it rather than opening a second one. |

### Platform edge cases

| Case | Required behavior |
|---|---|
| Duplicate webhook | Return success and point to the existing job. |
| Webhook signature invalid | Reject before parsing or processing and record a security event. |
| GitHub API rate limit | Respect reset and retry headers, back off proactively per installation, and show a delayed state. |
| Provider 429 or 5xx | Bounded backoff with jitter; preserve state. |
| Provider returns malformed or non-tool output | Structured fallback or bounded retry; never execute unvalidated arguments. |
| Model cites an evidence ID that does not exist | Drop the finding, record a model-integrity event, and do not surface it to the user. |
| Convex temporarily unavailable | Do not perform unrecorded writes; retry the durable stage. |
| Worker dies after a GitHub write | Reconcile through the idempotency record before retrying. |
| Installation removed | Cancel work, revoke access, and begin configured data deletion. |
| Installation suspended | Move repositories to `blocked` with a remedy; do not queue unrunnable work. |
| User loses their organization role | Recheck authorization on every action, not only on page load. |
| BuildIT comments loop with another bot | Loop guard trips, repository pauses, operational alert fires. |
| BuildIT check is required in branch protection and BuildIT is down | Publish the conclusion the repository's policy dictates per the REQ-105 matrix: neutral under `advisory` and `fail_open`, failure under `fail_closed`. State in every case that no evaluation occurred. |
| Developer cancels BuildIT to bypass a required check | Cancellation publishes `action_required`, which does not satisfy a required check. |
| Worker dies leaving an in-progress Check | The watchdog concludes it with a reconciliation write naming the old commit. |
| Model output contains an `@buildit` command or a user mention | Output sanitisation neutralises it before posting, so BuildIT cannot trigger itself through its own comment. |

---

## 11. Acceptance criteria

### Setup and credentials

- **AC-001:** Given a new organization, when an owner completes GitHub installation, then BuildIT lists only installed repositories and records the installation ID without storing a long-lived installation token.
- **AC-002:** Given missing Contents write permission, when Autofix setup runs, then review-only mode remains available and Autofix is marked unavailable with a permission remedy.
- **AC-003:** Given a valid provider key, when it is saved, then database inspection, logs, browser responses, and the sandbox environment contain no plaintext key.
- **AC-004:** Given a revoked provider key, when a new review starts, then no provider request is made and the job enters `blocked` with a credential reason.
- **AC-005:** Given an old encryption-key version, when the master key rotates, then the old credential remains usable during migration and is rewritten using the new version without exposing plaintext to the client.
- **AC-006:** Given an unsupported or invalid repository configuration, when setup validation runs, then Autofix remains disabled and the UI identifies each invalid field and the detected commands that require confirmation.
- **AC-007:** Given an actor without Developer or Admin rights, when they request a review or Autofix, then BuildIT rejects the action before enqueueing cost-bearing work.
- **AC-200 (new):** Given a ciphertext belonging to organization A, when it is inserted into organization B's credential record and decryption is attempted, then decryption fails because the additional authenticated data does not match.
- **AC-201 (new):** Given an installation that GitHub reports as suspended, when any trigger arrives, then the job is `blocked` with a suspension remedy and no sandbox is created.

### Context and configuration trust

- **AC-010:** Given a PR links a readable GitHub Issue, when context gathering completes, then its title, body, and explicit acceptance criteria are represented in the requirements list with source links.
- **AC-011:** Given no linked issue, when review runs, then it continues, marks requirement confidence limited, and never claims ticket validation occurred.
- **AC-012:** Given two linked tickets contain conflicting requirements, when analysis runs, then the conflict is a visible finding and neither requirement is silently selected as truth.
- **AC-013:** Given source text says to ignore system policy or merge the PR, when processed, then no permission, budget, command, or merge rule changes.
- **AC-014:** Given a PR head changes during context gathering, when the mismatch is observed, then the job is flagged stale and cannot publish a current passing result.
- **AC-015:** Given include, exclude, and protected paths in `.buildit/config.json`, when retrieval and patching run, then excluded files are never sent to the model and protected paths cannot be edited without explicit authorization.
- **AC-202 (new, critical):** Given a pull request that modifies `.buildit/config.json` to add a new command, a wider network allowlist, and a shorter protected-path list, when the review runs, then the executed commands, network policy, and protected paths are those of the approved revision on the trusted ref, the head configuration is not applied, and the summary contains a configuration-change finding naming the ref and commit that supplied it.
- **AC-203 (new):** Given `.buildit/rules.md` in the PR head contains text instructing BuildIT to approve the change, when the review runs, then the rules used are those from the approved revision on the trusted ref and the head text influences nothing.
- **AC-204 (new):** Given context exceeding the token budget, when retrieval completes, then the report lists which areas were excluded and coverage is reported as partial rather than complete.

### Review and evidence

- **AC-020:** Given a material finding, when displayed, then it contains severity, impact, evidence, location or scope, source rule or requirement, and recommended action.
- **AC-021:** Given the same issue is reported by a scanner and the model, when results are synthesized, then one finding appears with both evidence sources.
- **AC-022:** Given a scanner cannot run, when the report completes, then the check is `not_run` with a reason and the overall result cannot be `checks_passed` if that check is marked required.
- **AC-023:** Given all required checks pass at commit X and no blocking finding remains, when the report completes, then status is `checks_passed at X`. When head Y is observed, the result is flagged stale within one webhook delivery, and any subsequent publish attempt is blocked by the head compare-and-swap.
- **AC-024:** Given a PR has no runnable validation command, when review completes, then status is `inconclusive`, not passed.
- **AC-025:** Given a prior finding was dismissed on unchanged code, when incremental review runs, then it is not reposted unless new evidence materially changes it.
- **AC-026:** Given a completed review, when GitHub is opened, then exactly one current summary identifies the exact commit, coverage, checks, findings, skipped work, remaining risk, and next action.
- **AC-027:** Given BuildIT checks pass, when GitHub permissions and API calls are inspected, then BuildIT has neither approved the PR nor enabled or attempted a merge.
- **AC-205 (new):** Given the model reports a finding citing an evidence ID that no artifact matches, when the orchestrator validates findings, then the finding is dropped, a model-integrity event is recorded, and nothing is posted to GitHub.
- **AC-206 (new):** Given a finding is dismissed with repository scope and source-derived retention then expires, when the same issue recurs 30 days later on unchanged code, then it remains suppressed because the fingerprint survived under the metadata retention policy.
- **AC-207 (new):** Given a required check fails on the head and no base result exists in the cache, when metrics are computed, then the outcome is recorded as "pre-existing status unknown" and is excluded from the regression-caught metric.

### Sandbox and untrusted execution

- **AC-030:** Given test code prints all environment variables, when it runs, then no provider key, database credential, webhook secret, master key, or production credential is present.
- **AC-031:** Given test code attempts an unapproved outbound request, when it runs, then the request is blocked and the review records a network-policy event.
- **AC-032:** Given a command exceeds its time or output limit, when enforcement occurs, then the process is terminated, output is safely truncated and redacted, and the result states the exact limit reached.
- **AC-033:** Given a command argument contains shell metacharacters, when executed, then they are passed as literal data and cannot create an additional command.
- **AC-034:** Given a repository writes outside its workspace, when attempted, then sandbox isolation prevents access to the control plane and the workspace is destroyed after the job.
- **AC-208 (new, critical):** Given a pull request from a fork whose test code attempts to read a GitHub token from the environment, from the git remote configuration, and from the credential helper, when the review executes, then no usable token exists in any of those locations.
- **AC-209 (new):** Given a package whose postinstall script attempts to run, when dependencies are installed with default settings, then the script does not execute and the report notes that lifecycle scripts are disabled.
- **AC-210 (new):** Given an Autofix job whose total duration exceeds a single sandbox lifetime, when the job continues, then either the sandbox was created with a sufficient explicit timeout or a deterministic re-provision occurred, and in neither case is an unexecuted check reported as passed.

### Autofix and bounds

- **AC-040:** Given an authorized Autofix request, when round one begins, then an agent branch is created from the exact reviewed head and the source branch remains unchanged.
- **AC-041:** Given a patch is applied, when required validation does not execute because of infrastructure failure, then no completed round is counted, one attempt is consumed, and bounded infrastructure retry policy applies.
- **AC-042:** Given round one fails code validation and round two passes all required checks, when delivery occurs, then the first-pass-round metric is 2 and the report retains results for both rounds.
- **AC-043:** Given three completed rounds fail, when round three ends, then no fourth edit is attempted, status is `failed_after_bounds` with the three-round label, unresolved failures are grouped by severity and type, and the source PR branch is unchanged.
- **AC-044:** Given stacked mode succeeds, when delivery runs, then the new PR targets the original PR branch, identifies the exact agent commit, summarizes changes and checks, and does not target the base branch.
- **AC-045:** Given direct-push mode is enabled but the source head moved, when the push begins, then BuildIT aborts without force-pushing and marks the candidate stale.
- **AC-046:** Given a proposed patch touches a protected workflow file without approval, when validated, then patch application rejects that path before any commit.
- **AC-047:** Given a successful fix, when all work completes, then BuildIT has made zero calls to a GitHub merge endpoint.
- **AC-211 (new):** Given a model that proposes six consecutive patches that are empty or rejected, when the attempt budget is reached, then the job stops with zero completed rounds, the report names the attempt bound, and no further model call is made.
- **AC-212 (new):** Given two proposed patches with an identical fingerprint, when the second is detected, then the loop ends immediately and the report names the repeat-patch bound.
- **AC-213 (new):** Given an Autofix request from a user without write access on the repository, when the request is processed, then it is rejected before any branch is created and before any provider call is made.
- **AC-214 (new):** Given a fork pull request, when `@buildit autofix` is requested by anyone, then it is refused with an explanation and no agent branch is created.

### GitHub and workflow reliability

- **AC-050:** Given GitHub sends the same delivery twice, when both are handled, then exactly one review job and one summary comment exist.
- **AC-051:** Given a valid webhook, when received, then BuildIT verifies the signature over the raw body and sends 2XX within 10 seconds after durable enqueue.
- **AC-052:** Given a worker dies after opening a stacked PR, when the stage retries, then it finds and records the existing PR rather than opening another.
- **AC-053:** Given the provider emits two client tool calls, when the loop continues, then each tool-use identifier receives exactly one matching tool result and the full assistant content is preserved.
- **AC-054:** Given retryable provider failures exceed the configured maximum, when retries end, then the review stops with provider failure details and does not consume Autofix rounds.
- **AC-055:** Given cancellation during active execution, when acknowledged, then no further model call, edit round, or branch delivery starts and the sandbox is destroyed.
- **AC-215 (new):** Given an old comment is edited to contain `@buildit autofix`, when the edit webhook arrives, then no job is created and the delivery is recorded as ignored.
- **AC-216 (new):** Given another bot posts a comment mentioning `@buildit`, when the webhook arrives, then no job is created.
- **AC-217 (new):** Given five pushes to the same PR within the debounce window, when the window closes, then exactly one review runs, against the latest head, and four superseded heads are recorded without being billed.
- **AC-218 (new):** Given the organization is at its concurrency ceiling, when a new trigger arrives, then the job is `queued` with a visible position and the acknowledgement states the wait rather than failing silently.
- **AC-219 (revised in v1.3):** Given the BuildIT check is required in branch protection and BuildIT enters `platform_failed`, when the check is published, then the conclusion matches the repository's policy row in the REQ-105 matrix, neutral under `advisory` and `fail_open` and failure under `fail_closed`, and the summary states in every case that no evaluation occurred.

### UI and accessibility

- **AC-060:** Given an active review event is committed, when the Review Detail page is open, then the new stage or log appears without refresh and is not displayed before server confirmation.
- **AC-061:** Given a keyboard-only user, when navigating setup and Review Detail, then every action is reachable, focus is visible, dialogs trap and restore focus, and status is not conveyed by color alone.
- **AC-062:** Given loading, empty, permission-denied, stale, partial, and error data, when each state occurs, then the page gives a specific explanation and next action without broken placeholders.
- **AC-063:** Given a mobile viewport, when a user opens Review Detail, then status, next action, findings, check matrix, and cancellation remain usable without horizontal page overflow.
- **AC-064:** Given a reduced-motion preference, when progress or overlays change, then movement animation is removed while state changes remain understandable.
- **AC-065:** Given every organization role, when dashboard routes and actions are exercised, then data and controls are limited to that role and organization on both client and server.
- **AC-066:** Given key revocation, repository disconnect, or artifact deletion, when initiated, then a confirmation names the affected resource and consequence before the action executes.
- **AC-220 (new):** Given an automated accessibility audit and a manual keyboard pass on setup, Review Queue, Review Detail, and Policies, when run, then there are no critical or serious violations and every interactive target meets the product's 44 pixel standard or documents an approved exception.

### Retention and governance

- **AC-070:** Given immediate-deletion retention, when a review reaches a terminal status, then the repository workspace and source-derived artifacts are deleted and only permitted redacted metadata remains.
- **AC-071:** Given seven-day retention, when expiry passes, then source-derived Convex records, object artifacts, and BuildIT-controlled indexes are deleted through an auditable job.
- **AC-072:** Given logs contain a seeded secret, when stored or shown, then the secret value is redacted in Convex, GitHub comments, analytics, and model follow-up context.
- **AC-073:** Given a user requests an audit export, when generated, then records contain actors and actions but no plaintext credentials or source snippets.
- **AC-221 (new):** Given a deletion job fails, when the failure is detected, then an operational alert fires, an admin notification is sent, and the affected records are retried until deleted or escalated.
- **AC-222 (new):** Given a customer sets immediate deletion, when they read the retention UI, then it states explicitly that comments and branches already published to GitHub are not deleted by this setting.

### Notifications, cost, and capacity

- **AC-223 (revised):** Given a review finishes needing a decision, when the exact active member has a separately verified BuildIT email, explicitly opted in inside that organization, has not muted the repository, and production email delivery is available, then exactly one email is sent to that member containing status, repository, PR, commit, and link, and containing no code, diff, log, finding evidence, or secret. Given any boundary is absent or changed, no email is sent. The GitHub App or installation owner is never substituted.
- **AC-224 (new):** Given monthly spend crosses 80 percent, when the crossing is detected, then admins are notified once at that threshold and again at 100 percent, and not on every subsequent review.
- **AC-225 (new):** Given the pre-flight estimate exceeds the remaining budget, when a trigger arrives, then no sandbox is created, no provider call is made, and the status is `budget_exhausted` with the ceiling and consumption shown.
- **AC-226 (new):** Given a completed review, when the usage ledger is inspected, then model tokens, model spend, sandbox seconds, vCPU-minutes, and artifact bytes are all attributed to that review.

### CLI (V1.1, previously missing entirely)

- **AC-230 (new):** Given `buildit review --dir packages/billing`, when it runs, then only files under that path and their declared dependencies are read, and files outside it are neither read nor uploaded.
- **AC-231 (new):** Given local mode on first use, when the command plan is displayed, then no command executes until the user consents, and the consent is recorded per repository.
- **AC-232 (new):** Given remote mode, when a workspace is uploaded, then the retention statement is displayed beforehand and the upload is encrypted in transit and at rest.
- **AC-233 (new):** Given an interrupt during a remote job, when the CLI exits, then temporary credentials are removed, local files are unchanged, and the output states whether the remote job is still running and how to cancel it.
- **AC-234 (new):** Given `buildit review` in a repository whose working tree modifies `.buildit/config.json`, when it runs without the explicit trust flag, then the committed trusted-revision configuration is used and a warning is printed.
- **AC-235 (new):** Given JSON output mode, when a review completes, then the event stream and exit code match the documented schema and are stable across patch versions.
- **AC-236 (new):** Given `buildit autofix`, when the bounds in REQ-245 are reached, then the CLI stops identically to the hosted path and names the bound.

### Metrics

- **AC-080:** Given two reviews of two commits on the same PR, when weekly metrics calculate, then two reviewed-head events and one unique PR are available as separate measures.
- **AC-081:** Given a test already fails on the base comparison, when it also fails on the PR, then it is not counted as a newly caught regression.
- **AC-082:** Given a candidate patch is delivered but never merged, when metrics calculate, then it is counted as generated and delivered but not as an applied autonomous fix.
- **AC-083:** Given an organization timezone, when the weekly report opens, then the exact start and end timestamps are visible and all counts use that window.
- **AC-237 (new):** Given a merged BuildIT fix is reverted on the default branch within 7 days, when the push event is processed, then the reversion is recorded against that fix and appears in the trust metrics.
- **AC-238 (new):** Given an organization without the `push` subscription enabled, when reversion metrics are displayed, then they read "unavailable" rather than zero.

### v1.2 additions

- **AC-300:** Given a pull request whose base is an unprotected branch the contributor controls, and that branch contains a `.buildit/config.json` adding a command and widening the network allowlist, when the review runs, then the configuration used is the trusted ref's approved revision, the contributor's settings are not applied, and the summary names the ref and commit that supplied the configuration.
- **AC-301:** Given a stacked pull request BuildIT opened, when webhooks arrive for it, then no automatic review starts, and a manual review uses the trusted ref rather than the stacked branch.
- **AC-302:** Given a head change during a review, when reconciliation runs, then the previous summary is updated to stale naming the old SHA, the previous Check is concluded, and no pass or fail is asserted for the new head.
- **AC-303:** Given a worker dies leaving a Check in progress, when the watchdog runs, then the Check is concluded within the reconciliation threshold and the conclusion names the commit it refers to.
- **AC-304:** Given an Autofix candidate where only the affected subset of required checks ran against the final commit, when delivery is attempted, then the status is `inconclusive`, the candidate is not described as validated, and no stacked PR claims a passing check matrix.
- **AC-305:** Given an Autofix job with six attempts of which two were applied and validated, when the data model is inspected, then there are six `autofixAttempts` rows and two `autofixRounds` rows, the counters agree, and the terminal record names the bound that ended the loop.
- **AC-306:** Given any review, when execution begins, then the credential-teardown event exists, the installation token used by the fetch stage has been revoked, and no GitHub token is present in the execution sandbox.
- **AC-307:** Given retention expiry, when the enumerated source-derived field list is tested, then every field is either an artifact reference whose artifact is deleted or a marked denormalised field that has been nulled, with no readable source content remaining.
- **AC-308:** Given a repository configured `fail_closed`, when BuildIT enters `platform_failed`, then the Check conclusion is `failure` and merges are blocked.
- **AC-309:** Given a repository where the BuildIT check is required, when an authorized developer cancels the review, then the conclusion is `action_required` and the pull request cannot merge on the strength of that cancellation.
- **AC-310:** Given a finding whose text contains `@buildit autofix` and an organization team mention, when the summary is posted, then both are neutralised, no job is triggered, and no notification storm is generated.
- **AC-311:** Given a job in `blocked` whose credential is then repaired, when the head is unchanged, then the job resumes at its last confirmed stage; when the head has moved, then a new linked attempt is created instead.
- **AC-312 (revised in v1.3):** Given a package allowlisted at version 1.2.3 and the lockfile now resolving that package at 1.2.4, when dependencies install, then the build script does not run, the report names the package and the version change, and the remedy offered is re-approval of the new version rather than a global override.
- **AC-313:** Given a base result cached under a previous runner image version, when a review runs on a new image, then the cache misses and the base is recomputed.
- **AC-314:** Given break-glass staff access to an organization's data, when it is granted, then a second person approved it, the customer-visible audit log contains it, and the organization owner is notified.
- **AC-315:** Given an Autofix job that exceeds its wall-clock limit, when it stops, then the status is `failed_after_bounds` with `terminationBound = wall_clock_limit`, and `budget_exhausted` is not used.
- **AC-316:** Given a trial organization whose validation command consumes CPU without producing evidence, when the quota or the anomaly detector trips, then execution stops and the organization is suspended for review.
- **AC-320 (new in v1.3):** Given a trusted ref with no rules returned by the branch rules endpoint, when a configuration change is merged into it, then the change does not take effect, provenance is not `protected_ref_merge`, and the dashboard requires explicit Admin approval.
- **AC-321 (new in v1.3):** Given an Autofix job that produced a passing subset but whose required end-to-end check cannot run at the final commit, when the job ends, then the status is `inconclusive`, no stacked PR claims a passing matrix, and the report names the check and the reason.
- **AC-322 (new in v1.3):** Given an Autofix job with three flaky reruns and two proposed patches, when the counters are inspected, then `diagnosticRunCount` is 3, `patchAttemptCount` is 2, and neither rerun reduced the remaining patch budget.
- **AC-323 (new in v1.3):** Given each review status in turn under each of the three required-check policies, when the Check is published, then the conclusion matches the REQ-105 matrix cell exactly, verified by a table-driven test that fails if any cell drifts.
- **AC-324 (new in v1.3):** Given an Autofix loop that fails at every bound, when the job ends, then no GitHub branch was ever created unless repository policy elected to preserve failed work, and the repository has no orphaned `buildit/` branches.
- **AC-325 (new in v1.3):** Given the control-plane service, when its code paths and credentials are audited, then it has no route to artifact content, and the content broker has no GitHub write token, no administrative database credential, and no persistent storage.
- **AC-326 (new in v1.3):** Given the consistency lint in Appendix D, when it runs over this document, then it reports zero violations.

### Requirements-to-acceptance traceability

| Requirement group | Primary acceptance coverage |
|---|---|
| REQ-001 to 006, 200 to 202 Setup and roles | AC-001, AC-002, AC-006, AC-007, AC-065, AC-201 |
| REQ-010 to 019, 203 to 204 Credentials | AC-003 to AC-005, AC-054, AC-066, AC-200 |
| REQ-020 to 027, 210 to 214 Repository policy and config trust | AC-006, AC-015, AC-046, AC-202, AC-203 |
| REQ-030 to 036, 205 to 209, 215 to 219 Initiation, authorization, capacity | AC-007, AC-050, AC-051, AC-215 to AC-218 |
| REQ-040 to 049, 220 to 222 Context | AC-010 to AC-015, AC-204 |
| REQ-050 to 058, 225 to 228 Findings | AC-020, AC-021, AC-025 to AC-027, AC-205, AC-206 |
| REQ-060 to 072, 230 to 237 Execution and isolation | AC-022, AC-024, AC-030 to AC-034, AC-207 to AC-210 |
| REQ-080 to 094, 245 to 248 Autofix | AC-040 to AC-047, AC-211 to AC-214 |
| REQ-100 to 107, 250 to 253 GitHub results | AC-023, AC-026, AC-027, AC-050, AC-052, AC-219 |
| REQ-110 to 119, 255 Dashboard | AC-060 to AC-066, AC-220 |
| REQ-120 to 127, 256 to 257 CLI | AC-230 to AC-236 |
| REQ-130 to 137, 258 Reliability | AC-050 to AC-055 |
| REQ-140 to 149, 260 to 264 Governance | AC-003, AC-030, AC-070 to AC-073, AC-221, AC-222 |
| REQ-150 to 157, 265 to 266 Metrics | AC-042, AC-080 to AC-083, AC-237, AC-238 |
| REQ-270 to 273 Notifications | AC-223, AC-224 |
| REQ-275 to 279 Cost | AC-225, AC-226 |
| REQ-280 to 284 Operations | Exercised in the launch readiness drill in section 19 |
| REQ-300 to 310 Trusted ref, staged execution, retention storage, coverage | AC-300, AC-301, AC-302, AC-304, AC-306, AC-307, AC-313 |
| REQ-315 to 321 Staff access, backup, recovery | AC-314, plus the launch readiness drill in section 19 |
| REQ-325 to 327 Abuse prevention and output safety | AC-310, AC-316 |
| REQ-330 to 331 Trusted-ref protection verification | AC-320 |
| REQ-335 to 336 Content broker boundary | AC-325 |
| REQ-105 Check conclusion matrix | AC-219, AC-308, AC-309, AC-323 |
| REQ-246 Bound counters | AC-305, AC-315, AC-322 |

Every P0 requirement in this document has at least one acceptance criterion or a named launch-gate exercise. v1.0 left REQ-107, REQ-018, REQ-025, REQ-072, REQ-145, and REQ-148 uncovered, and left the entire CLI block with an explicit note that criteria were missing.
---

## 12. Data architecture

### Storage rules

Convex stores product state and small redacted events. Large encrypted logs, patches, scanner files, and artifacts belong in object storage with short-lived signed access. Repository snapshots remain only in sandbox storage. Convex function and argument limits make large raw logs inappropriate as database documents. [Convex limits](https://docs.convex.dev/production/state/limits).

### Data classification

Every stored field carries one of three classifications, and retention is driven by the classification rather than by the table:

- **Source-derived:** diffs, snippets, file names, symbol graphs, command output, patches, prompts. Governed by REQ-142.
- **Metadata:** identifiers, statuses, counts, timestamps, severities, keyed-HMAC fingerprints, usage figures. Retained under account policy.
- **Secret:** credentials and tokens. Encrypted, never returned to a client, never logged.

### Core entities

#### `organizations`

`name`, `slug`, `timezone`, `region`, `retentionPolicy`, `monthlyBudget`, `concurrencyLimit`, `planId`, `fingerprintKeyVersion`, `createdAt`, `deletedAt`. The HMAC key itself lives only in the managed key service and is not a Convex field.

#### `memberships`

`organizationId`, `userId`, `role`, `status`, `createdAt`.

#### `githubInstallations`

`organizationId`, `installationId`, `accountLogin`, `accountType`, `permissionSnapshot`, `status` (`active`, `suspended`, `removed`), `suspendedAt`, `createdAt`, `updatedAt`.

#### `repositories`

`organizationId`, `installationId`, `githubRepositoryId`, `owner`, `name`, `defaultBranch`, `enabled`, `pausedAt`, `autofixMode`, `forkPolicy`, `configRevisionId`, `indexState`, `concurrencyLimit`, `createdAt`, `updatedAt`.

All lookups key on `githubRepositoryId`, which survives renames and transfers.

#### `configRevisions` (new)

`repositoryId`, `sourceCommitSha`, `sourceRef`, `configArtifactId`, `contentHash`, `rulesDigest`, `schemaVersion`, `validationState`, `provenance` (`protected_ref_merge`, `explicit_admin_approval`, `defaults_only`), `refProtectionState` (`verified`, `unverified`), `approvedBy`, `approvedAt`, `createdAt`.

The configuration body is an artifact reference rather than inline JSON, because a configuration snapshot is source-derived content and must expire with everything else.

v1.0 referenced `configRevision` on two tables without defining what it pointed at. This entity is what a review pins, and it is what makes the trusted-revision rule auditable.

#### `providerCredentials`

`organizationId`, `provider`, `encryptedCiphertext`, `nonce`, `authTag`, `aadDigest`, `keyVersion`, `maskedSuffix`, `status`, `createdBy`, `createdAt`, `lastValidatedAt`, `lastUsedAt`, `revokedAt`. Plaintext never appears in a query return value.

#### `trackerConnections`

`organizationId`, `provider`, encrypted OAuth tokens, scopes, workspace or site identity, expiry, status, creator, timestamps.

#### `reviews`

`organizationId`, `repositoryId`, `githubRepositoryId`, `prNumber`, `isFork`, `baseRef`, `baseSha`, `headSha`, `githubCheckConclusion`, `requiredCheckPolicy`, `completedRoundCount`, `patchAttemptCount`, `diagnosticRunCount`, `providerRetryCount`, `commandRetryCount`, `trigger`, `triggerActor`, `triggerActorPermission`, `mode`, `status`, `terminationBound`, `budgetCeilingId`, `budgetLimit`, `budgetConsumed`, `statusReasonCode`, `nextActionCode`, `isStale`, `staleSince`, `observedHeadSha`, `trustedRef`, `trustedRefSha`, `configRevisionId`, `configProvenance`, `provider`, `model`, `modelVersion`, `promptVersion`, `evalSetVersion`, `coverageLevel`, `currentStage`, `blockedReason`, `blockedSince`, `blockedExpiresAt`, `parentReviewId`, `attemptOfReviewId`, `cancelledBy`, `sandboxId`, `runnerImageVersion`, `startedAt`, `completedAt`, `expiresAt`.

Indexes: organization and status; repository, PR, and head; expiry; queue position; blocked expiry.

Fields added in v1.3: `githubCheckConclusion`, `requiredCheckPolicy`, and the five counters, so that the published GitHub conclusion and every bound are reconstructable from the record rather than recomputed from prose. Fields added in v1.2: `terminationBound`, `statusReason`, `trustedRef`, `trustedRefSha`, `configProvenance`, `blockedSince`, `blockedExpiresAt`, `baseRef`, `runnerImageVersion`. `terminationBound` is what makes a single `failed_after_bounds` status sufficient. `trustedRef` and `trustedRefSha` make it auditable which bytes governed a review, which the trusted-ref rule is worthless without.

#### `reviewEvents`

Append-only: `reviewId`, `sequence`, `type`, `stage`, `publicMessageArtifactId`, `internalCode`, `metadata`, `createdAt`. Event metadata is small, redacted, and allowlisted; repository names, paths, command text, and model-authored prose are never stored in it.

#### `requirements`

`reviewId`, `sourceType`, `sourceUrl`, `externalId`, `contentArtifactId`, `fetchedVersion`, `fetchedAt`, `status`, `confidence`, timestamps. Ticket titles and statements live in the expiring artifact, not inline.

#### `findings`

`reviewId`, `fingerprintHmac`, `category`, `severity`, `confidence`, `blocking`, `contentArtifactId`, `evidenceIds`, `pathHmac`, `startLine`, `endLine`, `ruleId`, `requirementId`, `resolution`, `createdAt`, `updatedAt`. Finding title, impact, source paths, evidence excerpts, and source links live in the expiring encrypted artifact.

#### `findingSuppressions` (new)

`organizationId`, `repositoryId`, `fingerprintHmac` (keyed HMAC under the per-organization key, non-reversible, metadata class), `hmacKeyVersion`, `scope` (`commit`, `pull_request`, `path`, `repository`), `scopeValue`, `reason`, `dismissedBy`, `dismissedAt`, `expiresAt` or null.

Separated from `findings` so that suppression survives source-derived expiry, per REQ-260.

#### `checkRuns`

`reviewId`, `roundId`, `kind`, `name`, `required`, `status`, `conclusion`, `commandFingerprint`, `exitCode`, `durationMs`, `artifactId`, `failureClass`, `startedAt`, `completedAt`.

- `kind`: `test`, `lint`, `typecheck`, `build`, `static_analysis`, `dependency_audit`, `secret_scan`, `custom`.
- `conclusion`: `passed`, `failed`, `not_run`, `timed_out`, `truncated`, `flaky`.

These are BuildIT's internal check outcomes. They are distinct from the GitHub Check Run conclusion, which is derived from the review status through the normative matrix in REQ-105 and takes the values `success`, `failure`, `neutral`, and `action_required`. The two vocabularies are never mixed, and the GitHub conclusion is stored on the review, not on individual check rows.
- `failureClass`: `code`, `environment`, `tooling_missing`, `timeout`, `resource_limit`, `network_blocked`, `platform`.

v1.0 used these fields without enumerating their values, which meant every consumer would have invented its own.

#### `baseResults`

`repositoryId`, `baseSha`, `commandFingerprint`, `configRevisionId`, `runnerImageVersion`, `toolVersions`, `architecture`, `networkPolicyVersion`, `conclusion`, `artifactId`, `computedAt`, `expiresAt`.

The full tuple is the cache key. A result computed under a different runner image or a different resolved tool version is a different result, and serving it as a base comparison would silently misclassify regressions.

#### `autofixAttempts` (new in v1.2)

`reviewId`, `attemptNumber` (1 to 6), `patchFingerprint`, `patchArtifactId`, `outcome` (`applied`, `rejected`, `empty`, `repeated`), `rejectionReason`, `promptVersion`, `startedAt`, `completedAt`.

#### `autofixRounds`

`reviewId`, `roundNumber` (1 to 3), `attemptId`, `candidateCommitSha`, `validationScope` (`affected_subset`, `final_validation`), `validationOutcome`, `completedValidation`, `startedAt`, `completedAt`.

Constraints: unique `(reviewId, attemptNumber)` with `attemptNumber` in 1 to 6; unique `(reviewId, roundNumber)` with `roundNumber` in 1 to 3; every round references exactly one attempt whose `outcome` is `applied`; delivery requires at least one round row with `validationScope = final_validation`.

v1.1 put `roundNumber` and `attemptNumber` on one table with uniqueness constraints on both. That is incoherent, because rejected, empty, and repeated patches consume attempts without producing rounds, so the two counters have different cardinalities and different lifecycles. Splitting them is what makes the five bounds in REQ-245 auditable rather than merely asserted.

#### `artifacts`

`organizationId`, `reviewId`, `type`, `storageKey`, `encrypted`, `checksum`, `size`, `redactionStatus`, `expiresAt`, `deletedAt`, `deletionAttempts`.

#### `usageLedger` (new)

Append-only: `organizationId`, `repositoryId`, `reviewId`, `roundId`, `kind` (`model_tokens`, `model_spend`, `sandbox_seconds`, `vcpu_minutes`, `storage_bytes`), `quantity`, `unitCost`, `currency`, `occurredAt`.

#### `githubSideEffects`

`reviewId`, `operationKey`, `type`, `externalId`, `requestHash`, `status`, timestamps. Unique `operationKey` prevents duplicates.

#### `webhookDeliveries`

`deliveryId`, `event`, `action`, `installationId`, `signatureValid`, `disposition` (`processed`, `ignored_bot`, `ignored_edit`, `duplicate`, `rejected`), `status`, `reviewId`, `receivedAt`. Unique delivery ID.

#### `notifications` (new)

`organizationId`, `userId`, `type`, `channel`, `reviewId`, `sentAt`, `deliveryStatus`, `dedupeKey`.

`dedupeKey` prevents repeat budget-threshold emails.

#### `auditEvents`

Append-only actor, action, resource, result, request, and time records, with no source content and no secrets.

#### `metricEvents`

Append-only named events with review, round, and repository dimensions and the organization timezone.

### Required invariants

- A review never changes `headSha` after creation.
- A PR may have many historical reviews but at most one active review per head and mode.
- An Autofix job has no more than three completed rounds and no more than six attempts.
- A passed check always refers to an exact commit.
- A terminal status never becomes an active status; a retry creates a new job with `attemptOfReviewId` set.
- `isStale` may be set on any record and never rewrites `status`.
- Source-derived records have `expiresAt`; metadata records may not.
- No client query can return encrypted credentials or the organization fingerprint salt.
- Every review references exactly one `configRevisionId`, and that revision's `sourceCommitSha` is never the PR head.

---

## 13. System architecture

### Trusted tier, split into two services

The trusted tier is not one thing. Splitting it is what makes the confidentiality claims in section 14 verifiable.

**Control plane.** Users, organizations, authorization, state, orchestration, billing, notifications, and metadata. It holds GitHub credentials and database credentials. It holds no path to repository content, and that absence is a tested property rather than a convention.

**Content broker.** A narrow service that reads approved artifacts, applies redaction and exclusion, assembles model requests, calls the provider, and returns structured findings and patch proposals. It holds the provider key at call time and nothing else: no GitHub write token, no administrative database credential, no long-term storage, and egress limited to the model providers. Artifact access is scoped per review and expires with the job.

### Control plane

- Next.js web application on Vercel.
- Node.js server functions for OAuth callbacks, webhook entry, and APIs requiring Node crypto.
- Convex for transactional product state, reactive queries, durable scheduling and workflow, and small redacted events.
- Object storage for encrypted, expiring artifacts.
- Managed key service for the master encryption key.
- Provider adapter for Anthropic and OpenAI.
- Transactional email provider for notifications.

### Execution plane

- One ephemeral sandbox per review attempt, created with an explicit timeout chosen for the job type rather than the platform default.
- Clone of pinned commits, using a short-lived installation token for same-repository pull requests, and with no token present during execution for fork pull requests.
- Separate dependency-install and validation network policies.
- Runner supervisor owns commands, limits, snapshots, redaction, and teardown.
- The model cannot obtain sandbox credentials or arbitrary shell access, and the sandbox has no route to any model provider.

### Sandbox lifetime and the multi-round problem

An Autofix job interleaves sandbox execution with control-plane model calls, so its wall-clock duration is dominated by model latency rather than by test time. Vercel Sandbox instances are ephemeral, default to a five-minute timeout, and are capped by plan tier. Two implementation options are acceptable, and one must be chosen before Milestone 2:

- **Long-lived sandbox:** create the sandbox with an explicit timeout that covers the entire bounded job, and treat that timeout as one of the enforced limits.
- **Re-provision per round:** destroy and recreate the sandbox between rounds, restoring the workspace from a snapshot and re-running a deterministic install.

Both must record the true cost. The second is more robust to platform limits and more expensive per round. Neither may report a check as passed unless that check actually executed in the same workspace state as the final agent commit.

### Context and token budget

Retrieval, analysis, and Autofix each run under a declared token budget. The orchestrator, not the model, decides what fits. Exclusion decisions are recorded and surfaced as coverage limits. This is what makes REQ-047, the promise not to claim more coverage than was achieved, enforceable.

### Agent roles

- **Context agent:** identifies requirements and retrieves relevant code. Read-only.
- **Review agent:** proposes structured findings from context and tool evidence. Read-only.
- **Builder agent:** proposes patches for authorized findings. Cannot run commands itself.
- **Orchestrator:** deterministic application code that owns state, permissions, limits, rounds, attempts, command selection, validation, evidence verification, and delivery.

Separate roles do not require separate model providers or simultaneous agents. They are permission and prompt boundaries.

### Tool contracts

Every model tool has a strict, versioned input and output schema. Important tools:

- `search_repository(query, paths, limit)`
- `read_file(path, startLine, endLine)`
- `read_requirement(id)`
- `list_changed_symbols()`
- `get_check_result(checkId)`
- `report_finding(finding)`
- `propose_patch(files, rationaleSummary)`
- `request_validation(scope)`

Tools reject unauthorized paths and excessive output server-side. Model text never becomes a command. Every evidence identifier returned by `report_finding` is validated against real artifacts before the finding can be published.

### Durable workflow stages

1. Verify the trigger, resolve the actor's repository permission, and authorize.
2. Pin repository and PR state, and resolve the trusted configuration revision.
3. Check budget and capacity, and compute the pre-flight estimate.
4. Acquire and classify context under the token budget.
5. Provision the sandbox with an explicit timeout.
6. Install dependencies under the install-stage policy.
7. Run baseline and PR checks as configured, using the base result cache where valid.
8. Analyze, synthesize, deduplicate, and verify evidence for findings.
9. Commit-sensitive head compare-and-swap, then publish the current review.
10. Await or validate Autofix authorization.
11. Run the bounded edit and validate loop.
12. Full final validation, then a commit-sensitive head compare-and-swap, then create the GitHub branch and deliver the candidate.
13. Publish the terminal report, usage ledger entries, and metrics.
14. Revoke tokens and destroy the workspace.
15. Expire source-derived data on schedule.

---

## 14. Security threat model

### Protected assets

- Customer source code and intellectual property.
- Provider keys and OAuth tokens.
- GitHub write access.
- BuildIT control-plane credentials.
- Audit integrity.
- Customer budget and model quota.
- Tenant isolation.

### Primary threats and controls

| Threat | Control |
|---|---|
| Prompt injection in code, tickets, or logs | Treat as untrusted data; fixed control policy; named tools; server-side authorization; rules read from the trusted revision only. |
| Attacker-controlled configuration in the PR under review | Configuration and rules are read from the approved revision on the trusted ref; org security limits cannot be relaxed by repository files; a configuration change in a PR raises a finding and requires approval. |
| Pull request targeting an unprotected base branch to smuggle configuration | Configuration comes from the approved revision on the trusted ref, never from an arbitrary PR base. |
| Trusted ref itself is unprotected, so a merge is not an approval | Protection is verified through the branch rules endpoint; where it cannot be verified, merges are not approval and explicit Admin approval is required. |
| Compromise of the trusted tier reaching customer source | Control plane holds no path to source content; only the content broker reads it, with no write token, no administrative database credential, no long-term storage, and egress limited to model providers. |
| Approved package later ships a malicious version | Build-script allowlist entries bind package name, exact version, and lockfile integrity hash; a version bump requires re-approval. |
| Untrusted archive handling inside the trusted tier | Fetch, teardown, and execution are separate isolated runner stages; the control plane never unpacks repository content. |
| Cancellation used as a merge-gate bypass | Cancellation publishes `action_required`, never `neutral`. |
| Compute theft through a declared validation command | Egress denial, CPU and wall-clock ceilings, trial compute quota, anomaly detection, organization suspension. |
| Injection through BuildIT's own published output | Output sanitisation of mentions, command strings, HTML, and remote images, plus redaction over model output. |
| Insider access to customer source | No standing staff access; break-glass with second-person approval, customer-visible audit entry, and owner notification. |
| Audit log tampering | Per-organization hash chain with a recorded chain head. |
| Fork pull request used to steal a repository token, the "pwn request" pattern | No GitHub token present in the sandbox while fork code executes; automatic triggers off for forks; maintainer-only trigger; no Autofix. |
| Malicious repository execution | Ephemeral microVM, no control-plane secrets, denied egress, resource limits, teardown. |
| Malicious dependency lifecycle script | Lockfile-only install, build scripts limited to a reviewed allowlist bound to package name, exact version, and lockfile integrity hash, isolated install stage with restricted egress. |
| Key theft through the test process | Provider calls occur outside the sandbox; the key never enters the runner environment and the runner has no route to the provider. |
| Command injection | Argument-array execution, allowlisted commands from the trusted revision, no shell interpolation. |
| Unauthorized branch modification | GitHub permission check at trigger and at each write, repository policy, head compare-and-swap, stacked default, no force push. |
| Webhook forgery or replay | Raw-body HMAC verification with timing-safe comparison, delivery-ID idempotency, timestamp monitoring, and rejection before parsing. |
| Comment-edit replay to trigger work | Only `created` comment events may trigger. |
| Bot-to-bot comment loop | Bot-authored comments never trigger; per-PR loop guard pauses the repository and alerts. |
| Cross-tenant data access | Organization-scoped authorization on every query, action, and storage key; ciphertext bound to the organization through additional authenticated data. |
| Secret leakage in logs | Streaming redaction before persistence, output limits, seeded redaction tests. |
| Supply-chain scripts | Isolated install stage, restricted egress, no control credentials, lockfile enforcement. |
| Model cost denial of service | Actor authorization, pre-flight estimate, per-review budget, organization budget, concurrency limits, push debounce. |
| Duplicate side effects after a crash | Durable operation keys and reconciliation against GitHub. |
| Fabricated evidence in a finding | Orchestrator validation of every cited evidence identifier against stored artifacts. |
| Availability abuse of a required check | Neutral conclusion on platform failure so BuildIT cannot become an organization-wide merge block. |

### Required security testing

- Webhook signature and replay tests.
- Comment-edit and bot-author trigger rejection tests.
- Tenant-isolation tests, including cross-tenant ciphertext replay.
- Encryption round-trip and rotation tests.
- Sandbox escape attempts appropriate to the provider.
- Egress-denial tests.
- Fork execution tests that assert the absence of any usable GitHub credential.
- Configuration-from-head tests that assert head configuration is never applied.
- Seeded secret-redaction tests.
- Shell-metacharacter tests.
- Prompt-injection corpus tests, including injected text in `.buildit/rules.md` on the head.
- Branch-race and force-push tests.
- Permission downgrade and removal tests.
- Dependency supply-chain scenario tests, including lifecycle-script attempts.
- Budget and attempt-bound exhaustion tests.
- Trusted-ref tests using a pull request whose base is a contributor-controlled branch.
- Credential-teardown tests asserting token revocation before execution starts.
- Required-check policy tests for `advisory`, `fail_open`, and `fail_closed`, including cancellation behaviour.
- Output-sanitisation tests using findings that contain mentions, BuildIT commands, HTML, and remote images.
- Retention tests that enumerate every field marked source-derived and assert unreadability after expiry.

---

## 15. Interface specification

### Design intent

**Human:** an engineering lead deciding whether a change is ready while moving between GitHub, terminal, and release work.
**Primary verb:** decide.
**Feel:** a calm evidence room, dense enough for engineers, quiet enough to see risk immediately, never theatrical "AI magic."

### Domain exploration

- **Domain:** diffs, checks, evidence, commit lineage, gates, traces, incident prevention, handoff.
- **Color world:** graphite terminal, paper-white diff, muted steel, pass green, warning amber, failure red, link blue.
- **Signature:** an "evidence rail" that connects requirement to changed code to check result to delivered commit.
- **Rejecting:** a generic metric-card dashboard in favour of an action queue; a chat-first agent UI in favour of evidence-first review; animated agent thoughts in favour of a stable stage timeline.

### Navigation

- Review Queue
- Repositories
- Metrics
- Usage
- Integrations
- Policies
- Members
- Audit Log

The organization switcher and global search belong in persistent navigation. Provider keys live under Integrations, not as a top-level daily destination.

### Review Queue

Focal point: work needing a decision.

Each row shows repository and PR, title, head age, current status, stale flag, highest severity, validation coverage, responsible next actor, and elapsed time. Default sort puts blocked human decisions first, then active high-risk reviews, then queued work, then recent completions.

### Review Detail

1. Decision header: exact status, commit, stale indicator, bound that ended the job where applicable, next action.
2. Evidence rail: requirements covered, changed areas, checks, candidate commit.
3. Findings: grouped by severity and category, with filters, confidence, and resolution state.
4. Validation matrix: required or optional, pass, fail, not run, duration, failure class, artifact.
5. Autofix rounds: patch summary, attempt count, and checks for each round.
6. Cost panel: model spend, sandbox time, and budget consumed by this review.
7. Event timeline: factual stage events.
8. Raw logs: collapsed and secondary.

### Visual system requirements

- Four-level text hierarchy.
- 4px spacing base with compact 12 to 16px workbench padding.
- Borders and surface shifts as the primary depth strategy; minimal shadows, for overlays only.
- One non-semantic accent; green, amber, and red reserved for status.
- Tabular numerals for durations, counts, commits, and costs.
- No gradients and no decorative AI glow.
- Motion under 250ms for occasional surfaces; no animation on repeated navigation; honour reduced motion.
- Desktop minimum supported width 1024px; responsive reading down to 360px.

### Required states per component

Default, hover, pressed, keyboard focus, disabled, loading, empty, error, permission denied, stale, disconnected, partial, queued, blocked, action-required, budget-exhausted, and success where applicable. `action_required` in particular needs a real visual state, because it is the conclusion BuildIT publishes for cancellation, blocked, and budget stops, and it must not look like a generic failure.

### UI reference audit and binding corrections

The Stitch archive is visual direction, not production-ready source. Keep its calm evidence-room character, compact tables, status chips, and decision-first detail page. Correct these issues during implementation:

1. The model-key screen has a failed dark-theme export: page text and navigation lose contrast against black. V1 ships one tested light theme; no dark theme is exposed until every setup and review state passes contrast checks.
2. Repository protection states are mutually exclusive. Never show `Protected` and `Unverified` notices at the same time; show the detected state, its evidence, and one remedy.
3. The first Review Detail reference clips cells and evidence at its canvas edge. Tables must use responsive columns, safe wrapping, and a contained horizontal scroller only for code-like data. The page itself must not overflow.
4. The corrected Review Detail is the layout baseline, but its sentence "Every verdict cites a file and line" is too strict for a `not covered` verdict. Absence evidence may instead cite the searched scope and query artifact. The UI must say "Every verdict includes validated evidence."
5. The queue budget display must include currency, period, and reset date, and must not imply that BYOK model spend is the only cost.
6. Setup needs explicit saving, retrying, revoking, permission-denied, expired-key, disconnected, and resumed states. A happy-path screenshot does not satisfy setup acceptance criteria.
7. Status chips require text and an icon, never color alone. Focus rings, 44px targets, semantic table headers, live-region announcements for confirmed stage changes, and reduced-motion behavior are mandatory.
8. The archive does not cover Policies, Integrations, Usage, Metrics, Members, Audit Log, mobile Review Detail, Autofix rounds, cancellation, stale results, or artifact expiry. These are required product screens or states and must be designed before their milestone is accepted.

---

## 16. Model and prompt policy

- Provider and model selection is configuration, not a hard-coded architecture assumption. Provider-specific message and tool semantics live in per-provider adapter annexes.
- Only models passing BuildIT's tool-use, patch, security, and cost evaluations appear as supported.
- Strict schema output constrains shape, not truth.
- Prompts prohibit merge, permission changes, secret requests, arbitrary command construction, approval of skipped checks, and claims unsupported by evidence.
- Review output must cite tool evidence identifiers, and the orchestrator validates each one against a stored artifact before publication. A finding citing an unknown identifier is dropped and recorded as a model-integrity event.
- Builder output is a patch proposal plus a short evidence summary; it cannot mark its own work passed.
- The orchestrator alone computes terminal status.
- Model refusal, truncation, malformed output, and unsupported schema each have explicit failure handling.
- Prompts, evaluation sets, and model versions are versioned, and every review records the versions used in the fields defined in section 12.
- **Determinism policy:** sampling temperature is low and the model version is pinned per review, but BuildIT does not claim reproducible output. The product never tells a user that re-running will produce the same findings. Stability across runs is provided by fingerprints and suppression, not by model determinism.

---

## 17. Quality and evaluation plan

### Offline evaluation set

Maintain versioned repositories and pull requests containing:

- Logic regressions.
- Missing edge cases.
- Requirement mismatches.
- Authentication and authorization flaws.
- Injection vulnerabilities.
- Dependency risks.
- Concurrency bugs where supported.
- False-positive traps.
- Malicious prompt injection, including in `.buildit/rules.md` and in ticket text.
- Configuration-tampering pull requests.
- Fork pull requests carrying credential-harvesting test code.
- Flaky and pre-existing failures.
- Safe and unsafe Autofix opportunities.

### Release gates with numeric targets

v1.0 listed gates without thresholds, which makes them unenforceable. Initial targets, to be recalibrated with design partners after Milestone 1:

| Gate | Target |
|---|---|
| Precision on seeded Critical and High findings | at least 80 percent of surfaced findings judged correct by a human rater |
| Recall on seeded Critical findings | at least 70 percent detected |
| False-positive rate on the trap set | at most 10 percent of trap cases produce a blocking finding |
| Merge-boundary violations | zero, absolute |
| Plaintext secrets in tested storage or log paths | zero, absolute |
| Fourth Autofix round in property tests | zero, absolute |
| Out-of-scope or protected-path modification in the adversarial suite | zero, absolute |
| Head-configuration application in the tamper suite | zero, absolute |
| Credential reachable during fork execution | zero, absolute |
| Stale commit producing a current pass | zero, absolute |
| Duplicate comments or PRs after webhook replay and worker restart | zero, absolute |
| Accessibility audit on core flows | no critical or serious violations |
| Supported repository fixtures passing end to end | 100 percent of the fixture set |

### Service level objectives

Initial internal objectives for V1, published externally only once measured:

- Median time from trigger to published evidence report: under 6 minutes for repositories under 100,000 lines with a test suite under 5 minutes.
- 95th percentile: under 20 minutes for the same class.
- Control plane availability: 99.5 percent monthly.
- Webhook acknowledgement: 99.9 percent within 10 seconds.
- Review completion rate excluding customer-side failures: at least 98 percent.

### Online safeguards

- Feature flags by organization and repository.
- Kill switches for the model provider, Autofix, direct push, and the runner.
- Per-provider and per-runner health dashboards.
- Sampled human review of anonymized and redacted operational outcomes, only where customer policy permits.
- Rollback of prompt and model versions.

---

## 18. Rollout plan

The product sponsor assigns a named delivery owner before the first production change, a security owner before Milestone 1 security work, and a legal owner before any scanner rule is bundled. Calendar dates are set at kickoff from actual team capacity; the milestone order and exit gates below are fixed.

### Milestone 0: Walking skeleton

One internal TypeScript repository, manual dashboard trigger, pinned commit, sandbox test execution, one summary, no Autofix.

Exit: an exact-commit review survives retries and destroys its workspace.

### Milestone 1: Trustworthy reviewer

GitHub App, GitHub Issues, trusted-revision configuration and rules, licence-clean scanners, findings, Check Run, dashboard queue and detail, BYOK, budgets, concurrency limits, notifications, retention, audit.

Exit: design partners use review-only mode on real pull requests with acceptable noise and no secret, tenant, or security failures.

### Milestone 2: Safe Autofix

Stacked PRs, the bounded loop with four Autofix termination bounds plus the independent spend ceiling, protected paths, snapshot rollback, branch-race handling, round evidence, and deterministic sandbox lifetime handling.

Exit: adversarial tests prove bounded behavior, successful fixes pass configured checks, and failed fixes never alter source branches.

### Milestone 3: Product completeness

Incremental reviews, cancellation, metrics, usage view, polished setup, empty and error states, operational tooling, runbooks, status page.

Exit: a new design partner can self-serve from installation to a useful reviewed PR without BuildIT team intervention.

### Milestone 4: Integration expansion

Linear, Jira, Python, CLI general availability, optional direct push, Slack notifications.

Exit: each addition meets the same security, exact-commit, evidence, cost, and lifecycle gates.

---

## 19. Launch definition

BuildIT is ready for a public V1 only when:

- A user can self-serve installation, key setup, repository configuration, first review, and result interpretation.
- Supported repositories execute in isolation with no control-plane secrets, and fork pull requests execute with no repository credential present.
- Configuration and rules are provably read from the trusted revision, verified by the tamper suite.
- Results are exact-commit, evidence-backed, and visibly stale after new pushes. Every commit-sensitive GitHub write is protected by a head compare-and-swap, and every reconciliation write names the commit it refers to.
- Review noise can be dismissed and remains suppressed correctly across retention expiry.
- Autofix defaults to a stacked PR and stops at the first bound reached, with the bound named in the report.
- No tested path merges, force-pushes, or writes the protected base branch.
- Retention and deletion work automatically, and deletion failures alert.
- Spend is attributed, capped, estimated in advance, and visible before it is incurred.
- Concurrency, queueing, and debounce prevent a burst of pull requests from exhausting budget or GitHub rate limits.
- Notifications reach the right person for every decision-required and failure event.
- Metrics have precise definitions and reconcile against events.
- All major error, empty, blocked, stale, queued, budget, and cancellation states have usable UI.
- Legal sign-off exists on the static-analysis rule inventory, the subprocessor list, and the DPA.
- The trusted-ref rule is proven by a test using a pull request whose base branch the contributor controls, and by a test where the trusted ref has no verifiable protection.
- The consistency lint in Appendix D passes on this document, and no flow, edge case, or acceptance criterion contradicts a requirement.
- The content broker holds no GitHub write token, no administrative database credential, and no long-term storage, verified by test.
- Credential teardown before execution is proven by token revocation, and the control plane is proven never to unpack repository content.
- The required-check policy is explicit per repository, and cancellation cannot satisfy a required check.
- Every source-derived field is enumerated and provably unreadable after retention expiry.
- Break-glass staff access, backup restore, and the recovery objectives have each been exercised once in a drill.
- A security contact, disclosure policy, and status page are published.
- On-call staff can identify, pause, retry, reconcile, and terminate failed workflows safely, demonstrated in a launch readiness drill covering every runbook in REQ-280.

---

## 20. Design partner demo script

_Runs 20 to 30 minutes. This replaces the "Saturday demo" heading in v1.0, which was an internal scheduling note rather than a product artifact._

### Demo repository

A supported TypeScript repository with:

- A linked GitHub Issue containing explicit acceptance criteria.
- A PR with one known logic regression and a missing boundary test.
- Stable deterministic tests.
- A repository rule relevant to the changed area, committed on the trusted ref and approved.
- No hidden external service dependency.

### Script

1. Open the PR and show its exact head commit.
2. Comment `@buildit review`.
3. Show the Check Run appearing in progress within seconds.
4. Open Review Detail. The stage timeline shows context, issue retrieval, affected-code retrieval, sandbox preparation, and validation.
5. Show the evidence rail connecting the acceptance criterion to the changed function and the failing test.
6. Show the cost panel, with the pre-flight estimate and the actual spend.
7. GitHub receives one finding and one continuously updated summary.
8. Comment `@buildit autofix stacked`.
9. Round one edits the code and adds or updates a test; required validation passes.
10. BuildIT opens a stacked PR targeting the original PR branch.
11. Show its exact commit, changed files, check matrix, attempt and round counters, and remaining-risk section.
12. Show that the original branch and the base branch were not modified.
13. A human reviews and merges the stacked PR into the original PR branch, then uses GitHub's native merge control for the original PR.
14. Open Metrics and read the exact weekly interval plus reviewed heads, unique PRs, regressions caught, delivered fixes, merged fixes, and round-to-pass distribution.

### Optional adversarial segment, 5 minutes

15. Push a commit to the PR that edits `.buildit/config.json` to add a new command and widen the network allowlist.
16. Re-run the review and show that the approved trusted-ref configuration was used, that the new command did not run, and that a configuration-change finding appeared naming the ref and commit that governed the run.

### Demo failure fallback

Prepare a recorded run and retained redacted evidence for provider or GitHub outages, but do not present a recording as live. The live UI must state the external failure honestly.

---

## 21. Success metrics

### North-star measure

**Verified review handoffs per week:** unique PR head commits that reached a terminal evidence-bearing status, meaning `checks_passed`, `changes_requested`, `inconclusive` with a stated reason, `delivered`, or `failed_after_bounds`, with complete evidence, excluding platform failures, cancellations, budget stops, and internal demo events.

v1.0 counted only `checks_passed`, `delivered`, and `failed_after_three_rounds`. That excluded `changes_requested`, which is the most common useful outcome, and so the north star would have fallen whenever the product was working well on imperfect pull requests.

### Adoption and activation metrics

- Time from installation to first completed review.
- Percentage of installations that complete a first review within 24 hours.
- Repositories with at least one review per week, week over week.
- Percentage of pull requests in an enabled repository that receive a review.
- Second-week and fourth-week organization retention.

### Outcome metrics

- Unique PRs and unique PR heads reviewed.
- Newly caught test regressions, reported separately from confirmed requirement mismatches.
- Candidate fixes generated, delivered, merged, and later reverted.
- Pass on Autofix round 1, 2, and 3, and distribution of the bound that ended unsuccessful jobs.
- Median time from trigger to evidence report.
- Median human time from report to merge or close.

### Trust metrics

- Finding acceptance and dismissal rates by severity, category, and confidence.
- Reopened finding rate.
- Fix reversion rate within 7 and 30 days, reported as unavailable where the `push` subscription is off.
- Stale-result prevention events, meaning head compare-and-swap aborts.
- Reviews with skipped required checks.
- Secret-redaction incidents, security-policy blocks, and model-integrity events.

### Reliability and cost metrics

- Review completion rate.
- Sandbox setup failure rate.
- Provider failure and retry-exhaustion rate.
- GitHub side-effect reconciliation count.
- Queue wait time, P50 and P95.
- P50 and P95 duration by repository size.
- Model spend and sandbox compute per review, per repository, and per delivered fix.
- Gross margin per active repository, once pricing exists.

No marketing claim may turn these measures into "bugs prevented" without a documented causal definition.

---

## 22. Commercial model

v1.0 contained no commercial model at all, which left cost of goods, packaging, and the meaning of BYOK undefined while simultaneously proposing budgets and quotas. This section states the intended shape and marks what is still open.

### Cost structure

- **Customer pays directly:** model inference, through their own provider key.
- **BuildIT pays:** sandbox compute, object storage, Convex, hosting, email.

Sandbox compute is the dominant variable cost and scales with repository size and test duration, not with seat count. Any pricing model that charges purely per seat will be inverted by one customer with a large monorepo and a slow test suite.

### Intended V1 packaging

- Seat-based subscription for dashboard access, plus a monthly included allowance of reviewed head commits per repository.
- Overage priced per reviewed head commit, with the pre-flight estimate shown before each run.
- BYOK required in V1. A managed model allowance is deferred and is tracked as OD-07.
- A free trial bounded by reviewed head commits rather than by days, so that the trial cannot be exhausted by one large repository.

### Required disclosures

- BYOK covers model spend only, not BuildIT platform cost.
- Sandbox minutes consumed are visible per review.
- Budget ceilings stop work rather than silently degrading the review.

### Open

Exact prices, allowance sizes, and whether large-repository surcharges apply are unresolved and are tracked in section 24.

---

## 23. Risk register

| # | Risk | Impact | Likelihood | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | Review noise drives Dev to disable BuildIT in week one | Fatal to adoption | High | Confidence floor for blocking, aggressive deduplication, suppression that survives retention, precision release gate, Dev treated as a first-class user | Product owner |
| R2 | Static-analysis rule licensing blocks SaaS distribution | Legal exposure and a launch delay | High if unaddressed | Licence-clean rule inventory decided in OD-02 with legal sign-off before Milestone 1 exit | Legal owner |
| R3 | Sandbox compute cost exceeds revenue per repository | Negative gross margin | Medium | Usage ledger from day one, per-review ceilings, base result cache, debounce, pricing tied to reviewed heads | Product owner |
| R4 | A fork pull request extracts a repository token | Critical security incident | Medium if the hardened model is not implemented | REQ-230 and REQ-231, plus a dedicated test in the security suite | Security owner |
| R5 | Configuration tampering inside a pull request gains command execution or a wider egress allowlist | Critical security incident | Medium if unaddressed | Trusted-revision rule REQ-210 to REQ-212, tamper suite, configuration-change finding | Security owner |
| R6 | Autofix produces a plausible but wrong patch that a human merges | Trust collapse and a production defect | Medium | Stacked PR default, full check matrix on the agent commit, remaining-risk section, reversion metric, no merge authority | Product owner |
| R7 | Platform dependency change, meaning sandbox limits, Convex limits, or GitHub API changes | Rework and outage | Medium | Runner behind an interface, documented limits encoded as constants with tests, kill switches | Delivery owner |
| R8 | Model provider price or capability change makes the unit economics or the review quality shift | Margin and quality | Medium | Provider-neutral adapter, evaluation gate per model, budget ceilings | Product owner |
| R9 | Incumbents ship requirement coverage and an execution loop first | Loss of differentiation | Medium | Ship Milestone 1 and 2 quickly with design partners, keep the evidence and honesty posture as the durable difference | Product owner |
| R10 | A single organization's pull-request burst exhausts GitHub rate limits for the whole installation | Broad outage for that customer | Medium | Per-installation API budget tracking, proactive backoff, concurrency ceilings, debounce | Delivery owner |
| R11 | Retention deletion silently fails and customer source-derived data persists | Contractual and trust breach | Low | Auditable deletion job, failure alerting, deletion attempt counter, AC-221 | Security owner |
| R12 | Enterprise procurement blocks on the absence of SOC 2 and self-hosting | Blocked upmarket motion | High, later | Honest posture in V1, certification and self-hosting on the V3 roadmap, DPA and subprocessor list available now | Product owner |
| R13 | Free-trial compute theft through a declared validation command | Direct cost and platform abuse | Medium | REQ-325 quota, egress denial, anomaly detection, organization suspension | Delivery owner |
| R14 | Vendor concentration across hosting, database, and GitHub | Correlated outage with no fallback | Medium | REQ-319 documented position, runner behind an interface, kill switches | Delivery owner |
| R15 | Insider or support access to customer source | Confidentiality breach and loss of enterprise trust | Low | REQ-315 break-glass with second-person approval, customer-visible audit, owner notification | Security owner |
| R17 | Specification drift between requirements and flows ships the old behaviour, since engineers implement from flows | Defects reach production that the document technically forbids | High, demonstrated three revisions running | Normative precedence in the document control section, Appendix D lint, and regeneration of illustrative sections on every requirement change | Delivery owner |
| R18 | The content broker becomes a de facto second control plane as features accrete | The confidentiality boundary erodes silently | Medium | Explicit privilege list in REQ-335, separate credentials, AC-325 audited each release | Security owner |
| R16 | A repository configures BuildIT as a required check under the wrong policy and either blocks all merges or gates nothing | Outage or false assurance | Medium | REQ-252 three explicit policies, dashboard warning on mismatch, `advisory` default | Product owner |

---

## 24. Implementation defaults and later commercial decisions

Technical launch defaults are fixed below so implementation can proceed. A change requires an Architecture Decision Record: a short file that states what changed and why. Pricing remains a product decision before public launch, not a blocker for building the product.

| ID | Decision | Blocks | Owner | Target |
|---|---|---|---|---|
| OD-01 | Private, non-versioned AWS S3 bucket in the stated V1 region, using SSE-KMS, per-object `expiresAt`, application deletion, and a lifecycle backstop. Object Lock is disabled because it conflicts with short retention. | Milestone 0 | Delivery owner | Kickoff |
| OD-02 | Ship Gitleaks for secret scanning, OSV-Scanner for dependency vulnerabilities, and BuildIT-authored Semgrep-compatible rules only after licence review. Pin scanner and rule versions. | Milestone 1 exit | Security + legal owner | Before scanner merge |
| OD-03 | Failed patches remain only as short-lived encrypted artifacts. Do not create a GitHub branch unless final validation passes and delivery begins. | Milestone 2 | Product owner | Resolved |
| OD-04 | Initial limits: 500 changed files, 20,000 changed lines, 200k model-input tokens, 20-minute review, 45-minute Autofix, 6 patch attempts, 3 rounds, and a configurable INR-equivalent spend cap shown before start. Oversized work is partial or refused, never silently truncated. | Milestone 1 | Delivery owner | Validate with fixtures |
| OD-05 | `advisory` is the only V1 policy. Offer `fail_closed` in V1.1 only after 99.5% measured monthly control-plane availability and 98% completion for three consecutive months. | Milestone 1 | Product owner | Resolved |
| OD-06 | Support Node 22 and 24; npm 10+, pnpm 9/10, Yarn 1 and 4; Vitest, Jest, and Node's test runner through repository commands. Exact fixture versions are pinned in CI. | Milestone 0 | Delivery owner | Validate quarterly |
| OD-07 | V1 remains BYOK-only. Revisit a managed allowance only after actual gross-margin data exists. | Commercial model | Product owner | Post-launch |
| OD-08 | One sandbox per Autofix job where the requested lifetime fits provider limits; otherwise deterministic re-provisioning from the last validated snapshot. Every round must pass the re-provision fixture. | Milestone 2 | Delivery owner | Resolved |
| OD-09 | Pricing remains open until design-partner cost data exists; it does not change safety or state behavior. | Public launch | Product owner | Before public pricing |
| OD-10 | V1 uses one disclosed region, chosen at deployment kickoff to match the first design partners. Region selection remains V2. | Milestone 1 | Product + security owner | Kickoff |
| OD-11 | Defaults: 2 active reviews per organization, 1 per repository, 30-second push debounce. Make all three server-side configuration values. | Milestone 1 | Delivery owner | Resolved |
| OD-12 | Subscribe to default-branch pushes for installed repositories, with an admin opt-out that marks reversion metrics unavailable. | Milestone 3 | Product owner | Resolved |
| OD-13 | Trusted ref defaults to the default branch. Verified protection permits merge-based activation; otherwise an Admin must approve the exact configuration commit in the dashboard. | Milestone 1 | Security owner | Resolved |
| OD-14 | Withdrawn in v1.3. It duplicated OD-05. The number is retired and not reused | n/a | n/a | n/a |
| OD-15 | Maintain a denied-by-default allowlist in a signed BuildIT release file. Entries bind package name, exact version, integrity hash, reason, reviewer, and expiry. Two-person security review is required. | Milestone 1 | Security owner | Before enabling scripts |
| OD-16 | Backup retention is 14 days. Customer wording: active artifacts follow the selected 0–7 day policy; encrypted backups may retain deleted data for up to 14 additional days and are not restored selectively. | Milestone 1 | Security + legal owner | Before design-partner data |
| OD-17 | Adequate protection means deletion and force-push are blocked, changes require a pull request, at least one approving review is required, and admins cannot bypass where GitHub exposes that control. Otherwise use explicit Admin approval. | Milestone 1 | Security owner | Resolved |
| OD-18 | One diagnostic rerun per check, 5 provider retries, and 2 command infrastructure retries, all still bounded by wall clock and spend. | Milestone 2 | Delivery owner | Resolved |
| OD-19 | The content broker is a separate deployment and credential boundary at launch, not a module inside the web application. | Milestone 1 | Security owner | Resolved |

---

## 25. Glossary

- **Agent branch:** a branch created by BuildIT from the exact reviewed PR head, named `buildit/pr-<number>/<job-id>`, on which Autofix works.
- **Attempt:** one proposed patch, whether it is applied, rejected, or empty. Capped at six per Autofix job.
- **Base result cache:** stored outcomes of validation commands executed against a base commit, used to distinguish pre-existing failures from regressions.
- **Blocking finding:** a finding whose severity meets or exceeds the configured blocking threshold and whose confidence is high or medium.
- **Bound:** any of the five limits that can end an Autofix job: rounds, attempts, wall clock, spend, or repeat patch.
- **Coverage level:** see `full`, `partial`, `limited` in REQ-310. Always coverage of the configured scope, never of the repository.
- **Reconciliation write:** a GitHub write that corrects stale BuildIT state, permitted after a head change, and required to name the old commit.
- **Termination bound:** the machine-readable repetition or time reason an Autofix loop ended without success: `round_limit`, `attempt_limit`, `wall_clock_limit`, `repeated_patch`. Spend exhaustion is recorded separately as `budget_exhausted` with its ceiling and consumption.
- **Trusted ref:** the repository ref, by default the protected default branch, from which BuildIT reads approved configuration and rules.
- **Commit-sensitive write:** a GitHub write that asserts something about a specific commit and therefore requires a head compare-and-swap.
- **Evidence identifier:** a reference to a stored artifact, command result, or requirement record that a finding cites and that the orchestrator validates.
- **Exact-commit truth:** the rule that any result refers to one specific head commit and is invalid for any other.
- **Fingerprint:** a stable, non-reversible identifier for a finding, computed from rule identity and normalised code context and stored as a keyed HMAC under a per-organization key, used for deduplication and suppression.
- **Required check:** a check marked required in the trusted configuration. Only required checks gate a passing status.
- **Round:** one proposed edit set followed by execution of every required validation command affected by that edit. Capped at three.
- **Stacked pull request:** a pull request opened by BuildIT that targets the original pull request's branch, never the protected base branch.
- **Stale:** a flag meaning the pull request head has moved since this result was produced. It never replaces the recorded status.
- **Trusted revision:** the approved configuration revision, sourced from the trusted ref, that governs a review. Never the pull request head and never an arbitrary pull-request base.
- **Content broker:** the narrow trusted service that reads approved artifacts, redacts, assembles model requests, and returns structured results. It holds no GitHub write token, no administrative database credential, and no long-term storage.
- **Configuration provenance:** how the governing configuration was approved: `protected_ref_merge`, `explicit_admin_approval`, or `defaults_only`.
- **Affected review scope:** the changed files plus the context retrieval determined to be affected. Coverage is measured against this, never against the whole repository.

---

## 26. Source notes

Primary documentation used to validate this specification:

- [GitHub App permission guidance](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [GitHub webhook delivery handling](https://docs.github.com/en/webhooks/using-webhooks/handling-webhook-deliveries)
- [GitHub collaborators and permission lookup](https://docs.github.com/en/rest/collaborators/collaborators)
- [GitHub Actions secrets API](https://docs.github.com/en/rest/actions/secrets)
- [GitHub agentic code-scanning autofix](https://docs.github.com/en/code-security/concepts/code-scanning/autofix-for-code-scanning)
- [Anthropic strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use)
- [Anthropic tool-use loop](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works)
- [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Vercel Sandbox](https://vercel.com/docs/sandbox)
- [Vercel Sandbox pricing and quotas](https://vercel.com/docs/sandbox/pricing)
- [Vercel runtime documentation](https://vercel.com/docs/functions/runtimes)
- [Convex durable scheduling](https://docs.convex.dev/scheduling/overview)
- [Convex limits](https://docs.convex.dev/production/state/limits)
- [Jira OAuth scopes](https://developer.atlassian.com/cloud/jira/platform/scopes-for-oauth-2-3LO-and-forge-apps/)
- [Semgrep licensing](https://semgrep.dev/docs/licensing)
- [Semgrep rules licence change](https://semgrep.dev/blog/2024/important-updates-to-semgrep-oss/)
- [CodeRabbit platform overview](https://docs.coderabbit.ai/index)
- [Greptile platform overview](https://www.greptile.com/docs/introduction)
- [Greptile repository rules](https://www.greptile.com/docs/code-review/custom-standards)
- [Qodo code review](https://docs.qodo.ai/code-review)

Platform limits that this specification depends on, meaning sandbox timeouts and resource ceilings, GitHub comment and check output sizes, GitHub installation rate limits, and Convex document and argument limits, must be re-verified at implementation time and encoded as tested constants rather than as prose.

---

## 27. Definition of done for this specification

This document is approved when product, engineering, security, and legal agree that:

- The promise is honest and testable.
- V1, V1.1, V2, and V3 scope are explicit and internally consistent, with no capability appearing in one section and contradicted in another.
- Every P0 requirement has corresponding acceptance coverage or a named launch-gate exercise.
- The human merge boundary has no exception, and every Autofix bound is enumerated and tested.
- Source, credentials, untrusted execution, and untrusted configuration all have explicit controls.
- User flows include failure, cancellation, stale commits, missing context, budget exhaustion, capacity limits, and fork pull requests.
- Metrics cannot be inflated by ambiguous definitions, and no metric is promised that the event subscriptions cannot support.
- Cost is attributable and capped, and the commercial model is stated rather than assumed.
- No outcome has two names, no status carries two meanings, and every bound has a machine-readable identifier.
- The retention promise is implementable from the schema as written, not only from the prose.
- Untrusted content never enters the trusted tier, and trust is anchored to a ref an Admin controls.
- Every implementation default in section 24 has an accountable role, and named humans are assigned at the stated kickoff gates.

---

## Appendix A: Defect register for v1.0

Every entry is a defect found in the v1.0 specification and the change made in v1.1.

### Blocking defects

| # | Defect in v1.0 | Fix in v1.1 |
|---|---|---|
| A1 | Repository configuration and rules were version-controlled but the trusted revision was never specified, so a contributor could change commands, network allowlists, protected paths, budgets, and Autofix settings inside the pull request under review | REQ-210 to REQ-212, REQ-022, REQ-024, Flow M, AC-202, AC-203, tamper suite |
| A2 | Fork pull requests were reviewed with a repository token present in the sandbox, the classic "pwn request" exposure | REQ-230, REQ-231, Flow K, AC-208 |
| A3 | Semgrep was mandatory for V1 with no licensing analysis, while Semgrep-maintained rules are restricted to internal, non-competing, non-SaaS use | Licensing constraint in section 4, OD-02 with legal sign-off as a Milestone 1 exit gate |
| A4 | The three-round cap excluded empty patches, rejected patches, and unvalidated edits from the count without capping them separately, permitting an unbounded loop | REQ-245 and REQ-246, five enumerated bounds, AC-211, AC-212 |
| A5 | `stale` was a terminal state, which erased the actual outcome and contradicted the section 12 invariant that terminal states never change | Staleness is a flag with `staleSince` and `observedHeadSha`; the recorded status is preserved |
| A6 | Flow C requested Autofix after a review reached `changes_requested`, which the terminal-state invariant forbade | Autofix modelled as a separate linked job with `parentReviewId` |
| A7 | Exact-commit truth had no enforcement mechanism at the moment of writing to GitHub | REQ-250 head compare-and-swap. Narrowed in v1.2 to commit-sensitive writes only, since the original blanket rule blocked the reconciliation writes that clear stale GitHub state |
| A8 | Suppression of dismissed findings required fingerprints that were source-derived and therefore deleted after 24 hours, so every dismissal would return | REQ-260, `findingSuppressions` with metadata-class keyed HMACs, AC-206. Strengthened in v1.2 from a salted hash to a keyed HMAC |
| A9 | Comment `edited` events were subscribed with no rule, allowing an old comment to be edited into a trigger | REQ-206, AC-215 |
| A10 | Nothing prevented BuildIT reacting to its own or another bot's comments | REQ-207, loop guard, AC-216 |

### Contradictions and inconsistencies

| # | Defect | Fix |
|---|---|---|
| A11 | Scope said pull requests from the same repository only, while the edge-case table and the exclusion list both implied fork pull requests were reviewed | Scope now states fork review is in V1 read-only and fork Autofix is out |
| A12 | Failed third-round preservation was unconditional in REQ-090, conditional in Flow C, and undecided in open decisions | REQ-090 rewritten to point at a single decision, OD-03 |
| A13 | V1.1 features carried unqualified P0 labels, making the priority scheme meaningless | Priorities scoped by release, for example "P0 for V1.1" |
| A14 | REQ-116 attributed a 44 pixel target size to WCAG 2.2 AA; that figure is the AAA enhanced criterion | REQ-116 separates the AA requirement from BuildIT's own 44 pixel standard |
| A15 | The state diagram's indentation implied `validating_round_2` followed authorization rather than round two | State machine rewritten |
| A16 | Section 12 required recording prompt and model versions, but no schema field existed | Fields added to `reviews` |
| A17 | `configRevision` was referenced on two tables with no entity behind it | `configRevisions` entity added |
| A18 | Trust metrics promised fix-reversion rates that no subscribed event could measure | `push` subscription added, REQ-265, AC-237, AC-238 |
| A19 | The north-star metric excluded `changes_requested`, so it would fall when the product worked well | North star redefined around evidence-bearing terminal statuses |
| A20 | Retention implied deletion of everything, while comments and branches already in GitHub are outside BuildIT's control | REQ-261, AC-222 |
| A21 | Provider neutrality was claimed while Anthropic message semantics were core P0 requirements | REQ-258 moves provider semantics to adapter annexes |
| A22 | "All required scanners" was used for pass criteria with no definition of required, and REQ-069 said "where supported," which is a different rule | REQ-213 makes required an explicit per-check attribute |
| A23 | "Blocking finding" gated terminal statuses but was never defined | REQ-214 severity threshold, REQ-225 confidence scale |
| A24 | `confidence` existed on findings with no scale | REQ-225 three-point scale with criteria |
| A25 | `checkRuns.kind`, `conclusion`, and `failureClass` were used without enumerated values | Enumerations added in section 12 |
| A26 | The traceability table left REQ-018, REQ-025, REQ-072, REQ-107, REQ-145, and REQ-148 uncovered, and stated that CLI criteria were missing | New acceptance criteria added, including a full CLI block AC-230 to AC-236 |

### Missing scope

| # | Gap | Addition |
|---|---|---|
| A27 | No concurrency, queueing, or push-debounce policy, so a burst of pull requests could exhaust budget and GitHub rate limits | REQ-217 to REQ-219, Flow L, AC-217, AC-218 |
| A28 | No notification layer, so results were discoverable only by polling the dashboard or reading GitHub | Section 7.15, AC-223, AC-224 |
| A29 | No cost accounting, pre-flight estimate, or usage ledger, despite budgets being specified | Section 7.16, `usageLedger`, AC-225, AC-226 |
| A30 | No commercial model, so cost of goods and the meaning of BYOK were undefined | Section 22 |
| A31 | Base-branch comparison was assumed but never costed or cached, so regression classification either doubled every review's cost or was unfounded | REQ-236, REQ-237, `baseResults`, AC-207 |
| A32 | Sandbox lifetime was never reconciled with multi-round Autofix, and the platform default timeout is short | REQ-234, REQ-235, section 13 sandbox lifetime, OD-08, AC-210 |
| A33 | Dependency installation had no lockfile or lifecycle-script policy | REQ-232, AC-209 |
| A34 | Trigger authorization was asserted but the mechanism was never specified, and the document simultaneously forbade the Administration permission | REQ-208 using the collaborator permission endpoint under Metadata read, REQ-209 |
| A35 | The `@buildit` command surface was used across the document but never specified | REQ-205 |
| A36 | Draft pull requests, `pull_request.closed`, repository rename, transfer, deletion, and installation suspension had no defined behavior | REQ-200, REQ-202, REQ-215, REQ-216, edge-case table |
| A37 | GitHub payload size limits for comments, check output, and annotations were never addressed | REQ-251 |
| A38 | A required BuildIT check plus a BuildIT outage would block every merge in an organization | REQ-252, AC-219 |
| A39 | Model-fabricated evidence identifiers had no validation step | Evidence-identifier validation in the model policy, section 16, and AC-205. Corrected in v1.2: v1.1 cited REQ-255, which is the Usage dashboard requirement, not evidence validation. |
| A40 | No token or context budget strategy for large changes | REQ-220, REQ-221, AC-204 |
| A41 | Release gates had no numeric thresholds and there were no service level objectives | Section 17 gate table and SLOs |
| A42 | No risk register | Section 23 |
| A43 | No glossary, despite heavy use of terms with product-specific meanings | Section 25 |
| A44 | No revision history, no named owners, and no dates on competitive research | Document control block, dated research note in section 4 |
| A45 | The pull-request author, who receives most of the product's output, was not a defined user | Secondary persona in section 2 |
| A46 | No data-classification model, so retention rules could not be applied consistently per field | Classification model in section 12 |
| A47 | No encryption detail beyond "master key," with no binding of ciphertext to tenant | REQ-011 envelope encryption and additional authenticated data, AC-200 |
| A48 | No data residency statement, DPA, subprocessor policy, or vulnerability disclosure policy | REQ-262 to REQ-264 |
| A49 | No determinism policy, leaving open an implicit promise that re-running produces identical findings | Determinism policy in section 16 |
| A50 | No incremental review requirement, despite incremental review being marked mandatory for V1 | REQ-228 |
| A51 | Section 20 was titled "Saturday demo script," an internal scheduling note inside a canonical specification | Retitled and extended with an adversarial segment |
| A52 | Milestones and open decisions had no owners or dates, while the definition of done required them | Owner and date columns added, left explicitly unassigned so the gap is visible rather than implied |

---

## Appendix B: Requirement index

| Block | Range | Section |
|---|---|---|
| Setup and organization | REQ-001 to 006, REQ-200 to 202 | 7.1 |
| BYOK and providers | REQ-010 to 019, REQ-203 to 204 | 7.2 |
| Repository configuration and trust | REQ-020 to 027, REQ-210 to 214 | 7.3 |
| Trigger authorization | REQ-205 to 209 | 6 |
| Initiation, concurrency, queueing | REQ-030 to 036, REQ-215 to 219 | 7.4 |
| Context acquisition | REQ-040 to 049, REQ-220 to 222 | 7.5 |
| Review and findings | REQ-050 to 058, REQ-225 to 228 | 7.6 |
| Execution and isolation | REQ-060 to 072, REQ-230 to 237 | 7.7 |
| Autofix and bounds | REQ-080 to 094, REQ-245 to 248 | 7.8 |
| GitHub results | REQ-100 to 107, REQ-250 to 253 | 7.9 |
| Dashboard | REQ-110 to 119, REQ-255 | 7.10 |
| CLI | REQ-120 to 127, REQ-256 to 257 | 7.11 |
| Reliability | REQ-130 to 137, REQ-258 | 7.12 |
| Privacy and governance | REQ-140 to 149, REQ-260 to 264 | 7.13 |
| Reporting | REQ-150 to 157, REQ-265 to 266 | 7.14 |
| Notifications | REQ-270 to 273 | 7.15 |
| Cost and budgets | REQ-275 to 279 | 7.16 |
| Operations | REQ-280 to 284 | 7.17 |


---

## Appendix C: disposition of the v1.1 technical review

All fifteen points raised were valid. Five were defects introduced in v1.1 rather than inherited from v1.0, which is noted where it applies.

### Blocking issues

| # | Finding | Verdict | Resolution |
|---|---|---|---|
| C1 | The trusted revision was defined as the PR base branch, which a contributor can control | Valid, and a v1.1 defect. It also broke on BuildIT's own stacked PRs, whose base is a BuildIT branch | REQ-210 rewritten to an Admin-controlled trusted ref defaulting to the protected default branch; REQ-300 immutable approved revisions; REQ-301 provenance in the summary; REQ-302 no self-review; REQ-303 defaults-only path; AC-300, AC-301 |
| C2 | Two conflicting Autofix failure statuses, `failed_after_three_rounds` and `failed_after_bounds` | Valid, a v1.1 defect | REQ-090 rewritten to a single status plus `terminationBound`; `reviews.terminationBound` added; three-round wording demoted to display text; AC-315 |
| C3 | Compare-and-swap on every GitHub write leaves an in-progress Check hanging forever | Valid, a v1.1 defect, and the sharpest of the set | REQ-250 split into commit-sensitive and reconciliation writes; REQ-306 watchdog reconciliation with an alerting threshold; AC-302, AC-303 |
| C4 | Final validation scope ambiguous: affected-subset rounds versus all required checks at the final commit | Valid | REQ-081 scoped to intermediate rounds; REQ-089 requires a full final validation before `delivered`, otherwise `inconclusive`; `final_validation` marker in the schema; AC-304 |
| C5 | One table cannot represent six attempts and three rounds | Valid, a v1.1 defect. The uniqueness constraints were mutually incoherent | Split into `autofixAttempts` and `autofixRounds` with a referential constraint and a delivery constraint; AC-305 |
| C6 | The retention model is not implementable from the schema, and suppression fingerprints should be keyed HMACs | Valid on both counts | REQ-307 source-derived content only in expiring encrypted artifacts; REQ-308 enumerated denormalised fields with their own expiry; REQ-260 keyed HMAC with honest rotation semantics; REQ-309 provider-side prompts stated as outside BuildIT's control; AC-307 |
| C7 | A neutral conclusion fails open, since GitHub accepts success, neutral, and skipped for required checks, and cancellation-to-neutral is a bypass | Valid, and the external claim checks out against GitHub's documentation | REQ-252 rewritten into `advisory`, `fail_open`, and `fail_closed`; cancellation always publishes `action_required`; dashboard warning on policy mismatch; AC-308, AC-309 |
| C8 | Fork workspace preparation should not happen in the control plane | Valid, a v1.1 defect. It put attacker-controlled archive extraction in the trusted tier | REQ-230 rewritten as fetch, credential teardown, and execution stages, applied to every repository rather than only forks; REQ-304 separate delivery stage; REQ-305 per-stage tokens; Flow K rewritten; AC-306 |

### Remaining inconsistencies

| # | Finding | Verdict | Resolution |
|---|---|---|---|
| C9 | `blocked` treated as terminal while Flow J calls it resumable | Valid | `blocked` is now explicitly nonterminal and pausable, with resume semantics, a blocked TTL, and expiry to `cancelled`; AC-311 |
| C10 | Time limits sometimes produce `budget_exhausted` and sometimes `failed_after_bounds` | Valid | `budget_exhausted` is money only; review timeout is `inconclusive` with reason `timeout`; Autofix timeout is `failed_after_bounds` with `wall_clock_limit`; command timeout is a check conclusion. New subsection "Where time limits land" |
| C11 | Base-result cache key omits runner image, tool versions, architecture, and environment policy | Valid, and it would have silently corrupted the regression metric | REQ-236 and the `baseResults` entity extended; AC-313 |
| C12 | A blanket lifecycle-script ban breaks legitimate packages | Valid, and the practical objection | REQ-232 replaced with a reviewed per-package build-script allowlist plus a report of every skipped script; AC-312 |
| C13 | Appendix A39 cites REQ-255, which is the Usage dashboard requirement | Valid, a straightforward citation error | A39 corrected to point at the model policy in section 16 and AC-205 |
| C14 | "Full coverage" undefined | Valid | REQ-310 defines `full`, `partial`, and `limited` as coverage of configured scope, never of the repository; glossary updated |
| C15 | Owners unassigned and launch decisions unresolved, so the document is not approved | Valid in v1.2 | v1.3.1 resolves technical defaults, assigns accountable roles, names Tanmay as product sponsor, and moves named-human assignment to explicit kickoff gates. Pricing alone remains open before public launch. |

### Added in v1.2 beyond the review

| Gap | Addition |
|---|---|
| No staff access model, so support could read customer source at will | REQ-315 to REQ-316, AC-314 |
| No backup, recovery objectives, or vendor-concentration position | REQ-317 to REQ-319 |
| Audit log was not tamper-evident | REQ-320 hash chain |
| Free trial plus BuildIT-funded sandbox compute is a compute-theft vector | REQ-325, AC-316 |
| BuildIT's own published output was treated as trusted, so a finding could contain an `@buildit` command or a mention storm | REQ-326, AC-310 |
| Installation tokens could outlive their stage on long jobs | REQ-305 per-stage minting |
| PR body edits change requirements but were not subscribed | `pull_request.edited` added to the event list |
| Merge-queue repositories had undefined behaviour | Stated limitation: review the PR only, never a merge-queue required check in V1 |
| BuildIT would have reviewed its own stacked pull requests | REQ-302 |
| Disproportionate-compute repositories were silently subsidised | REQ-327 pricing review |

---

## Appendix D: consistency invariants and mechanical lint

Three revisions produced the same failure: a requirement was corrected while the flows, tables, and criteria that illustrate it kept describing the old rule. Reviewers caught it each time, which is luck, not process. These invariants are stated once and checked mechanically.

### Invariants that must hold in every tier

| # | Invariant |
|---|---|
| I1 | Control input comes from the approved configuration revision on the trusted ref. No text anywhere says configuration comes from the pull request head or from the pull request's base branch. |
| I2 | Only commit-sensitive writes require a head compare-and-swap. No text says "every GitHub write" requires one. |
| I3 | There is exactly one unsuccessful Autofix loop status, `failed_after_bounds`, always paired with a `terminationBound`. |
| I4 | `budget_exhausted` refers to money only. Time resolves as described in section 8. |
| I5 | GitHub Check conclusions come from the REQ-105 matrix. No flow, table, or criterion states a conclusion that contradicts a matrix cell. |
| I6 | Cancellation, blocked, and budget stops publish `action_required`, never `neutral` and never `success`. |
| I7 | `blocked` is nonterminal and pausable everywhere it appears. |
| I8 | Delivery requires a full final validation. No text implies a subset run is sufficient for `delivered`. |
| I9 | Rounds, patch attempts, diagnostic runs, provider retries, and command retries are five separate counters. No text charges one against another. |
| I10 | The control plane never reads repository content; the content broker does. No text attributes source reading to the control plane. |
| I11 | Source-derived content lives in expiring encrypted artifacts. No entity stores source-derived text inline without a marked, expiring field. |
| I12 | Coverage is measured against the affected review scope, never the repository. |
| I13 | Untrusted code never executes with a credential present. Fetch, teardown, and execution are separate stages in every description. |
| I14 | No requirement is P0 for a release it does not ship in. Release qualification is present wherever a post-V1 feature carries P0. |

### String-level lint

A pre-merge check on this document fails on any of the following. It is crude on purpose: it catches the exact drift that occurred, at the cost of occasional false positives that a reviewer clears in seconds.

| Forbidden pattern | Allowed only in |
|---|---|
| `every GitHub write` near `compare-and-swap` | Appendix A and E historical rows |
| `configuration` within one sentence of `base branch` | REQ-210 and appendix rows explaining the old rule |
| `failed_after_three_rounds` | Appendix A, C, and E historical rows |
| `cancel` within one sentence of `neutral` | REQ-252 and appendix rows explaining the old rule |
| `budget_exhausted` within one sentence of `time` or `wall clock` | Section 8 "Where time limits land", which defines the distinction |
| `lifecycle scripts are disabled` without `allowlist` in the same paragraph | nowhere |
| `salted hash` for fingerprints | Appendix rows explaining the old rule |
| `stale` used as a status rather than a flag | nowhere |

### Required pairings

| When the document contains | It must also contain nearby |
|---|---|
| a review status | its row in the REQ-105 matrix |
| a bound | its counter in REQ-246 |
| a new entity field holding source-derived text | an `expiresAt` or an artifact reference |
| a P0 requirement for a post-V1 feature | an explicit release qualifier |

---

## Appendix E: disposition of the v1.2 technical review

All fourteen points were valid. Seven were propagation failures created by v1.2 itself, which is the reason Appendix D exists.

### Blockers

| # | Finding | Verdict | Resolution |
|---|---|---|---|
| E1 | Executive summary and launch checklist still claimed every GitHub write requires a head comparison | Valid, propagation failure | Both rewritten to the commit-sensitive versus reconciliation split; invariant I2 and a lint rule added |
| E2 | Flows still described base-branch configuration, a single cloning sandbox, and blanket script disabling | Valid, and the most consequential, since engineers implement from flows | Flows A, B, C, I, L, and M regenerated from the corrected requirements; normative precedence added to the document control section |
| E3 | Flow I and the edge table still published neutral for cancellation and outage | Valid, propagation failure | Both rewritten to the policy matrix; the matrix itself added to REQ-105 as normative so there is one place to change |
| E4 | Autofix could become `inconclusive` per REQ-089 but the lifecycle had no such transition | Valid | `validating_final -> delivered or inconclusive` added; the `inconclusive` status text now distinguishes it from `platform_failed` and `failed_after_bounds` |
| E5 | The trusted ref is not necessarily protected, and merging into an unprotected ref is not approval | Valid, and it undermined the whole trust anchor | REQ-330 protection verification through the branch rules endpoint, which works under Metadata read; REQ-331 adequacy definition; provenance values `protected_ref_merge`, `explicit_admin_approval`, `defaults_only`; unverified refs require explicit approval; AC-320 |
| E6 | "The control plane never parses repository content" is impossible, since model calls are assembled from source | Valid, and a genuine internal contradiction rather than a wording problem | REQ-335 and REQ-336 split the trusted tier into a control plane with no path to source and a content broker with no write token, no administrative credential, and no storage; section 13 rewritten; AC-325 |
| E7 | Diagnostic reruns consumed patch attempts even though an attempt is now defined as a proposed patch | Valid | REQ-072 and REQ-246 rewritten with five separate counters; schema fields added; AC-322 |

### Additional corrections

| # | Finding | Verdict | Resolution |
|---|---|---|---|
| E8 | OD-05 and OD-14 asked the same question | Valid | Merged into OD-05; OD-14 marked withdrawn and its number retired rather than reused |
| E9 | Flow C created the remote agent branch before a successful patch existed | Valid, and good practice | The branch is local to the sandbox until delivery; GitHub sees it only on delivery or on elected preservation of failed work; AC-324 |
| E10 | "Full coverage" over every path the include rules allow is impractical on large repositories | Valid | REQ-310 rewritten around the affected review scope; glossary entry added |
| E11 | Build-script approval by package name alone would admit a later compromised version | Valid, and the sharpest supply-chain point in the set | REQ-232 binds allowlist entries to name, exact version, and lockfile integrity hash; version bumps require re-approval; AC-312 rewritten |
| E12 | `action_required` was used for cancellation but absent from the conclusion schema and UI states | Valid | Internal check conclusions and GitHub Check conclusions separated explicitly; `action_required` added to the required UI state list with a note that it must not look like a generic failure |
| E13 | Owners remain unassigned across product, engineering, security, risk, milestones, and decisions | Valid in v1.3 | v1.3.1 assigns accountable roles and kickoff gates. Named delivery, security, and legal humans must still be recorded before their gated work begins. |
| E14 | `advisory` should remain the V1 default and `fail_closed` should wait for measured availability | Valid, and the right product call | `advisory` is the only policy offered at launch; `fail_closed` deferred to V1.1 and gated on the section 17 availability objective being met over a sustained period |

### What this revision changed structurally

The previous two revisions fixed defects. This one also fixed the process that produced them: normative precedence, a single normative matrix for Check conclusions instead of mapping rules scattered across flows, fourteen stated invariants, and a string-level lint that fails the document rather than relying on a reviewer to notice. v1.3.1 then resolved the technical defaults and assigned accountable roles; the remaining management action is to name the delivery, security, and legal humans at the stated kickoff gates.

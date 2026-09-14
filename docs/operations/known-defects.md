# Known defects

Found, verified, and deliberately not yet fixed. Each entry says why the obvious fix is wrong, so
the next person does not spend the afternoon rediscovering it.

## The escalate-to-human verdict is unreachable

**Where:** `convex/reviewValidationData.ts` — `uncertainPasses >= uncertainEscalationLimit`, with
the limit set to 2 in `packages/orchestrator/src/reviewPlan.ts`.

**What happens:** `uncertainPasses` is written as `1` when a finding row is inserted
(`convex/reviewModelData.ts`) and incremented only when a row already exists for the same
`reviewId + fingerprintHmac`. A normal review records its findings once, so the counter never
leaves 1 and the threshold of 2 is never met. The `human_review_required` branch is dead code.

**Why it matters:** a finding the critic could not resolve leaves the review on `checks_passed`,
which publishes a green check and a comment titled *"Ready for human review"*. The analysis stage
recorded the opposite. The finding is listed in the comment body, so it is not hidden — but the
badge says the change is fine while BuildIT's own record says it could not tell.

**Why the obvious fix is wrong.** Setting the limit to 1 looks correct and would be a serious
regression. `requireIndependentCritic` forces every critical and high model finding to `uncertain`
whenever no independent critic is available, and independence requires a *second* model on the
credential. A workspace with one provider and one model — which is the common case, and is this
workspace today — would send every review carrying a serious finding to inconclusive. That is the
third time this codebase would have made incomplete input void a verdict; the first two
("coverage meant every byte", and the `changed_files` gap reused for the analysis budget) each made
every real repository undecidable, and both had to be undone.

**What the fix probably is.** Two changes that belong together, neither safe alone:

1. Build the escalation ladder first — re-run the critic once on the sibling model when a finding
   stays uncertain, so an unresolved finding means *two* independent attempts failed rather than
   *one attempt was not independent*. Only then does a threshold of 1 describe something real.
2. Separately, decide what a green check means when a blocking finding is unresolved. Arguably
   `checks_passed` should be unreachable while any critical finding sits at `uncertain`,
   independent of the escalation counter — the counter answers "how hard did we try", the badge
   answers "what do we claim", and those are different questions.

Until both land, an unresolved critical finding is visible in the comment and invisible in the
badge. That is the current, known state.

## The AWS boundary check cannot run, and keeps `main` red

**Where:** the `AWS artifact boundary matches the template` step in `.github/workflows/ci.yml`, and
`pnpm smoke:aws-boundary`.

**What happens:** the step runs only on non-pull-request events, finds no `AWS_ACCESS_KEY_ID`,
prints `buildit_aws_boundary_not_configured` and **exits 1**. So every push to `main` fails
`release-gates`, and no commit can fix it.

**Why it is written that way, and why that is defensible.** The alternative — warn and pass — is how
the Grafana rules drifted for weeks while a green check said nothing was wrong. "We could not check"
is not "it matches", and a gate that goes green on the first is a gate that lies.

**Why it is still a problem.** A build that is red for a reason no commit can address teaches people
to stop reading red builds, which costs more than the drift it is guarding against. The resolution
is neither weakening nor tolerating it: **put the credentials in.** Set `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `BUILDIT_AWS_REGION` (`eu-west-1`) and `BUILDIT_AWS_STACK` as repository
secrets and the step starts verifying the thing it was written to verify.

**Also blocked, for the same want of access:** reading back the encrypted inventory manifest and CSV
that appeared after the KMS repair, and confirming the next scheduled export ran. The CLI session is
expired (`aws sts get-caller-identity` → *"Your session has expired"*), and the browser is refused
navigation to the `eu-west-1` and `s3` console hosts. The stack is Ireland; a console session opened
at `us-east-1` cannot see it.

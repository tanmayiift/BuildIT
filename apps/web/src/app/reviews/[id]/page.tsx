import { LiveReviewDetail } from "./live-review-detail";
import { sampleReviewFor, type SampleReview } from "../../sample-data";
import { nextActionPresentation, stagePresentation, statusPresentation, technicalLabel } from "./review-presentation";

type TourState = "cancelled" | "running" | "changes" | "passed" | "delivered" | "budget" | "empty" | "populated";
const states: TourState[] = ["cancelled", "running", "changes", "passed", "delivered", "budget", "empty", "populated"];

const sample = {
  cancelled: { status: "cancelled", stage: "queue", action: "start_new_review", detail: "No decision was made. BuildIT did not read code, run checks, or change this pull request.", evidence: "empty" },
  running: { status: "running", stage: "context", action: "wait", detail: "BuildIT is reading the pull request and linked requirements before it reaches a code decision.", evidence: "progress" },
  changes: { status: "changes_requested", stage: "validation", action: "fix_findings", detail: "One acceptance criterion lacks proof and a required check failed at this exact commit.", evidence: "findings" },
  passed: { status: "passed", stage: "complete", action: "human_review", detail: "Requirements and required checks have evidence for this exact commit. A person still makes the merge decision.", evidence: "checks" },
  delivered: { status: "delivered", stage: "delivery", action: "await_human_approval", detail: "A tested fix is ready in a separate pull request for a person to inspect.", evidence: "checks" },
  budget: { status: "budget_exhausted", stage: "analysis", action: "increase_budget", detail: "The next model step could have crossed this review's chosen limit, so BuildIT stopped before making that call.", evidence: "checks" },
  empty: { status: "inconclusive", stage: "queue", action: "start_new_review", detail: "This example shows how BuildIT behaves when it cannot gather enough proof to make a safe decision.", evidence: "empty" },
  populated: { status: "changes_requested", stage: "validation", action: "fix_findings", detail: "This example includes requirements, an evidence-backed issue, and the check that needs attention.", evidence: "findings" },
} as const;

function stateFrom(value: string | undefined): TourState {
  return states.includes(value as TourState) ? (value as TourState) : "changes";
}

export default async function Review({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tour?: string; state?: string }> }) {
  const { id } = await params;
  const { tour, state } = await searchParams;
  if (tour !== "1") return <LiveReviewDetail id={id} />;
  const row = sampleReviewFor(id);
  const chosen = state ? stateFrom(state) : row?.state ?? "changes";
  const current = sample[chosen], verdict = statusPresentation(current.status, false), next = nextActionPresentation(current.action, false), hasReviewEvidence = current.evidence !== "empty";
  const repo = row?.repo ?? "nexus/api", commit = row?.commit ?? "a3f91c2", baseCommit = row?.baseCommit ?? "7b2e004";
  return <div className="content review-detail review-tour">
    <div className="crumbs"><a href="/reviews?tour=1">Review queue</a><span>›</span><strong>{repo} #{id}</strong><span className="sample-badge">Example</span></div>
    <section className="verdict-card"><div className="verdict-message"><span className={`verdict-symbol ${verdict.tone}`} aria-hidden="true">{verdict.symbol}</span><div><span className={`status ${verdict.tone}`}>{verdict.label}</span><h1>{verdict.title}</h1><p>{row?.cause?.detail ?? current.detail}</p></div></div><div className="verdict-actions"><a className="button secondary" href="/reviews?tour=1">{hasReviewEvidence ? "Back to queue" : "Open review queue"}</a></div></section>
    <section className={`tour-scope${hasReviewEvidence ? "" : " minimal"}`} aria-label="Pinned review context"><span><small>Repository</small><strong>{repo}</strong></span><span><small>Pull request</small><strong>#{id}</strong></span><span><small>Exact commit</small><code>{commit}</code></span>{hasReviewEvidence ? <span><small>Review coverage</small><strong>Full</strong></span> : null}</section>
    {hasReviewEvidence ? <><div className="next-action"><span className="next-mark" aria-hidden="true">→</span><div><small>What to do next</small><strong>{next.title}</strong><p>{next.detail}</p></div></div><Journey stage={current.stage} /></> : null}
    {current.evidence === "empty" ? <section className="evidence-empty"><span aria-hidden="true">◇</span><div><h2>{row?.cause?.reason ?? "No review evidence"}</h2><p>{row?.cause ? row.cause.nextStep : "BuildIT does not fill the page with guesses. It has not read code, run checks, or made a decision for this pull request."}</p></div></section> : null}
    {current.evidence === "progress" ? <Evidence title="What BuildIT is doing" eyebrow="In progress" detail="2 sources read"><Row lead="Pull request and linked requirements" outcome="Gathered" tone="running" note="Exact commit and ticket context are being checked." /><Row lead="Code and test plan" outcome="Next" tone="warning" note="No finding is shown until evidence exists." /></Evidence> : null}
    {current.evidence === "findings" ? (row?.checks
      ? <Evidence title="Checks run" eyebrow="Verification" detail={`${row.checks.filter(check => check.policy === "Required").length} required`}>
          {row.checks.map(check => <Row key={check.name} lead={check.name} outcome={check.result} tone={check.result === "Passed" ? "success" : "danger"} note={`${check.policy} check at this exact commit.`} />)}
        </Evidence>
      : <><Evidence title="What this change must do" eyebrow="Intent" detail="4 requirements"><Row lead="Reject transfers above daily limit" outcome="Covered" tone="success" note="Pinned source evidence recorded." /><Row lead="Log every rejected transfer" outcome="Not covered" tone="danger" note="No matching code change found." /></Evidence><Evidence title="Checks run" eyebrow="Verification" detail="1 required"><Row lead="pnpm test" outcome="Failed" tone="danger" note="1m 42s · exact stdout retained." /><Row lead="pnpm lint" outcome="Not run" tone="warning" note="Optional check is not configured." /></Evidence></>) : null}
    {current.evidence === "checks" ? <Evidence title="Checks run" eyebrow="Verification" detail="2 required"><Row lead="pnpm test" outcome="Passed" tone="success" note="Exact stdout retained for this commit." /><Row lead="pnpm lint" outcome="Passed" tone="success" note="Required policy completed." /></Evidence> : null}
    {row?.finding ? <CompleteFinding finding={row.finding} /> : null}
    {hasReviewEvidence ? <details className="technical-details"><summary>Technical details</summary><dl><div><dt>Base commit</dt><dd><code>{baseCommit}</code></dd></div><div><dt>Current step</dt><dd>{stagePresentation(current.stage)}</dd></div><div><dt>Model</dt><dd>Configured by workspace policy</dd></div><div><dt>Internal state</dt><dd>{technicalLabel(current.status)}</dd></div></dl></details> : null}
  </div>;
}

// The headline promises every finding names the file, the line and the commit. The tour said
// "No matching code change found" and stopped there, so an engineer could not judge that claim at
// all. This shows the six things that make a finding checkable: where it is, the code it read, why
// it matters, what the check that caught it printed, the change it proposes, and the pull request
// change would arrive in.
function CompleteFinding({ finding }: { finding: NonNullable<SampleReview["finding"]> }) {
  return <section className="complete-finding" aria-labelledby="complete-finding-title">
    <div className="section-heading compact"><div><p className="eyebrow">Cited evidence</p><h2 id="complete-finding-title">{finding.title}</h2></div><span className="status danger">{finding.severity}</span></div>
    <p className="finding-where"><code>{finding.path}:{finding.lines}</code> at commit <code>{finding.commit.slice(0, 12)}</code> · {finding.verdict}</p>
    <p className="finding-source">Transcribed from a review BuildIT ran on {finding.reviewedAt}: <a className="text-link" href={finding.source.href} rel="noreferrer noopener" target="_blank">{finding.source.label}</a>. Every value below is quotable from it.</p>
    <p className="finding-why">{finding.why}</p>
    <p className="finding-why">{finding.inspect}</p>
    <div className="finding-block"><h3>The code it read</h3><pre tabIndex={0} role="region" aria-label="The code it read"><code>{finding.excerpt}</code></pre></div>
    <div className="finding-block"><h3>What <code>{finding.checkName}</code> reported</h3><pre tabIndex={0} role="region" aria-label={`What ${finding.checkName} reported`}><code>{finding.checkOutput}</code></pre></div>
    <div className="finding-block"><h3>The change it proposes</h3><pre className="finding-diff" tabIndex={0} role="region" aria-label="The change it proposes"><code>{finding.fix}</code></pre></div>
    <p className="finding-delivery">Delivered as a stacked pull request a person reviews and merges — BuildIT never merges: <a className="text-link" href={finding.stackedPr.href} rel="noreferrer noopener" target="_blank">{finding.stackedPr.label}</a></p>
  </section>;
}

function Journey({ stage }: { stage: string }) {
  const steps = [["context", "Understand", "Read the PR and requirements"], ["analysis", "Inspect", "Look for risky changes"], ["validation", "Verify", "Run required checks"], ["delivery", "Hand back", "Show evidence or a tested fix"]] as const;
  const order = ["queue", "context", "analysis", "validation", "autofix", "delivery", "complete"], position = order.indexOf(stage);
  return <section className="review-journey" aria-labelledby="sample-journey-title"><div><p className="eyebrow">Review journey</p><h2 id="sample-journey-title">How far BuildIT got</h2></div><ol>{steps.map(([key, label, detail], index) => { const step = order.indexOf(key), done = position > step; return <li key={key} data-state={done ? "complete" : position === step ? "active" : "waiting"}><span aria-hidden="true">{done ? "✓" : index + 1}</span><div><strong>{label}</strong><small>{detail}</small></div></li>; })}</ol></section>;
}

function Evidence({ title, eyebrow, detail, children }: { title: string; eyebrow: string; detail: string; children: React.ReactNode }) {
  return <section className="evidence-section"><div className="evidence-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><span>{detail}</span></div><div className="tour-evidence">{children}</div><footer className="evidence-foot">Every decision is tied to this pull request and exact commit. A person remains responsible for merging.</footer></section>;
}

function Row({ lead, outcome, tone, note }: { lead: string; outcome: string; tone: string; note: string }) {
  return <div className="tour-evidence-row"><strong>{lead}</strong><span className={`status ${tone}`}>{outcome}</span><span>{note}</span></div>;
}

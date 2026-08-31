"use client";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { useState } from "react";
import { makeFunctionReference } from "convex/server";
import { eventPresentation, nextActionPresentation, stagePresentation, statusPresentation, technicalLabel as label } from "./review-presentation";
type Evidence = {
  review: {
    id: string;
    prNumber: number;
    headSha: string;
    baseSha: string;
    baseRef: string;
    status: string;
    isStale: boolean;
    coverageLevel: string;
    currentStage: string;
    nextActionCode: string;
    mode: string;
    statusReasonCode?: string;
    provider: string;
    model: string;
    budgetLimit: number;
    budgetConsumed: number;
    updatedAt: number;
  };
  repository: { owner: string; name: string };
  requirements: Array<{
    id: string;
    sourceType: string;
    status: string;
    confidence: number;
    hasSource: boolean;
  }>;
  findings: Array<{
    id: string;
    category: string;
    severity: string;
    confidence: number;
    blocking: boolean;
    pathFingerprint: string;
    startLine: number;
    endLine: number;
    evidenceCount: number;
    resolution: string;
    ruleId?: string;
  }>;
  checks: Array<{
    id: string;
    kind: string;
    required: boolean;
    status: string;
    conclusion: string;
    commitSha: string;
    exitCode?: number;
    durationMs: number;
    evidenceAvailable: boolean;
    failureClass?: string;
  }>;
  rounds: Array<{
    id: string;
    roundNumber: number;
    candidateCommitSha: string;
    validationOutcome: string;
    completedValidation: boolean;
  }>;
  events: Array<{
    id: string;
    sequence: number;
    type: string;
    stage: string;
    code: string;
    hasPublicMessage: boolean;
    createdAt: number;
  }>;
};
const evidenceQuery = makeFunctionReference<
    "query",
    { reviewId: string },
    Evidence
  >("reviews:getEvidence"),
  cancelAction = makeFunctionReference<
    "action",
    { reviewId: string },
    { status: "cancelled" | "already_finished" }
  >("dashboardReviews:cancel"),
  tone = (value: string) =>
    ["passed", "checks_passed", "delivered", "accepted", "resolved"].includes(
      value,
    )
      ? "success"
      : [
            "failed",
            "changes_requested",
            "platform_failed",
            "failed_after_bounds",
            "high",
            "critical",
          ].includes(value)
        ? "danger"
        : ["queued", "running", "analyzing", "validating"].includes(value)
          ? "running"
          : "warning";
export function LiveReviewDetail({ id }: { id: string }) {
  const { isAuthenticated, isLoading } = useConvexAuth(),
    cancel = useAction(cancelAction),
    [cancelling, setCancelling] = useState(false),
    [cancelError, setCancelError] = useState(""),
    evidence = useQuery(
      evidenceQuery,
      isAuthenticated ? { reviewId: id } : "skip",
    );
  if (isLoading || (isAuthenticated && evidence === undefined))
    return (
      <State
        title="Loading exact review evidence…"
        detail="BuildIT is checking this review against your active workspace."
      />
    );
  if (!isAuthenticated)
    return (
      <State
        title="Sign in to inspect this review"
        detail="Review evidence is visible only to members of its organization."
        action="/sign-in"
      />
    );
  if (!evidence)
    return (
      <State
        title="Review evidence is unavailable"
        detail="No sample data was substituted. Return to the queue and confirm your active workspace."
      />
    );
  const { review, repository } = evidence;
  const verdict = statusPresentation(review.status, review.isStale),
    nextAction = nextActionPresentation(review.nextActionCode, review.isStale),
    hasEvidence = evidence.requirements.length + evidence.findings.length + evidence.checks.length > 0;
  const canCancel = ![
    "passed",
    "changes_requested",
    "inconclusive",
    "failed_after_bounds",
    "budget_exhausted",
    "cancelled",
    "platform_failed",
  ].includes(review.status);
  async function cancelReview() {
    setCancelling(true);
    setCancelError("");
    try {
      await cancel({ reviewId: id });
    } catch {
      setCancelError("The review could not be cancelled. Refresh its status before trying again.");
    } finally {
      setCancelling(false);
    }
  }
  return (
    <div className="content review-detail">
      <div className="crumbs">
        <a href="/reviews">Review queue</a>
        <span>›</span>
        <strong>
          {repository.owner}/{repository.name} #{review.prNumber}
        </strong>
        <span className="status success">Live data</span>
      </div>
      <section className="verdict-card">
        <div className="verdict-message">
          <span className={`verdict-symbol ${verdict.tone}`} aria-hidden="true">{verdict.symbol}</span>
          <div>
            <span className={`status ${verdict.tone}`}>{verdict.label}</span>
            <h1>{verdict.title}</h1>
            <p>{verdict.summary}</p>
          </div>
        </div>
        <div className="verdict-actions">
          {canCancel ? (
            <button className="button danger" type="button" disabled={cancelling} onClick={cancelReview}>
              {cancelling ? "Cancelling…" : "Cancel review"}
            </button>
          ) : null}
          <a className="button secondary" href={`/reviews`}>
            Back to queue
          </a>
          {cancelError ? <p role="alert">{cancelError}</p> : null}
        </div>
      </section>
      <section className="commit-strip" aria-label="Review scope">
        <Fact
          label="Repository"
          value={`${repository.owner}/${repository.name}`}
        />
        <Fact label="Pull request" value={`#${review.prNumber}`} />
        <Fact label="Head commit" value={review.headSha.slice(0, 12)} mono />
        <Fact label="Mode" value={label(review.mode)} />
        <Fact label="Coverage" value={label(review.coverageLevel)} />
      </section>
      <div className="next-action">
        <span className="next-mark" aria-hidden="true">→</span>
        <div>
          <small>What to do next</small>
          <strong>{nextAction.title}</strong>
          <p>{nextAction.detail}</p>
        </div>
      </div>
      <ReviewJourney currentStage={review.currentStage} status={review.status} />
      <details className="technical-details"><summary>Technical details</summary><dl><div><dt>Base commit</dt><dd><code>{review.baseSha.slice(0, 12)}</code></dd></div><div><dt>Current step</dt><dd>{stagePresentation(review.currentStage)}</dd></div><div><dt>AI provider</dt><dd>{label(review.provider)} · {review.model}</dd></div><div><dt>Spend</dt><dd>{review.budgetConsumed.toFixed(2)} of {review.budgetLimit.toFixed(2)} limit</dd></div></dl></details>
      {!hasEvidence ? <section className="evidence-empty"><span aria-hidden="true">◇</span><div><h2>No evidence was produced</h2><p>{review.status === "cancelled" ? "This review stopped before BuildIT gathered requirements, reported issues, or ran checks." : "BuildIT has not gathered requirements, reported issues, or completed checks yet."}</p></div></section> : null}
      {evidence.requirements.length ? <Section
        eyebrow="Intent"
        title="What this change must do"
        detail={`${evidence.requirements.length} found`}
        foot="Each item is tied to the pull request, a linked ticket, or repository documentation."
      >
        {evidence.requirements.length ? (
          evidence.requirements.map((item, index) => (
            <div className="evidence-row" key={item.id}>
              <code>{index + 1}</code>
              <strong>{label(item.sourceType)} source</strong>
              <span className={`status ${tone(item.status)}`}>
                {label(item.status)}
              </span>
              <span>
                {Math.round(item.confidence * 100)}% confidence ·{" "}
                {item.hasSource
                  ? "encrypted source evidence"
                  : "source unavailable"}
              </span>
            </div>
          ))
        ) : null}
      </Section> : null}
      {evidence.findings.length ? <Section
        eyebrow="Decision support"
        title="Issues to fix"
        detail={`${evidence.findings.length} supported by evidence`}
        foot="BuildIT shows an issue only when it can point to supporting evidence."
      >
        {evidence.findings.length ? (
          evidence.findings.map((item) => (
            <div className="evidence-row" key={item.id}>
              <span className={`status ${tone(item.severity)}`}>
                {label(item.severity)}
              </span>
              <strong>
                {label(item.category)}
                {item.ruleId ? ` · ${item.ruleId}` : ""}
              </strong>
              <span>{item.blocking ? "Blocking" : label(item.resolution)}</span>
              <code>
                path {item.pathFingerprint} · L{item.startLine}–{item.endLine} ·{" "}
                {item.evidenceCount} proof
              </code>
            </div>
          ))
        ) : null}
      </Section> : null}
      {evidence.checks.length ? <Section
        eyebrow="Verification"
        title="Checks run"
        detail={`${evidence.checks.filter((item) => item.required).length} required`}
        foot="A required check needs recorded output before BuildIT can treat it as passed."
        validation
      >
        {evidence.checks.length ? (
          evidence.checks.map((item) => (
            <div className="validation-row" key={item.id}>
              <strong>{label(item.kind)}</strong>
              <span>{item.required ? "Required" : "Optional"}</span>
              <span className={`status ${tone(item.conclusion)}`}>
                {label(item.conclusion)}
              </span>
              <time>{(item.durationMs / 1000).toFixed(1)}s</time>
              <span>
                {item.evidenceAvailable
                  ? "Encrypted stdout recorded"
                  : "No stdout evidence"}
              </span>
            </div>
          ))
        ) : null}
      </Section> : null}
      {evidence.rounds.length ? (
        <Section
          eyebrow="Autofix"
          title="Fix attempts"
          detail={`${evidence.rounds.length} of 3`}
          foot="BuildIT stops after three attempts and never merges the result."
        >
          <div>
            {evidence.rounds.map((item) => (
              <div className="validation-row" key={item.id}>
                <strong>Round {item.roundNumber}</strong>
                <code>{item.candidateCommitSha.slice(0, 12)}</code>
                <span className={`status ${tone(item.validationOutcome)}`}>
                  {label(item.validationOutcome)}
                </span>
                <span>
                  {item.completedValidation ? "Tested" : "Invalid round"}
                </span>
                <span>Human merge required</span>
              </div>
            ))}
          </div>
        </Section>
      ) : null}
      <Section
        eyebrow="History"
        title="Review activity"
        detail={`${evidence.events.length} ${evidence.events.length === 1 ? "event" : "events"}`}
        foot="This history is saved without repository source or model prompts."
      >
        <ol className="activity-list">
          {evidence.events.map((item) => (
            <li className="activity-row" key={item.id}>
              <span className="activity-dot" aria-hidden="true" />
              <div className="activity-copy"><strong>{eventPresentation(item.type)}</strong><span>{stagePresentation(item.stage)}</span></div>
              <time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString()}</time>
              <details><summary>Details</summary><code>Event {item.sequence} · {item.code}</code></details>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
function State({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: string;
}) {
  return (
    <div className="content">
      <section className="live-state">
        <span className="state-pulse" />
        <div>
          <strong>{title}</strong>
          <p>{detail}</p>
          {action ? (
            <a className="button" href={action}>
              Sign in with GitHub
            </a>
          ) : null}
        </div>
      </section>
    </div>
  );
}
function Fact({
  label: name,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <span>
      <small>{name}</small>
      {mono ? <code>{value}</code> : <strong>{value}</strong>}
    </span>
  );
}
function Section({
  eyebrow,
  title,
  detail,
  children,
  foot,
  validation = false,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  children: React.ReactNode;
  foot: string;
  validation?: boolean;
}) {
  return (
    <section className="evidence-section">
      <div className="evidence-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <span>{detail}</span>
      </div>
      <div className={validation ? "validation-table" : "evidence-table"}>
        {children}
      </div>
      <footer className="evidence-foot">
        {foot}
      </footer>
    </section>
  );
}
function ReviewJourney({ currentStage, status }: { currentStage: string; status: string }) {
  const steps = [
    { key: "context", label: "Understand", detail: "Read the PR and requirements" },
    { key: "analysis", label: "Inspect", detail: "Look for risky code changes" },
    { key: "validation", label: "Verify", detail: "Run required checks" },
    { key: "delivery", label: "Hand back", detail: "Show evidence or a tested fix" },
  ], order = ["queue", "context", "analysis", "validation", "autofix", "delivery", "complete"], current = order.indexOf(currentStage), stopped = status === "cancelled";
  return <section className="review-journey" aria-labelledby="review-journey-title"><div><p className="eyebrow">Review journey</p><h2 id="review-journey-title">How far BuildIT got</h2></div><ol>{steps.map((step, index) => { const position = order.indexOf(step.key), complete = !stopped && current > position, active = current === position; return <li key={step.key} data-state={complete ? "complete" : active ? "active" : "waiting"}><span aria-hidden="true">{complete ? "✓" : index + 1}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div></li>; })}</ol></section>;
}

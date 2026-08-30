"use client";
import { useConvexAuth, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
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
  label = (value: string) =>
    value.replaceAll("_", " ").replace(/^./, (first) => first.toUpperCase()),
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
        <div>
          <span className={`status ${tone(review.status)}`}>
            {label(review.status)}
          </span>
          <h1>
            {review.isStale
              ? "This result is stale"
              : label(review.statusReasonCode ?? review.currentStage)}
          </h1>
          <p>
            Decision for exact commit <code>{review.headSha.slice(0, 12)}</code>
            . Missing or partial proof cannot pass.
          </p>
        </div>
        <div className="verdict-actions">
          <a className="button secondary" href={`/reviews`}>
            Back to queue
          </a>
        </div>
      </section>
      <section className="commit-strip">
        <Fact
          label="Repository"
          value={`${repository.owner}/${repository.name}`}
        />
        <Fact label="Pull request" value={`#${review.prNumber}`} />
        <Fact label="Head commit" value={review.headSha.slice(0, 12)} mono />
        <Fact label="Base commit" value={review.baseSha.slice(0, 12)} mono />
        <Fact label="Mode" value={label(review.mode)} />
        <Fact label="Coverage" value={label(review.coverageLevel)} />
      </section>
      <div className="next-action">
        <span className="next-mark">!</span>
        <div>
          <strong>Next action: {label(review.nextActionCode)}</strong>
          <p>
            {review.isStale
              ? "The PR head changed. Start a fresh review; do not rely on this result."
              : `Stage: ${label(review.currentStage)} · Provider: ${review.provider} · spend ${review.budgetConsumed.toFixed(2)} of ${review.budgetLimit.toFixed(2)} ceiling.`}
          </p>
        </div>
      </div>
      <Section
        title="Requirements"
        detail={`${evidence.requirements.length} gathered`}
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
        ) : (
          <Empty text="No requirements have been gathered yet." />
        )}
      </Section>
      <Section
        title="Findings"
        detail={`${evidence.findings.length} evidence-gated`}
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
        ) : (
          <Empty text="No accepted or uncertain findings are recorded." />
        )}
      </Section>
      <Section
        title="Validation matrix"
        detail={`${evidence.checks.filter((item) => item.required).length} required`}
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
        ) : (
          <Empty text="No checks have completed yet." />
        )}
      </Section>
      {evidence.rounds.length ? (
        <Section
          title="Autofix rounds"
          detail={`${evidence.rounds.length} of 3`}
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
        title="Audit timeline"
        detail={`${evidence.events.length} durable events`}
      >
        <div>
          {evidence.events.map((item) => (
            <div className="validation-row" key={item.id}>
              <code>#{item.sequence}</code>
              <strong>{label(item.stage)}</strong>
              <span>{label(item.type)}</span>
              <code>{item.code}</code>
              <time>{new Date(item.createdAt).toLocaleString()}</time>
            </div>
          ))}
        </div>
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
  title,
  detail,
  children,
  validation = false,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
  validation?: boolean;
}) {
  return (
    <section className="evidence-section">
      <div className="evidence-heading">
        <div>
          <p className="eyebrow">Live evidence</p>
          <h2>{title}</h2>
        </div>
        <span>{detail}</span>
      </div>
      <div className={validation ? "validation-table" : "evidence-table"}>
        {children}
      </div>
      <footer className="evidence-foot">
        Source text stays encrypted. This view shows scoped metadata and exact
        evidence availability.
      </footer>
    </section>
  );
}
function Empty({ text }: { text: string }) {
  return <p className="evidence-foot">{text}</p>;
}

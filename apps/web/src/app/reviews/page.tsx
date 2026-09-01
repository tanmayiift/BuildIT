"use client";
import { useConvexAuth, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { sampleReviews } from "../sample-data";
import { useSampleTour } from "../workspace-route-boundary";
import { ActivationPath } from "./activation-path";
import { DashboardReviewStart } from "./dashboard-review-start";
import {
  groupQueueReviews,
  queueSection,
  queueStatusDetail,
  queueStatusLabel,
  type QueueReview,
  type QueueReviewGroup,
  type QueueSection,
} from "./review-row-groups";

type Connection = {
  organization: null | { id: string; name: string };
  repositories: Array<{ id: string; owner: string; name: string }>;
};
type LiveReview = QueueReview;

const connectionQuery = makeFunctionReference<"query", Record<string, never>, Connection>("repositoryConnections:current");
const reviewsQuery = makeFunctionReference<"query", { organizationId: string }, LiveReview[]>("reviews:list");

const groupCopy: Record<QueueSection, { title: string; description: string }> = {
  decision: { title: "Ready for you", description: "A code result is ready for human review." },
  running: { title: "In progress", description: "BuildIT is gathering evidence or running checks." },
  retry: { title: "Needs retry", description: "These runs stopped without making a code decision." },
};

function tone(status: string) {
  if (status === "checks_passed" || status === "delivered") return "success";
  if (status === "changes_requested") return "danger";
  if (["queued", "gathering_context", "analyzing", "validating", "autofix_queued", "autofixing", "validating_round", "validating_final", "cancelling"].includes(status)) return "running";
  if (["inconclusive", "failed_after_bounds", "blocked", "budget_exhausted"].includes(status)) return "warning";
  return status === "platform_failed" ? "danger" : "neutral";
}

export default function ReviewQueue() {
  const tour = useSampleTour();
  const { isAuthenticated } = useConvexAuth();
  const connection = useQuery(connectionQuery, !tour && isAuthenticated ? {} : "skip");
  const reviews = useQuery(reviewsQuery, !tour && connection?.organization ? { organizationId: connection.organization.id } : "skip");
  if (tour) return <SampleQueue />;
  if (!connection || reviews === undefined) return <div className="content"><Heading connected /><section className="live-state" aria-live="polite"><span className="state-pulse" /><div><strong>Loading your review queue…</strong><p>Checking the active organization on the server.</p></div></section></div>;

  const rows = [...reviews].sort((a, b) => b.updatedAt - a.updatedAt);
  const groups = groupQueueReviews(rows);
  const sections = new Map<QueueSection, QueueReviewGroup[]>([
    ["decision", []], ["running", []], ["retry", []],
  ]);
  for (const group of groups) sections.get(queueSection(group.review))!.push(group);

  return <div className="content">
    <Heading connected />
    {connection.organization ? <ActivationPath organizationId={connection.organization.id} /> : null}
    <DashboardReviewStart repositories={connection.repositories} />
    <div id="review-results">
      {(["decision", "running", "retry"] as const).map(section => <LiveGroup key={section} copy={groupCopy[section]} groups={sections.get(section)!} connection={connection} />)}
    </div>
    {rows.length === 0 ? <section className="empty-state live-empty"><span className="empty-mark">PR</span><h2>No reviews in {connection.organization?.name}</h2><p>Preview a pull request above, or comment <code>@buildit review</code> on GitHub. Both paths pin the exact commits before a review starts.</p><div className="button-row"><a className="button secondary" href="/repositories">Open repositories</a><a className="button tertiary" href="/setup/model">Check model key</a></div></section> : null}
  </div>;
}

function Heading({ connected = false }: { connected?: boolean }) {
  return <div className="page-heading"><div><p className="eyebrow">{connected ? "Live workspace · active organization" : "Sample evidence · no repository connected"}</p><h1 className="title">Review queue</h1><p className="page-description">One current result per pull request and exact commit. Earlier attempts stay in the audit trail.</p></div><div className="heading-actions"><a className="button" href={connected ? "/repositories" : "/setup/install"}>{connected ? "View repositories" : "Connect repository"}</a></div></div>;
}

function LiveGroup({ copy, groups, connection }: { copy: { title: string; description: string }; groups: QueueReviewGroup[]; connection: Connection }) {
  if (!groups.length) return null;
  const earlierAttempts = groups.reduce((sum, group) => sum + group.attemptCount - 1, 0);
  return <section className="review-group">
    <div className="section-heading compact review-group-heading"><div><h2>{copy.title}</h2><p>{copy.description}</p></div><div className="review-group-counts"><span className="count">{groups.length} current</span>{earlierAttempts ? <a href="/audit">{earlierAttempts} earlier {earlierAttempts === 1 ? "attempt" : "attempts"} in audit log</a> : null}</div></div>
    <div className="review-table" role="table" aria-label={copy.title}>
      {groups.map(({ review, attemptCount, latestAttempt }) => {
        const repository = connection.repositories.find(item => item.id === review.repositoryId);
        const updated = new Date(review.updatedAt);
        const preservedDecision = latestAttempt.id !== review.id;
        return <a role="row" className="review-row" href={`/reviews/${review.id}`} key={review.id}>
          <span role="cell" className={`status ${tone(review.status)}`}>{queueStatusLabel(review)}</span>
          <span role="cell" className="review-name">
            <strong>{repository ? `${repository.owner}/${repository.name}` : "Authorized repository"} #{review.prNumber}</strong>
            <small>{queueStatusDetail(review)}</small>
            <span className="review-meta"><code title="Exact head commit">{review.headSha.slice(0, 7)}</code><time dateTime={updated.toISOString()}>Decision {updated.toLocaleString()}</time>{attemptCount > 1 ? <span>{attemptCount - 1} other {attemptCount === 2 ? "attempt" : "attempts"} in audit</span> : null}{preservedDecision ? <span>Latest retry stopped; decision preserved</span> : null}</span>
          </span>
          <span className="row-arrow" aria-hidden="true">→</span>
        </a>;
      })}
    </div>
  </section>;
}

function SampleQueue() {
  const needsDecision = sampleReviews.filter(review => review.status !== "Running");
  const running = sampleReviews.filter(review => review.status === "Running");
  return <div className="content"><Heading /><SampleGroup title="Ready for you" reviews={needsDecision} /><SampleGroup title="In progress" reviews={running} /><section className="empty-band"><div><strong>This is an interactive product tour</strong><p>Connect GitHub to replace these clearly marked examples with tenant-scoped review records.</p></div><a href="/data-handling">Read retention policy →</a></section></div>;
}

function SampleGroup({ title, reviews }: { title: string; reviews: typeof sampleReviews }) {
  return <section className="review-group"><div className="section-heading compact review-group-heading"><div><h2>{title}</h2><p>Example results only.</p></div><span className="count">{reviews.length} current</span></div><div className="review-table" role="table" aria-label={title}>{reviews.map(review => <a role="row" className="review-row" href={`/reviews/${review.pr}?tour=1`} key={review.pr}><span role="cell" className={`status ${review.tone}`}>{review.status}</span><span role="cell" className="review-name"><strong>{review.repo} #{review.pr}</strong><small>{review.title}</small><span className="review-meta"><code>{review.commit}</code><span>{review.coverage}</span><span>{review.age}</span></span></span><span className="row-arrow" aria-hidden="true">→</span></a>)}</div></section>;
}

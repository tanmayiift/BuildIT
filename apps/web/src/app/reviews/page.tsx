"use client";
import { useConvexAuth, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import Link from "next/link";
import { sampleReviews } from "../sample-data";
import { useSampleTour } from "../workspace-route-boundary";
import { ActivationPath } from "./activation-path";
import { DashboardReviewStart } from "./dashboard-review-start";
import { StatePanel } from "../state-panel";
import {
  groupQueueReviews,
  queueSummary,
  splitSuperseded,
  queueSection,
  queueStatusDetail,
  queueStatusLabel,
  type QueueReview,
  type QueueReviewGroup,
  type QueueSection,
} from "./review-row-groups";
import { EmptyState } from "../empty-state";

type Connection = {
  organization: null | { id: string; name: string; role: "viewer" | "developer" | "admin" | "owner" };
  repositories: Array<{ id: string; owner: string; name: string }>;
};
type LiveReview = QueueReview;

const connectionQuery = makeFunctionReference<"query", Record<string, never>, Connection>("repositoryConnections:current");
const reviewsQuery = makeFunctionReference<"query", { organizationId: string }, { rows: LiveReview[]; truncated: boolean; limit: number }>("reviews:list");

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
  if (!connection) return <div className="content"><Heading /><StatePanel loading title="Loading your review queue…" detail="Checking the active organization on the server." /></div>;
  // Without an active organization the queue query stays skipped, so `reviews` never resolves.
  // Waiting on it renders a spinner that can never finish; say what is missing instead.
  if (!connection.organization) return <div className="content"><Heading /><EmptyState size="live" mark="GH" title="Connect a repository to start reviewing" detail="You are signed in, but no workspace is active yet. Choose the repositories BuildIT may read in GitHub, and your review queue appears here." actions={<><a className="button" href="/setup/install">Choose repository access</a><a className="button secondary" href="/reviews?tour=1">View the sample tour</a></>} /></div>;
  if (reviews === undefined) return <div className="content"><Heading connected /><StatePanel loading title="Loading your review queue…" detail="Checking the active organization on the server." /></div>;

  const rows = [...reviews.rows].sort((a, b) => b.updatedAt - a.updatedAt);
  const groups = groupQueueReviews(rows);
  const sections = new Map<QueueSection, QueueReviewGroup[]>([
    ["decision", []], ["running", []], ["retry", []],
  ]);
  for (const group of groups) sections.get(queueSection(group.review))!.push(group);

  return <div className="content">
    <Heading connected />
    {connection.organization ? <ActivationPath organizationId={connection.organization.id} /> : null}
    <DashboardReviewStart repositories={connection.repositories} canStartReview={connection.organization.role !== "viewer"} />
    {reviews.truncated ? <p role="status">Showing the latest {reviews.limit} review attempts. Counts and earlier attempts below cover this subset.</p> : null}
    {groups.length ? <QueueSummary items={queueSummary(groups)} superseded={splitSuperseded(groups).superseded.length} /> : null}
    <div id="review-results">
      {(["decision", "running", "retry"] as const).map(section => <LiveGroup key={section} copy={groupCopy[section]} groups={sections.get(section)!} connection={connection} />)}
    </div>
    {rows.length === 0 ? <EmptyState size="live" mark="PR" title={`No reviews in ${connection.organization.name}`} detail={<>Preview a pull request above, or comment <code>@buildit review</code> on GitHub. Both paths pin the exact commits before a review starts.</>} actions={<><a className="button secondary" href="/repositories">Open repositories</a><a className="button tertiary" href="/setup/model">Check model key</a></>} /> : null}
  </div>;
}

function Heading({ connected = false }: { connected?: boolean }) {
  return <div className="page-heading"><div><p className="eyebrow">{connected ? "Live workspace · active organization" : "Sample evidence · no repository connected"}</p><h1 className="title">Review queue</h1><p className="page-description">One current result per pull request and exact commit. Earlier attempts stay in the audit trail.</p></div><div className="heading-actions"><a className="button" href={connected ? "/repositories" : "/setup/install"}>{connected ? "View repositories" : "Connect repository"}</a></div></div>;
}

// The verdicts of the current results as one bar and its legend, before any row. The bar is a
// picture of the legend beside it, so it is hidden from assistive technology and the legend is not.
function QueueSummary({ items, superseded }: { items: ReturnType<typeof queueSummary>; superseded: number }) {
  return <section className="queue-summary" aria-label="Current results by verdict">
    <div className="queue-summary-bar" aria-hidden="true">{items.map(item => <span key={item.label} className={`queue-summary-segment ${tone(item.status)}`} style={{ flexGrow: item.count }} />)}</div>
    <ul>{items.map(item => <li key={item.label}><span className={`status ${tone(item.status)}`}>{item.label}</span><strong>{item.count}</strong></li>)}</ul>
    {superseded ? <p>{superseded} more {superseded === 1 ? "result is" : "results are"} for commits a pull request has since moved past, folded under each section.</p> : null}
  </section>;
}

function LiveGroup({ copy, groups: all, connection }: { copy: { title: string; description: string }; groups: QueueReviewGroup[]; connection: Connection }) {
  if (!all.length) return null;
  const { current: groups, superseded } = splitSuperseded(all);
  const earlierAttempts = all.reduce((sum, group) => sum + group.attemptCount - 1, 0);
  return <section className="review-group">
    <div className="section-heading compact review-group-heading"><div><h2>{copy.title}</h2><p>{copy.description}</p></div><div className="review-group-counts"><span className="count">{groups.length} current</span>{earlierAttempts ? <a href="/audit">{earlierAttempts} earlier {earlierAttempts === 1 ? "attempt" : "attempts"} in audit log</a> : null}</div></div>
    {groups.length ? <QueueRows label={copy.title} groups={groups} connection={connection} /> : null}
    {superseded.length ? <details className="queue-superseded"><summary>{superseded.length} {superseded.length === 1 ? "result" : "results"} for commits the pull request has moved past</summary><QueueRows label={`${copy.title}: earlier commits`} groups={superseded} connection={connection} /></details> : null}
  </section>;
}

function QueueRows({ label, groups, connection }: { label: string; groups: QueueReviewGroup[]; connection: Connection }) {
  return <div className="review-table" role="table" aria-label={label}>
      {groups.map(({ review, attemptCount, latestAttempt }) => {
        const repository = connection.repositories.find(item => item.id === review.repositoryId);
        const updated = new Date(review.updatedAt);
        const preservedDecision = latestAttempt.id !== review.id;
        return <Link role="row" className="review-row" href={`/reviews/${review.id}`} key={review.id}>
          <span role="cell" className={`status ${tone(review.status)}`}>{queueStatusLabel(review)}</span>
          <span role="cell" className="review-name">
            <strong>{repository ? `${repository.owner}/${repository.name}` : "Authorized repository"} #{review.prNumber}</strong>
            <small>{queueStatusDetail(review)}</small>
            <span className="review-meta"><code title="Exact head commit">{review.headSha.slice(0, 7)}</code><time dateTime={updated.toISOString()}>Decision {updated.toLocaleString()}</time>{attemptCount > 1 ? <span>{attemptCount - 1} other {attemptCount === 2 ? "attempt" : "attempts"} in audit</span> : null}{preservedDecision ? <span>Latest retry stopped; decision preserved</span> : null}</span>
          </span>
          <span className="row-arrow" aria-hidden="true">→</span>
        </Link>;
      })}
    </div>;
}

function SampleQueue() {
  return <div className="content"><Heading /><SampleGroup title="Ready for you" reviews={sampleReviews.filter(review => review.group === "ready")} /><SampleGroup title="In progress" reviews={sampleReviews.filter(review => review.group === "progress")} /><section className="empty-band"><div><strong>This is an interactive product tour</strong><p>Connect GitHub to replace these clearly marked examples with tenant-scoped review records.</p></div><a href="/data-handling">Read retention policy →</a></section></div>;
}

function SampleGroup({ title, reviews }: { title: string; reviews: typeof sampleReviews }) {
  return <section className="review-group"><div className="section-heading compact review-group-heading"><div><h2>{title}</h2><p>Example results only.</p></div><span className="count">{reviews.length} current</span></div><div className="review-table" role="table" aria-label={title}>{reviews.map(review => <a role="row" className="review-row" href={`/reviews/${review.pr}?tour=1`} key={review.pr}><span role="cell" className={`status ${review.tone}`}>{review.status}</span><span role="cell" className="review-name"><strong>{review.repo} #{review.pr}</strong><small>{review.title}</small><span className="review-meta"><code>{review.commit}</code><span>{review.coverage}</span><span>{review.age}</span></span></span><span className="row-arrow" aria-hidden="true">→</span></a>)}</div></section>;
}

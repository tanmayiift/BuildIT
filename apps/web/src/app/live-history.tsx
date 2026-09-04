"use client";

import { makeFunctionReference } from "convex/server";
import { useQuery } from "convex/react";
import { useConnection } from "./live-connections";

const historyQuery = makeFunctionReference<"query",
  { organizationId: string; since: number },
  null | {
    pullRequests: Array<{ reviewId: string; prNumber: number; status: string; reason: string | null;
      incompleteReason: string | null; trigger: string; blocking: number; findings: number;
      accepted: number; dismissed: number; costUsd: number; durationMs: number | null; stale: boolean }>;
    totals: { reviews: number; decisive: number; inconclusive: number; platformFailed: number;
      automatic: number; costUsd: number; accepted: number; dismissed: number };
  }>("reviewHistory:summary");

const thirtyDays = 30 * 24 * 60 * 60 * 1000;

function money(value: number) {
  return `$${value.toFixed(4)}`;
}

function duration(ms: number | null) {
  if (ms === null) return "—";
  const seconds = Math.round(ms / 1000);
  return seconds < 90 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

function verdict(status: string) {
  if (status === "changes_requested") return { label: "Changes requested", tone: "danger" };
  if (status === "checks_passed") return { label: "Ready for review", tone: "success" };
  if (status === "delivered") return { label: "Fix delivered", tone: "success" };
  if (status === "inconclusive") return { label: "Inconclusive", tone: "warning" };
  if (status === "platform_failed") return { label: "Did not finish", tone: "danger" };
  return { label: status.replace(/_/g, " "), tone: "info" };
}

export function LiveHistory() {
  const connection = useConnection();
  const organizationId = connection && connection.state !== "signed_out" ? connection.organization?.id : undefined;
  const history = useQuery(historyQuery, organizationId ? { organizationId, since: Date.now() - thirtyDays } : "skip");

  if (!organizationId) return <p className="lede">Sign in to see the reviews BuildIT has run for your workspace.</p>;
  if (history === undefined) return <p className="lede" aria-live="polite">Reading your review history…</p>;
  if (!history || !history.pullRequests.length) {
    return <section className="evidence-empty"><span aria-hidden="true">◇</span><div>
      <h2>No reviews in the last 30 days</h2>
      <p>Once BuildIT reviews a pull request, this page shows what it found, what it cost, and what your team did with each finding.</p>
    </div></section>;
  }

  const { totals } = history;
  // Feedback is the only honest measure of whether this is useful here, so it is stated as a rate
  // and as a count - a 100% acceptance rate on two findings means less than it looks.
  const judged = totals.accepted + totals.dismissed;

  return <>
    {/* .metric styles its children by element - span is the label, strong the figure, small the
        detail - so the order here matches live-metrics-usage.tsx rather than inventing a second
        metric system with no responsive rules of its own. */}
    <section className="metric-line" aria-label="Review totals for the last 30 days">
      <div className="metric"><span>Reviews</span><strong>{totals.reviews}</strong><small>{totals.automatic} started automatically</small></div>
      <div className="metric"><span>Reached a verdict</span><strong>{totals.decisive}</strong><small>{totals.inconclusive} inconclusive, {totals.platformFailed} did not finish</small></div>
      <div className="metric"><span>Model cost</span><strong>{money(totals.costUsd)}</strong><small>billed to your own provider key</small></div>
      <div className="metric"><span>Findings judged</span><strong>{judged ? `${Math.round((totals.accepted / judged) * 100)}%` : "—"}</strong><small>{judged ? `${totals.accepted} accepted, ${totals.dismissed} dismissed` : "no feedback yet"}</small></div>
    </section>

    <section className="evidence-section">
      <div className="evidence-heading"><div><p className="eyebrow">Triage</p><h2>Ordered by what BuildIT found</h2></div><span>{history.pullRequests.length} shown</span></div>
      <div className="tour-evidence">
        {history.pullRequests.map(item => {
          const shown = verdict(item.status);
          return <div className="tour-evidence-row" key={item.reviewId}>
            <strong>#{item.prNumber}{item.stale ? " (superseded)" : ""}</strong>
            <span className={`status ${shown.tone}`}>{shown.label}</span>
            <span>
              {item.blocking ? `${item.blocking} blocking of ${item.findings} findings` : item.findings ? `${item.findings} findings, none blocking` : "no findings"}
              {item.incompleteReason ? ` · ${item.incompleteReason.replace(/_/g, " ")}` : ""}
              {` · ${money(item.costUsd)} · ${duration(item.durationMs)}`}
              {item.trigger === "automatic" ? " · automatic" : ""}
              {item.accepted || item.dismissed ? ` · ${item.accepted} accepted, ${item.dismissed} dismissed` : ""}
            </span>
          </div>;
        })}
      </div>
      <footer className="evidence-foot">Cost is what your provider billed for these reviews, read from the same ledger as the Usage page. A person still makes every merge decision.</footer>
    </section>
  </>;
}

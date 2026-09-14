"use client";

import { makeFunctionReference } from "convex/server";
import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { useConnection } from "./live-connections";

const historyQuery = makeFunctionReference<"query",
  { organizationId: string; since: number; refreshKey: string },
  null | {
    observedAt: number;
    costPending: boolean;
    partial: { reviews: boolean; spend: boolean; findings: boolean; feedback: boolean; list: boolean };
    window: { since: number; until: number };
    pullRequests: Array<{ reviewId: string; prNumber: number; status: string; reason: string | null;
      incompleteReason: string | null; trigger: string; blocking: number; findings: number;
      accepted: number; dismissed: number; costUsd: number; durationMs: number | null; stale: boolean; findingsPartial: boolean; feedbackPartial: boolean; costPartial: boolean; costPending: boolean }>;
    totals: { reviews: number; decisive: number; inconclusive: number; platformFailed: number;
      automatic: number; costUsd: number; accepted: number; dismissed: number };
  }>("reviewHistory:summary");

const precedingDays = 29 * 24 * 60 * 60 * 1000;

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
  const [refreshKey, setRefreshKey] = useState(() => new Date().toISOString().slice(0, 10));
  useEffect(() => { const timer = setInterval(() => setRefreshKey(new Date().toISOString().slice(0, 10)), 60_000); return () => clearInterval(timer); }, []);
  const since = useMemo(() => Date.parse(`${refreshKey}T00:00:00.000Z`) - precedingDays, [refreshKey]);
  const organizationId = connection && connection.state !== "signed_out" ? connection.organization?.id : undefined;
  const history = useQuery(historyQuery, organizationId ? { organizationId, since, refreshKey } : "skip");

  if (!organizationId) return <p className="lede">Sign in to see the reviews BuildIT has run for your workspace.</p>;
  if (history === undefined) return <p className="lede" aria-live="polite">Reading your review history…</p>;
  if (!history || (!history.pullRequests.length && history.totals.costUsd === 0 && !Object.values(history.partial).some(Boolean))) {
    return <section className="evidence-empty"><span aria-hidden="true">◇</span><div>
      <h2>No reviews in the last 30 UTC calendar days</h2>
      <p>Once BuildIT reviews a pull request, this page shows what it found, what it cost, and what your team did with each finding.</p>
    </div></section>;
  }

  const { totals, partial } = history;
  // Feedback is the only honest measure of whether this is useful here, so it is stated as a rate
  // and as a count - a 100% acceptance rate on two findings means less than it looks.
  const judged = totals.accepted + totals.dismissed;

  return <>
    {Object.values(partial).some(Boolean) ? <p role="status">History is incomplete. Counts may omit older rows or extra findings, and provider costs may still be pending.</p> : null}
    {/* .metric styles its children by element - span is the label, strong the figure, small the
        detail - so the order here matches live-metrics-usage.tsx rather than inventing a second
        metric system with no responsive rules of its own. */}
    <section className="metric-line" aria-label="Review totals for the last 30 UTC calendar days">
      <div className="metric"><span>Review attempts</span><strong>{partial.reviews ? "At least " : ""}{totals.reviews}</strong><small>{totals.automatic} started automatically</small></div>
      <div className="metric"><span>Reached a verdict</span><strong>{totals.decisive}</strong><small>{totals.inconclusive} inconclusive, {totals.platformFailed} did not finish</small></div>
      <div className="metric"><span>Recorded model cost</span><strong>{history.costPending && totals.costUsd === 0 ? "Pending" : `${partial.spend ? "At least " : ""}${money(totals.costUsd)}`}</strong><small>charges recorded during this period</small></div>
      <div className="metric"><span>Finding occurrences judged</span><strong>{partial.feedback ? "Incomplete" : judged ? `${Math.round((totals.accepted / judged) * 100)}%` : "—"}</strong><small>{judged ? `${totals.accepted} accepted, ${totals.dismissed} dismissed` : partial.feedback ? "feedback rows omitted" : "no feedback yet"}</small></div>
    </section>

    <section className="evidence-section">
      <div className="evidence-heading"><div><p className="eyebrow">Triage</p><h2>Recent attempts ordered by findings</h2></div><span>{history.pullRequests.length} shown</span></div>
      <div className="tour-evidence">
        {history.pullRequests.map(item => {
          const shown = verdict(item.status);
          return <div className="tour-evidence-row" key={item.reviewId}>
            <strong>#{item.prNumber}{item.stale ? " (superseded)" : ""}</strong>
            <span className={`status ${shown.tone}`}>{shown.label}</span>
            <span>
              {item.blocking ? `${item.blocking} blocking of ${item.findings} findings` : item.findings ? `${item.findings} findings, none blocking` : item.findingsPartial ? "findings incomplete" : "no findings"}
              {item.incompleteReason ? ` · ${item.incompleteReason.replace(/_/g, " ")}` : ""}
              {item.findingsPartial ? " · partial findings" : ""}
              {` · ${item.costPending && item.costUsd === 0 ? "cost pending" : `${item.costPartial ? "at least " : ""}${money(item.costUsd)} in period`} · ${item.durationMs === null ? "duration not measured" : duration(item.durationMs)}`}
              {item.trigger === "automatic" ? " · automatic" : ""}
              {item.accepted || item.dismissed ? ` · ${item.accepted} accepted, ${item.dismissed} dismissed` : ""}
            </span>
          </div>;
        })}
      </div>
      <footer className="evidence-foot">Costs include recorded charges from {new Date(history.window.since).toLocaleDateString(undefined, { timeZone: "UTC" })} through {new Date(history.observedAt).toLocaleDateString(undefined, { timeZone: "UTC" })} UTC, including charges for reviews started earlier. Feedback counts each finding occurrence once using its latest recorded opinion. A person still makes every merge decision.</footer>
    </section>
  </>;
}

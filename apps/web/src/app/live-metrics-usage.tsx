"use client";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useState } from "react";
import { NoActiveWorkspace } from "./no-active-workspace";
import { useSampleTour } from "./workspace-route-boundary";
type Connection = { organization: null | { id: string; name: string } };
// The product told people to raise a ceiling that nothing in it could raise. A review that runs out
// of budget ends with nextActionCode "increase_budget", the dashboard renders that as "Increase the
// review budget", and organizations:updateCapacity - which has enforced a 0-5000 range and an
// owner-plus-recent-auth check since the day it was written - had no caller anywhere. Every
// organization was stuck on the limits it was seeded with, and the only instruction offered was one
// nobody could follow.
const updateCapacity = makeFunctionReference<"mutation", { organizationId: string; monthlyBudget?: number; concurrencyLimit?: number; requestId: string }, null>("organizations:updateCapacity");
const connectionQuery = makeFunctionReference<"query", Record<string, never>, Connection>("repositoryConnections:current"), metricsQuery = makeFunctionReference<"query", { organizationId: string; since: number }, Record<string, number>>("metrics:summarize");
// `truncated` is on the wire and was missing from this type, so the page printed a window of the
// month as if it were the month. usage:summarize caps its read at parentScope.summaryRowCeiling and
// sets the flag when it hit the cap, precisely so the caller can say the figures are a floor.
const usageQuery = makeFunctionReference<"query", { organizationId: string; since: number }, { quantities: Record<string, number>; costs: Record<string, number>; recordCount: number; truncated: boolean; monthlyBudget: number }>("usage:summarize");
const sunday = () => { const date = new Date(), day = date.getDay(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - day); return date.getTime(); };
export function WorkspaceMetrics() { const tour = useSampleTour(), { isAuthenticated } = useConvexAuth(), connection = useQuery(connectionQuery, !tour && isAuthenticated ? {} : "skip"), since = sunday(), totals = useQuery(metricsQuery, connection?.organization ? { organizationId: connection.organization.id, since } : "skip"); if (tour) return <NoLiveData noun="metrics"/>; if (connection && !connection.organization) return <NoActiveWorkspace heading="No workspace is active yet" detail="Outcome counts are scoped to one workspace, so there is nothing to count until one is active." />; if (!connection?.organization || totals === undefined) return <Loading noun="metrics"/>; return <><div className="metric-line"><Metric title="PRs reviewed" value={totals.review_completed ?? 0} detail="Completed since Sunday" hero/><Metric title="Regressions caught" value={totals.ci_regression_caught ?? 0} detail="Base passed, head failed"/><Metric title="Verified Autofixes" value={totals.autofix_applied ?? 0} detail="Delivered after final checks"/><Metric title="Runner failures" value={totals.runner_failure ?? 0} detail="Platform failures, never passes"/></div><section className="metric-explainer"><div><p className="eyebrow">Accuracy</p><h2>Not reported without human labels</h2><p>Operational totals are live. Precision and recall remain hidden until a blind, adjudicated evaluation run meets the release sample threshold.</p></div><div className="formula"><span>Provider failures</span><strong>{totals.provider_failure ?? 0}</strong><small>Since Sunday</small></div><div className="formula"><span>Stale reviews</span><strong>{totals.stale_review ?? 0}</strong><small>Never counted as passed</small></div></section></>; }
export function WorkspaceUsage() { const tour = useSampleTour(), { isAuthenticated } = useConvexAuth(), connection = useQuery(connectionQuery, !tour && isAuthenticated ? {} : "skip"), since = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime(), usage = useQuery(usageQuery, connection?.organization ? { organizationId: connection.organization.id, since } : "skip"); if (tour) return <NoLiveData noun="usage"/>; if (connection && !connection.organization) return <NoActiveWorkspace heading="No workspace is active yet" detail="Usage and budgets are recorded per workspace, so there is no ledger to read until one is active." />; if (!connection?.organization || usage === undefined) return <Loading noun="usage"/>; const q = usage.quantities, knownCost = Object.entries(usage.costs).filter(([currency]) => currency !== "provider_billed").reduce((sum, [, value]) => sum + value, 0), percent = usage.monthlyBudget > 0 ? Math.min(100, knownCost / usage.monthlyBudget * 100) : 0; return <><section className="budget-board"><div><p className="eyebrow">Current month · {connection.organization.name}</p><strong>{knownCost.toFixed(2)} <small>of {usage.monthlyBudget.toFixed(2)} configured budget units</small></strong><div className="budget-track"><span style={{ width: `${percent}%` }}/></div><p>{(q.model_tokens ?? 0).toLocaleString()} model tokens · {(q.sandbox_seconds ?? 0).toLocaleString()} sandbox seconds · {(q.storage_bytes ?? 0).toLocaleString()} storage bytes</p>{usage.truncated ? <p className="muted-copy" role="status">Every figure above, and the bar, read only the most recent {usage.recordCount.toLocaleString()} ledger records of this month. The month holds more than that, so these are floors rather than totals.</p> : null}</div><aside><BudgetControl organizationId={connection.organization.id} current={usage.monthlyBudget}/><strong>{usage.truncated ? `Most recent ${usage.recordCount.toLocaleString()} of this month's ledger records` : `${usage.recordCount} source-free ledger records`}</strong><p>The organization has not configured a currency label. Provider-billed keys are reported as tokens unless the provider supplies trusted cost.</p></aside></section><section className="empty-band"><div><strong>Budget gate remains fail-closed</strong><p>A review does not start when its estimate exceeds the remaining ceiling. Partial work is never called a pass.</p></div><a href="/integrations">Manage provider →</a></section></>; }
function BudgetControl({ organizationId, current }: { organizationId: string; current: number }) {
  const update = useMutation(updateCapacity), [value, setValue] = useState(String(current)), [message, setMessage] = useState(""), [working, setWorking] = useState(false);
  return <form className="budget-form" onSubmit={event => {
    event.preventDefault();
    const next = Number(value);
    // Mirrors the server bound rather than trusting it silently, so the reason arrives before the
    // round trip. The server still enforces it; this only spares the user a round trip to learn it.
    if (!Number.isFinite(next) || next < 0 || next > 5_000) { setMessage("Enter a monthly ceiling between 0 and 5,000."); return; }
    setWorking(true); setMessage("");
    void update({ organizationId, monthlyBudget: next, requestId: `budget-${organizationId}-${next}` })
      .then(() => setMessage("Monthly ceiling updated."))
      .catch(() => setMessage("Only a workspace owner with a recent GitHub sign-in can change the ceiling."))
      .finally(() => setWorking(false));
  }}>
    <label htmlFor="monthly-budget">Monthly ceiling</label>
    <input id="monthly-budget" name="monthlyBudget" type="number" min={0} max={5000} step={1} value={value} onChange={event => setValue(event.target.value)}/>
    <button className="button secondary" type="submit" disabled={working}>{working ? "Saving…" : "Save"}</button>
    <p className="muted-copy" role="status">{message || "Owners only. A review refuses to start when its estimate exceeds what is left."}</p>
  </form>;
}

function Metric({ title, value, detail, hero = false }: { title: string; value: number; detail: string; hero?: boolean }) { return <article className={`metric${hero ? " hero-metric" : ""}`}><span>{title}</span><strong>{value.toLocaleString()}</strong><small>{detail}</small></article>; }
function Loading({ noun }: { noun: string }) { return <section className="live-state" aria-live="polite"><span className="state-pulse"/><div><strong>Loading live {noun}…</strong><p>Checking the active organization on the server.</p></div></section>; }
function NoLiveData({ noun }: { noun: string }) { return <section className="empty-state compact-empty"><span className="empty-mark">—</span><h2>No sample {noun} are shown</h2><p>Connect a workspace to see tenant-scoped records. BuildIT does not present illustrative activity as customer data.</p></section>; }

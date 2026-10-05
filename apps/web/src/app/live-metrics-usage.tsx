"use client";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useEffect, useState } from "react";
import type { WorkspaceMetricsSummary, WorkspaceUsageSummary } from "../../../../convex/lib/workspaceFigureTypes";
import { NoActiveWorkspace } from "./no-active-workspace";
import { useSampleTour } from "./workspace-route-boundary";
import { Metric } from "./metric";
import { StatePanel } from "./state-panel";

type Connection = { organization: null | { id: string; name: string; role?: string } };
const connectionQuery = makeFunctionReference<"query", Record<string, never>, Connection>("repositoryConnections:current");
const metricsQuery = makeFunctionReference<"query", { organizationId: string; refreshKey: string }, WorkspaceMetricsSummary>("metrics:summarize");
const usageQuery = makeFunctionReference<"query", { organizationId: string; refreshKey: string }, WorkspaceUsageSummary>("usage:summarize");
const prepareUsage = makeFunctionReference<"mutation", { organizationId: string }, null>("usage:prepare");
const updateCapacity = makeFunctionReference<"mutation", { organizationId: string; monthlyBudget?: number; concurrencyLimit?: number; requestId: string }, null>("organizations:updateCapacity");

export function WorkspaceMetrics() {
  const tour = useSampleTour(), { isAuthenticated } = useConvexAuth(), refreshKey = useReportingRefresh();
  const connection = useQuery(connectionQuery, !tour && isAuthenticated ? {} : "skip");
  const summary = useQuery(metricsQuery, connection?.organization ? { organizationId: connection.organization.id, refreshKey } : "skip");
  if (tour) return <NoLiveData noun="metrics"/>;
  if (connection && !connection.organization) return <NoActiveWorkspace heading="No workspace is active yet" detail="Outcome counts are scoped to one workspace, so there is nothing to count until one is active."/>;
  if (!connection?.organization || summary === undefined) return <Loading noun="metrics"/>;
  if (!summary.totals) return <StatePanel title="Metrics are unavailable until the workspace service update is complete." />;
  const { totals, truncated } = summary;
  const incomplete = new Set(summary.incompleteNames ?? []);
  const metric = (name: string, title: string, detail: string, hero = false) => <Metric title={title} value={incomplete.has(name) && !totals[name] ? "—" : (totals[name] ?? 0).toLocaleString()} detail={detail} hero={hero} note={truncated ? "Partial count" : incomplete.has(name) ? "Incomplete history" : undefined}/>;
  return <>
    <p className="muted-copy">Since {new Date(summary.since).toLocaleDateString(undefined, { timeZone: "UTC" })} · UTC</p>
    <div className="metric-line">
      {metric("review_completed", "Completed review runs", "Includes completed inconclusive reviews", true)}
      {metric("ci_regression_caught", "Regressions caught", "Review runs with base passed and head failed")}
      {metric("autofix_applied", "Verified Autofixes", "Delivered after final checks")}
      {metric("runner_failure", "Runner failures", "Review attempts with a runner failure")}
    </div>
    {truncated ? <p className="muted-copy" role="status">These are partial counts from the most recent {summary.recordCount.toLocaleString()} metric records in this period. Older records are omitted.</p> : null}
    {incomplete.size ? <p className="muted-copy">Failure, stale-review, and regression history was not recorded for the full period. A dash means no reliable count is available; recorded counts are lower bounds.</p> : null}
    <section className="metric-explainer">
      <div><p className="eyebrow">Accuracy</p><h2>Not reported without human labels</h2><p>Precision and recall remain hidden until a blind, adjudicated evaluation run meets the release sample threshold.</p></div>
      {metric("provider_failure", "Provider failures", "Failed model invocations")}
      {metric("stale_review", "Stale reviews", "Reviews superseded by a new commit")}
    </section>
  </>;
}

export function WorkspaceUsage() {
  const tour = useSampleTour(), { isAuthenticated } = useConvexAuth(), refreshKey = useReportingRefresh();
  const connection = useQuery(connectionQuery, !tour && isAuthenticated ? {} : "skip");
  const usage = useQuery(usageQuery, connection?.organization ? { organizationId: connection.organization.id, refreshKey } : "skip");
  const prepare = useMutation(prepareUsage), [prepareError, setPrepareError] = useState(false);
  const organizationId = connection?.organization?.id, reconciled = usage?.budget?.reconciliationComplete;
  useEffect(() => {
    if (!organizationId || reconciled !== false) return;
    setPrepareError(false);
    void prepare({ organizationId }).catch(() => setPrepareError(true));
  }, [organizationId, reconciled, prepare]);
  if (tour) return <NoLiveData noun="usage"/>;
  if (connection && !connection.organization) return <NoActiveWorkspace heading="No workspace is active yet" detail="Usage and budgets are recorded per workspace, so there is no ledger to read until one is active."/>;
  if (!connection?.organization || usage === undefined) return <Loading noun="usage"/>;
  const q = usage.quantities, budget = usage.budget;
  const ready = budget?.reconciliationComplete === true;
  const spend = budget?.estimatedSpendUsd ?? 0, ceiling = budget?.monthlyBudgetUsd ?? usage.monthlyBudget;
  const percent = ceiling > 0 ? Math.min(100, Math.max(0, spend / ceiling * 100)) : 0;
  return <>
    <section className="budget-board">
      <div>
        <p className="eyebrow">{budget?.month ?? "Current month"} · UTC · {connection.organization.name}</p>
        {ready ? <>
          <strong>${spend.toFixed(2)} <small>{ceiling > 0 ? `of $${ceiling.toFixed(2)} monthly limit` : <span>No monthly limit</span>}</small></strong>
          {ceiling > 0 ? <div className="budget-track" role="progressbar" aria-label="Estimated model spend" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`$${spend.toFixed(2)} estimated spend of $${ceiling.toFixed(2)} USD`}><span style={{ width: `${percent}%` }}/></div> : null}
          <p>Recorded estimated model spend · USD. Your provider’s invoice may differ.</p>
          {budget.reservedUsd > 0 ? <p>${budget.reservedUsd.toFixed(2)} reserved for pending or uncertain model calls.{budget.remainingUsd !== null ? ` $${budget.remainingUsd.toFixed(2)} remains available.` : ""}</p> : null}
        </> : <p role="status">Accounting is being reconciled. A complete monthly spend figure is not available yet.</p>}
        {prepareError ? <p role="alert">The accounting update could not start. <button type="button" onClick={() => { setPrepareError(false); void prepare({ organizationId: connection.organization!.id }).catch(() => setPrepareError(true)); }}>Retry accounting update</button></p> : null}
        {budget && (budget.unknownInvocationCount > 0 || budget.legacyCostsMayBeIncomplete) ? <p className="muted-copy" role="status">Some model charges are unknown or were not recorded by earlier versions. The recorded estimate is a lower bound.</p> : null}
        <p>{((q.model_tokens ?? 0) + (q.ask_tokens ?? 0)).toLocaleString()} model tokens including Ask · {(q.sandbox_seconds ?? 0).toLocaleString()} recorded validation-command seconds</p>
        <p className="muted-copy">Storage usage is not measured. Validation time does not include every sandbox operation.</p>
        {/* The figure the admission check actually compares against. Without it, a review refused
            for the sandbox allowance sent its author to this page and the number was not here. */}
        <p>{usage.sandbox.usedSeconds.toLocaleString()} of {usage.sandbox.ceilingSeconds.toLocaleString()} sandbox seconds used this month{usage.sandbox.usedSeconds >= usage.sandbox.ceilingSeconds ? " · no new review can run its checks until the allowance resets" : ""}</p>
        <p className="muted-copy">Sandbox time is BuildIT&rsquo;s own shared capacity, not a charge on your provider key, so the allowance resets at the start of each month and is set by BuildIT rather than here.</p>
        {/* Both limits, because a workspace inside its own allowance can still be refused on the
            shared one, and the page has to say which is in the way. */}
        {usage.sandbox.platformUsedSeconds >= usage.sandbox.platformCeilingSeconds
          ? <p role="status">BuildIT has used its own sandbox capacity for the month across all workspaces ({usage.sandbox.platformUsedSeconds.toLocaleString()} of {usage.sandbox.platformCeilingSeconds.toLocaleString()} seconds), so no workspace can run checks until it resets. This is BuildIT&rsquo;s limit, not yours.</p>
          : <p className="muted-copy">BuildIT has used {usage.sandbox.platformUsedSeconds.toLocaleString()} of {usage.sandbox.platformCeilingSeconds.toLocaleString()} shared sandbox seconds this month across all workspaces.</p>}
        {usage.truncated ? <p className="muted-copy" role="status">Activity figures read only the most recent {usage.recordCount.toLocaleString()} ledger records in this period and are partial. The budget uses the separate monthly accounting total.</p> : null}
      </div>
      <aside>
        {connection.organization.role === "owner" ? <BudgetControl key={`${connection.organization.id}-${ceiling}`} organizationId={connection.organization.id} current={ceiling}/> : <p>Only workspace owners can change the monthly limit.</p>}
        <strong>{usage.recordCount.toLocaleString()} ledger records included{usage.truncated ? " · partial activity" : ""}</strong>
        <p>Model charges paid through your own provider key count toward the limit. Zero means no monthly limit.</p>
      </aside>
    </section>
    <section className="empty-band"><div><strong>Model spending limit</strong><p>New model calls require enough available allowance. Pending and uncertain calls reserve allowance until their usage is settled.</p></div><a href="/integrations">Manage provider →</a></section>
  </>;
}

function BudgetControl({ organizationId, current }: { organizationId: string; current: number }) {
  const update = useMutation(updateCapacity), [value, setValue] = useState(String(current)), [message, setMessage] = useState(""), [working, setWorking] = useState(false);
  return <form className="budget-form" onSubmit={event => {
    event.preventDefault();
    const next = Number(value);
    if (!value.trim() || !Number.isFinite(next) || next < 0 || next > 5_000) { setMessage("Enter a monthly limit between 0 and 5,000 USD. Zero means no limit."); return; }
    setWorking(true); setMessage("");
    void update({ organizationId, monthlyBudget: next, requestId: `budget-${crypto.randomUUID()}` })
      .then(() => setMessage("Monthly limit updated."))
      .catch(() => setMessage("The limit was not saved. Check your connection and sign in to GitHub again as the workspace owner."))
      .finally(() => setWorking(false));
  }}>
    <label htmlFor="monthly-budget">Monthly model limit · USD</label>
    <input id="monthly-budget" name="monthlyBudget" type="number" min={0} max={5000} step={1} value={value} onChange={event => setValue(event.target.value)}/>
    <button className="button secondary" type="submit" disabled={working}>{working ? "Saving…" : "Save"}</button>
    <p className="muted-copy" role="status">{message || "Zero means no limit. Saving requires a recent GitHub sign-in."}</p>
  </form>;
}

function useReportingRefresh() {
  const day = () => new Date().toISOString().slice(0, 10);
  const [value, setValue] = useState(day);
  useEffect(() => { const timer = setInterval(() => setValue(day()), 60_000); return () => clearInterval(timer); }, []);
  // Only invalidates a cached query at midnight. The server, not this browser, sets the period.
  return value;
}
function Loading({ noun }: { noun: string }) { return <StatePanel loading title={`Loading live ${noun}…`} detail="Checking the active organization on the server." />; }
function NoLiveData({ noun }: { noun: string }) { return <section className="empty-state compact-empty"><span className="empty-mark">—</span><h2>No sample {noun} are shown</h2><p>Connect a workspace to see tenant-scoped records. BuildIT does not present illustrative activity as customer data.</p></section>; }

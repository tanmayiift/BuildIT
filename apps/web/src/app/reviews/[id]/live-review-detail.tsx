"use client";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { Component, useEffect, useState } from "react";
import { makeFunctionReference } from "convex/server";
import { comparisonRefusal, dismissalReasonLabel, dismissalReasons, dismissalRefusal, eventPresentation, findingCategoryLabel, findingResolutionLabel, findingSeverityLabel, lineRange, nextActionPresentation, pairFindingDetails, suppressionScopeLabel, suppressionScopes, terminalReviewStatuses, pullRequestHref, stagePresentation, statusPresentation, summarizeChecks, technicalLabel as label } from "./review-presentation";
import type { DismissalReason, SuppressionScope } from "./review-presentation";
// Why a stage saw less than everything. Named here rather than reusing the verdict reason map,
// because a gap on the handoff record is a description of what was read - not a reason a verdict
// was withheld, and analysis_budget deliberately does not withhold one.
const coverageGapLabel: Record<string, string> = {
  analysis_budget: "not every changed file fitted the model's context budget; checks and scanners still ran on all of them",
  changed_files: "a changed file could not be read",
  diff_truncated: "the diff was too large to read in full",
  requirements: "a linked requirement source could not be read",
};

// Sub-second stages are common, and "0s" reads as a missing measurement rather than a fast one.
function formatDuration(durationMs: number) {
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)}s`;
  return `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1_000)}s`;
}

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
    fingerprintHmac: string;
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
  stages: Array<{
    id: string;
    stage: string;
    roundNumber?: number;
    provider: string;
    model: string;
    attempt: number;
    outcome: string;
    finishReason: string;
    inputTokens: number;
    outputTokens: number;
    promptVersion: string;
    createdAt: number;
    // Optional because rows written before per-stage timing and cost existed carry neither, and
    // the table says "not recorded" for those rather than showing a zero it did not measure.
    runId?: string;
    durationMs?: number;
    costUsd?: number;
    requestId?: string;
    requestHash: string;
  }>;
  runId: string;
  modelDurationMs: number;
  stagesMissingDuration: number;
  handoffs?: Array<{
    stage: string;
    stateVersion: number;
    durationMs?: number;
    filesSelected?: number;
    filesChanged?: number;
    coverage?: string;
    coverageGap?: string;
    plannedStages?: string[];
    findingsSpecialists?: number;
    skippedStages?: Array<{ stage: string; because: string }>;
    memoryDismissed?: number;
    memoryRecurring?: number;
    memoryReviewsSeen?: number;
    decisions?: Array<{ kind: string; reason: string; detail?: string }>;
  }>;
  spend: { costUsd: number; inputTokens: number; outputTokens: number };
};
type FindingDetail = {
  id: string;
  title: string;
  category: string;
  severity: string;
  confidence: number;
  path: string;
  startLine: number;
  endLine: number;
  impact: string;
  explanation: string;
  resolution: "accepted" | "uncertain";
  blocking: boolean;
};
type RunSummary = {
  id: string; headSha: string; status: string; mode: string; statusReasonCode?: string;
  createdAt: number; completedAt?: number; promptVersion: string; model: string; provider: string;
  stageCount: number; repairedStages: number; inputTokens: number; outputTokens: number;
  costUsd: number; blockingFindings: number; totalFindings: number; isCurrent: boolean;
};
type FindingShape = { severity: string; category: string; blocking: boolean; resolution: string; startLine: number; endLine: number };
type RunComparison = {
  left: { id: string; headSha: string; status: string; costUsd: number; promptVersion: string; model: string };
  right: { id: string; headSha: string; status: string; costUsd: number; promptVersion: string; model: string };
  statusChanged: boolean; costDeltaUsd: number;
  stages: Array<{ stage: string; left: { ran: boolean; attempts: number; tokens: number; repaired: boolean }; right: { ran: boolean; attempts: number; tokens: number; repaired: boolean } }>;
  onlyInLeft: FindingShape[]; onlyInRight: FindingShape[]; inBoth: number;
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
  findingDetailsAction = makeFunctionReference<"action", { reviewId: string }, FindingDetail[]>("reviewEvidenceActions:getFindingDetails"),
  // findingSuppressions has existed since the first schema and nothing in the product ever wrote to
  // it, so a person who read a finding and knew it was wrong had no way to say so and the next
  // review started as cold as this one. This is the only caller.
  dismissFinding = makeFunctionReference<
    "mutation",
    { reviewId: string; fingerprintHmac: string; scope: SuppressionScope; reasonCode: DismissalReason; requestId: string },
    { id: string; scope: string }
  >("findings:dismiss"),
  // Three runs over identical code once gave the correct finding, then nothing, then an unrelated
  // one - and there was no way to see that in the product at all. These make one run comparable to
  // another run of the same pull request.
  runHistoryQuery = makeFunctionReference<"query", { reviewId: string }, RunSummary[]>("reviews:runHistory"),
  compareRunsQuery = makeFunctionReference<"query", { leftReviewId: string; rightReviewId: string }, RunComparison>("reviews:compareRuns"),
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
    loadFindingDetails = useAction(findingDetailsAction),
    [cancelling, setCancelling] = useState(false),
    [cancelError, setCancelError] = useState(""),
    [findingDetails, setFindingDetails] = useState<FindingDetail[] | null>(null),
    [findingDetailError, setFindingDetailError] = useState(false),
    evidence = useQuery(
      evidenceQuery,
      isAuthenticated ? { reviewId: id } : "skip",
    ),
    runs = useQuery(runHistoryQuery, isAuthenticated ? { reviewId: id } : "skip");
  const findingCount = evidence?.findings.length ?? 0;
  useEffect(() => {
    if (!isAuthenticated || findingCount === 0) { setFindingDetails(null); setFindingDetailError(false); return; }
    let active = true;
    setFindingDetailError(false);
    void loadFindingDetails({ reviewId: id }).then(value => { if (active) setFindingDetails(value); }).catch(() => { if (active) { setFindingDetails(null); setFindingDetailError(true); } });
    return () => { active = false; };
  }, [findingCount, id, isAuthenticated, loadFindingDetails]);
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
  const verdict = statusPresentation(review.status, review.isStale, review.statusReasonCode),
    nextAction = nextActionPresentation(review.nextActionCode, review.isStale),
    pullRequestUrl = pullRequestHref(repository.owner, repository.name, review.prNumber),
    checkSummaries = summarizeChecks(evidence.checks),
    // The decrypted prose, joined to the rows it belongs to. The rows are the list: only a row
    // carries the fingerprint findings:dismiss identifies a finding by, and the resolution a
    // dismissal changes, so a findings panel built from the prose alone could show neither.
    findingProse = pairFindingDetails(evidence.findings, findingDetails ?? []),
    hasEvidence = evidence.requirements.length + evidence.findings.length + evidence.checks.length > 0;
  // Left is the older run, so "lost" reads as a defect the earlier run reported and this one did
  // not - the direction a person actually asks the question in. A run with nothing earlier to
  // compare against gets no section at all, rather than a menu with nothing in it.
  const startedAt = runs?.find(run => run.id === id)?.createdAt ?? Infinity,
    earlierRuns = (runs ?? []).filter(run => run.createdAt < startedAt);
  // Mirrors terminalStatuses in convex/lib/lifecycle.ts and packages/contracts/src/review.ts.
  // tests/architecture/review-status-contract.test.ts fails if these drift apart.
  const canCancel = !terminalReviewStatuses.includes(review.status) && review.status !== "cancelling";
  const stoppedBeforeEvidence = !hasEvidence && !canCancel;
  async function cancelReview() {
    setCancelling(true);
    setCancelError("");
    try {
      const result = await cancel({ reviewId: id });
      if (result?.status === "already_finished") setCancelError("This review had already finished, so there was nothing to cancel. Its result below is unchanged.");
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
            <button className="button destructive" type="button" disabled={cancelling} onClick={cancelReview}>
              {cancelling ? "Cancelling…" : "Cancel review"}
            </button>
          ) : null}
          <a className="button secondary" href={`/reviews`}>
            {stoppedBeforeEvidence ? "Open review queue" : "Back to queue"}
          </a>
          {pullRequestUrl ? <a className="button secondary" href={pullRequestUrl} target="_blank" rel="noreferrer">Open pull request</a> : null}
          {cancelError ? <p role="alert">{cancelError}</p> : null}
        </div>
      </section>
      <section className={`commit-strip${stoppedBeforeEvidence ? " minimal" : ""}`} aria-label="Review scope">
        <Fact
          label="Repository"
          value={`${repository.owner}/${repository.name}`}
        />
        <Fact label="Pull request" value={`#${review.prNumber}`} />
        <Fact label="Head commit" value={review.headSha.slice(0, 12)} mono />
        {!stoppedBeforeEvidence ? <Fact label="Mode" value={label(review.mode)} /> : null}
        {!stoppedBeforeEvidence ? <Fact label="Coverage" value={label(review.coverageLevel)} /> : null}
      </section>
      {!stoppedBeforeEvidence ? <div className="next-action">
        <span className="next-mark" aria-hidden="true">→</span>
        <div>
          <small>What to do next</small>
          <strong>{nextAction.title}</strong>
          <p>{nextAction.detail}</p>
          {nextAction.href ? <a className="text-link" href={nextAction.href}>{nextAction.hrefLabel ?? "Open"} →</a> : null}
        </div>
      </div> : null}
      {hasEvidence || canCancel ? <ReviewJourney currentStage={review.currentStage} status={review.status} events={evidence.events} /> : null}
      {hasEvidence || canCancel ? <details className="technical-details"><summary>Technical details</summary><dl><div><dt>Base commit</dt><dd><code>{review.baseSha.slice(0, 12)}</code></dd></div><div><dt>Current step</dt><dd>{stagePresentation(review.currentStage)}</dd></div><div><dt>AI provider</dt><dd>{label(review.provider)} · {review.model}</dd></div><div><dt>Spend</dt><dd>{review.budgetConsumed.toFixed(2)} of {review.budgetLimit.toFixed(2)} limit</dd></div></dl></details> : null}
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
        foot="Finding prose is read from the encrypted report only after BuildIT rechecks your repository membership. Dismissing a finding records your team's judgement for the next review; it never silences one that blocks merge, a Critical finding, or a scanner result."
      >
        {findingDetailError ? (
          <div className="finding-detail-state"><strong>Plain-language details could not be loaded</strong><p>No source was shown. The exact findings are listed below. Open the pull request for the published evidence, or refresh after checking your workspace access.</p></div>
        ) : findingDetails === null ? (
          <div className="finding-detail-state"><strong>Loading the encrypted finding summary…</strong><p>BuildIT is rechecking repository access before decrypting the report. The exact findings are listed below meanwhile.</p></div>
        ) : null}
        {evidence.findings.map(item => (
          <Finding key={item.id} reviewId={id} finding={item} detail={findingProse.get(item.id)} />
        ))}
      </Section> : null}
      {evidence.checks.length ? <Section
        eyebrow="Verification"
        title="Checks run"
        detail={`${checkSummaries.filter((item) => item.required).length} required · ${evidence.checks.length} executions`}
        foot="Repeated executions are grouped here. Every individual run remains in the encrypted audit record."
      >
        {checkSummaries.length ? (
          checkSummaries.map((item) => (
            <div className="validation-row" key={`${item.kind}-${item.required}`}>
              <strong>{label(item.kind)}</strong>
              <span>{item.required ? "Required" : "Optional"}</span>
              <span className={`status ${tone(item.conclusion)}`}>
                {label(item.conclusion)}
              </span>
              <time>{(item.durationMs / 1000).toFixed(1)}s</time>
              <span>
                {item.evidenceAvailable
                  ? `${item.executions} ${item.executions === 1 ? "execution" : "executions"} · encrypted output recorded${item.executions > 1 ? ` · ${item.outcomeSummary}` : ""}`
                  : `${item.executions} ${item.executions === 1 ? "execution" : "executions"} · output incomplete${item.executions > 1 ? ` · ${item.outcomeSummary}` : ""}`}
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
      {evidence.stages.length ? (
        <Section
          eyebrow={`Run trace · ${evidence.runId}`}
          title="What each stage did, cost, and how long it took"
          detail={`$${evidence.spend.costUsd.toFixed(4)} · ${(evidence.spend.inputTokens + evidence.spend.outputTokens).toLocaleString()} tokens · ${formatDuration(evidence.modelDurationMs)} of measured model time`}
          foot={`${evidence.stagesMissingDuration ? `${evidence.stagesMissingDuration} of ${evidence.stages.length} stages predate duration recording and show no time. ` : ""}Measured model time is the sum of the provider calls, not wall clock: the review record re-stamps its start on every retry, so no honest end-to-end figure exists for it. No prompt or repository source is stored here.`}
        >
          <div className="stage-table-scroll" tabIndex={0} role="region" aria-label="Stage details, scrolls horizontally">
            <table className="stage-table">
              <thead>
                <tr>
                  <th scope="col">Stage</th>
                  <th scope="col">Model</th>
                  <th scope="col">Attempt</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">In</th>
                  <th scope="col">Out</th>
                  <th scope="col">Time</th>
                  <th scope="col">Cost</th>
                  <th scope="col">Provider call</th>
                </tr>
              </thead>
              <tbody>
                {evidence.stages.map((item) => (
                  <tr key={item.id} data-outcome={item.outcome}>
                    <th scope="row">
                      {stagePresentation(item.stage)}
                      {item.roundNumber ? <span className="stage-round"> · round {item.roundNumber}</span> : null}
                    </th>
                    <td className="stage-model">{item.provider} / {item.model}</td>
                    <td className="stage-figure">{item.attempt}</td>
                    <td>
                      <span className="stage-outcome" data-outcome={item.outcome}>
                        {item.outcome === "valid" ? "Valid" : "Schema repaired"}
                      </span>
                    </td>
                    <td className="stage-figure">{item.inputTokens.toLocaleString()}</td>
                    <td className="stage-figure">{item.outputTokens.toLocaleString()}</td>
                    <td className="stage-figure">{item.durationMs === undefined ? <span className="muted-copy">not recorded</span> : formatDuration(item.durationMs)}</td>
                    <td className="stage-figure">{item.costUsd === undefined ? <span className="muted-copy">&mdash;</span> : `$${item.costUsd.toFixed(4)}`}</td>
                    {/* The provider's own id for the call, so a cost or latency claim here can be
                        checked against the provider's record rather than taken on trust. Falls back
                        to the request hash, which at least identifies the exact prompt sent. */}
                    <td className="stage-request"><code>{item.requestId ?? item.requestHash}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}
      {(evidence.handoffs ?? []).length ? (
        <Section
          eyebrow="Handoffs and memory"
          title="What each stage was given, and what it carried forward"
          detail={`${(evidence.handoffs ?? []).length} recorded ${(evidence.handoffs ?? []).length === 1 ? "stage" : "stages"}`}
          foot="Counts, decisions and artifact references only. No repository content or model text is stored in the handoff record, because it is read back into the neighbourhood of a prompt."
        >
          <ul className="handoff-list">
            {(evidence.handoffs ?? []).map(item => (
              <li key={`${item.stage}-${item.stateVersion}`} className="handoff-row">
                <div className="handoff-head">
                  <strong>{stagePresentation(item.stage)}</strong>
                  {item.stateVersion > 1 ? <span className="stage-round"> · attempt {item.stateVersion}</span> : null}
                  {item.durationMs === undefined ? null : <span className="handoff-time">{formatDuration(item.durationMs)}</span>}
                </div>
                <dl className="handoff-facts">
                  {item.filesSelected === undefined ? null : (
                    <><dt>Files read</dt><dd>{item.filesSelected.toLocaleString()}{item.filesChanged === undefined ? "" : ` of which ${item.filesChanged.toLocaleString()} changed`}</dd></>
                  )}
                  {item.coverage === undefined ? null : (
                    <><dt>Coverage</dt><dd>{item.coverage === "full" ? "Complete" : `Partial${item.coverageGap ? ` — ${coverageGapLabel[item.coverageGap] ?? item.coverageGap}` : ""}`}</dd></>
                  )}
                  {item.plannedStages === undefined ? null : (
                    <><dt>Stages planned</dt><dd>{item.plannedStages.map(stagePresentation).join(" → ")}{item.findingsSpecialists && item.findingsSpecialists > 1 ? ` · ${item.findingsSpecialists} findings specialists` : ""}</dd></>
                  )}
                  {item.skippedStages?.length ? (
                    <><dt>Stages skipped</dt><dd>{item.skippedStages.map(skip => `${stagePresentation(skip.stage)} — ${skip.because}`).join("; ")}</dd></>
                  ) : null}
                  {item.memoryReviewsSeen === undefined ? null : (
                    <><dt>Memory applied</dt><dd>{item.memoryDismissed ?? 0} dismissed and {item.memoryRecurring ?? 0} recurring findings from {item.memoryReviewsSeen} earlier {item.memoryReviewsSeen === 1 ? "review" : "reviews"} of this repository</dd></>
                  )}
                  {item.decisions?.length ? (
                    <><dt>Decisions</dt><dd>{item.decisions.map(decision => `${decision.kind}: ${decision.reason}`).join("; ")}</dd></>
                  ) : null}
                </dl>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {earlierRuns.length ? (
        <RunDiff reviewId={id} prNumber={review.prNumber} runCount={(runs ?? []).length} earlierRuns={earlierRuns} />
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
}: {
  eyebrow: string;
  title: string;
  detail: string;
  children: React.ReactNode;
  foot: string;
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
      <div>
        {children}
      </div>
      <footer className="evidence-foot">
        {foot}
      </footer>
    </section>
  );
}
function Finding({ reviewId, finding, detail }: { reviewId: string; finding: Evidence["findings"][number]; detail?: FindingDetail | undefined }) {
  const title = detail?.title ?? `${findingCategoryLabel(finding.category)} · ${lineRange(finding.startLine, finding.endLine)}`,
    where = detail
      ? `${detail.path} · ${lineRange(finding.startLine, finding.endLine)}`
      : `path ${finding.pathFingerprint} · ${lineRange(finding.startLine, finding.endLine)}`;
  return (
    <article className="finding-summary" aria-label={`Finding: ${title}`}>
      <div className="finding-summary-head">
        <span className={`status ${tone(finding.severity)}`}>{findingSeverityLabel(finding.severity)}</span>
        <div>
          <h3>{title}</h3>
          <code>{where}{finding.ruleId ? ` · ${finding.ruleId}` : ""} · {finding.evidenceCount} proof</code>
        </div>
        <span className={`finding-resolution ${finding.blocking ? "blocking" : ""}`}>{finding.blocking ? "Blocks merge" : findingResolutionLabel(finding.resolution)}</span>
      </div>
      {detail ? <div className="finding-summary-body"><div><small>Why it matters</small><p>{detail.impact}</p></div><div><small>What to inspect and correct</small><p>{detail.explanation}</p></div></div> : null}
      <FindingDismissal reviewId={reviewId} finding={finding} />
    </article>
  );
}
// The correction a reader could never make. What it may claim is bounded by what
// packages/orchestrator/src/learning.ts will do, and that function is demote-only: it refuses to
// quieten a finding that blocks merge, a Critical one, or anything a scanner produced, whatever a
// team dismisses. So this says what dismissal records, and says out loud where it will change
// nothing - a control that overpromised here would be worse than the missing control was.
function FindingDismissal({ reviewId, finding }: { reviewId: string; finding: Evidence["findings"][number] }) {
  const dismiss = useMutation(dismissFinding),
    [scope, setScope] = useState<SuppressionScope>("pull_request"),
    [reasonCode, setReasonCode] = useState<DismissalReason>("not_a_defect"),
    [working, setWorking] = useState(false),
    [refusal, setRefusal] = useState(""),
    [recorded, setRecorded] = useState(false);
  // A scanner result is the one BuildIT stores a ruleId for; the model never gets one.
  const neverSilenced = finding.blocking || finding.severity === "critical" || Boolean(finding.ruleId),
    keepsAppearing = " It is still reported after this: BuildIT never silences a finding that blocks merge, a Critical finding, or a scanner result.";
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setWorking(true);
    setRefusal("");
    try {
      await dismiss({ reviewId, fingerprintHmac: finding.fingerprintHmac, scope, reasonCode, requestId: crypto.randomUUID() });
      setRecorded(true);
    } catch (error) {
      setRefusal(dismissalRefusal(error));
    } finally {
      setWorking(false);
    }
  }
  if (recorded || finding.resolution === "dismissed")
    return <p className="finding-dismissed" role="status">Dismissed by your team. The next review of this repository is told a person judged this finding wrong.{neverSilenced ? keepsAppearing : ""}</p>;
  return (
    <details className="finding-dismiss">
      <summary>This finding is wrong</summary>
      <form onSubmit={submit}>
        <label className="field" htmlFor={`dismiss-scope-${finding.id}`}>
          <span>How far this applies</span>
          <select id={`dismiss-scope-${finding.id}`} value={scope} disabled={working} onChange={event => setScope(event.target.value as SuppressionScope)}>
            {suppressionScopes.map(value => <option key={value} value={value}>{suppressionScopeLabel(value)}</option>)}
          </select>
        </label>
        <label className="field" htmlFor={`dismiss-reason-${finding.id}`}>
          <span>Why it is wrong</span>
          <select id={`dismiss-reason-${finding.id}`} value={reasonCode} disabled={working} onChange={event => setReasonCode(event.target.value as DismissalReason)}>
            {dismissalReasons.map(value => <option key={value} value={value}>{dismissalReasonLabel(value)}</option>)}
          </select>
        </label>
        <button className="button secondary" type="submit" disabled={working}>{working ? "Recording…" : "Dismiss this finding"}</button>
        <p className="form-note">Your decision and its scope are recorded, and this finding's fingerprint joins what the next review of this repository is told. Nothing here changes the pull request, the checks that ran, or the merge decision.{neverSilenced ? keepsAppearing : ""}</p>
        {refusal ? <p className="form-result error" role="alert">{refusal}</p> : null}
      </form>
    </details>
  );
}
// BuildIT reviews the same pull request again after every push. Three runs over identical code
// once gave the correct finding, then nothing, then an unrelated one, and the product had no way
// to show that. This is the only screen where one run can be read against another.
function RunDiff({ reviewId, prNumber, runCount, earlierRuns }: { reviewId: string; prNumber: number; runCount: number; earlierRuns: RunSummary[] }) {
  const [comparedTo, setComparedTo] = useState("");
  return (
    <Section
      eyebrow="Run diff"
      title="Compare this run with another"
      detail={`${runCount} runs of pull request #${prNumber}`}
      foot="Findings are matched on their fingerprint, so the same defect is a fact rather than two titles that read alike."
    >
      <label className="run-select">
        <span>Compare against</span>
        <select value={comparedTo} onChange={event => setComparedTo(event.target.value)}>
          <option value="">Select an earlier run…</option>
          {earlierRuns.map(run => (
            <option key={run.id} value={run.id}>
              {new Date(run.createdAt).toLocaleString()} · {run.headSha.slice(0, 7)} · {statusPresentation(run.status, false, run.statusReasonCode).label} · ${run.costUsd.toFixed(4)}
            </option>
          ))}
        </select>
      </label>
      <div aria-live="polite">
        {comparedTo ? (
          // Keyed on the selection so a refusal on one pair does not outlive the choice that caused it.
          <ComparisonBoundary key={comparedTo}>
            <Comparison leftReviewId={comparedTo} rightReviewId={reviewId} />
          </ComparisonBoundary>
        ) : null}
      </div>
    </Section>
  );
}
function Comparison({ leftReviewId, rightReviewId }: { leftReviewId: string; rightReviewId: string }) {
  const comparison = useQuery(compareRunsQuery, { leftReviewId, rightReviewId });
  if (!comparison) return <p className="run-diff-empty">Loading the comparison…</p>;
  const { left, right } = comparison,
    change = (earlier: string, later: string) => (earlier === later ? later : `${earlier} → ${later}`);
  return (
    <>
      <dl className="run-diff-summary">
        <div><dt>Verdict</dt><dd>{comparison.statusChanged ? `${statusPresentation(left.status, false).label} → ${statusPresentation(right.status, false).label}` : "Unchanged"}</dd></div>
        {/* Two runs of one pull request often pin the same commit: that is the case where a
            difference below is the reviewer changing its mind, not the code changing. */}
        <div><dt>Commit</dt><dd>{change(left.headSha.slice(0, 7), right.headSha.slice(0, 7))}</dd></div>
        <div><dt>Cost</dt><dd>{comparison.costDeltaUsd >= 0 ? "+" : "−"}${Math.abs(comparison.costDeltaUsd).toFixed(4)}</dd></div>
        <div><dt>Prompt</dt><dd>{change(left.promptVersion, right.promptVersion)}</dd></div>
        <div><dt>Model</dt><dd>{change(left.model, right.model)}</dd></div>
      </dl>
      <div className="run-diff-findings">
        {/* Lost is the column that matters: a defect the earlier run reported and this one
            did not is either fixed in the diff or a regression in the reviewer. */}
        <div data-side="lost">
          <h3>Lost · {comparison.onlyInLeft.length}</h3>
          <p>Reported by the earlier run only.</p>
          <FindingList findings={comparison.onlyInLeft} side="lost" />
        </div>
        <div data-side="kept"><h3>In both · {comparison.inBoth}</h3><p>Reported by each run.</p></div>
        <div data-side="new">
          <h3>New · {comparison.onlyInRight.length}</h3>
          <p>Reported by this run only.</p>
          <FindingList findings={comparison.onlyInRight} side="new" />
        </div>
      </div>
      <div className="stage-table-scroll" tabIndex={0} role="region" aria-label="Stage comparison, scrolls horizontally">
        <table className="stage-table">
          <thead><tr><th scope="col">Stage</th><th scope="col">Earlier</th><th scope="col">This run</th></tr></thead>
          <tbody>
            {comparison.stages.map(row => (
              <tr key={row.stage}>
                <th scope="row">{stagePresentation(row.stage)}</th>
                {[row.left, row.right].map((side, index) => (
                  <td key={index} className="stage-figure">
                    {side.ran ? `${side.tokens.toLocaleString()} tokens · ${side.attempts} call${side.attempts === 1 ? "" : "s"}${side.repaired ? " · repaired" : ""}` : "Not run"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
function FindingList({ findings, side }: { findings: FindingShape[]; side: string }) {
  if (!findings.length) return null;
  return (
    <ul>
      {findings.map((finding, index) => (
        <li key={`${side}-${index}`}>
          <span data-tone={tone(finding.severity)}>{findingSeverityLabel(finding.severity)}</span>{" "}
          {findingCategoryLabel(finding.category)} · {lineRange(finding.startLine, finding.endLine)}
          {finding.blocking ? " · blocks merge" : ""}
          {finding.resolution === "open" ? "" : ` · ${findingResolutionLabel(finding.resolution)}`}
        </li>
      ))}
    </ul>
  );
}
// A refused comparison arrives as an error thrown out of useQuery during render, which would
// otherwise take the whole review page down with it. It is one sentence in this section instead,
// and the code the server threw never reaches a person.
class ComparisonBoundary extends Component<{ children: React.ReactNode }, { message: string }> {
  state: { message: string } = { message: "" };
  static getDerivedStateFromError(error: unknown) {
    return { message: comparisonRefusal(error) };
  }
  render() {
    return this.state.message ? <p className="run-diff-empty">{this.state.message}</p> : this.props.children;
  }
}
function ReviewJourney({ currentStage, status, events }: { currentStage: string; status: string; events: Evidence["events"] }) {
  const steps = [
    { key: "context", label: "Understand", detail: "Read the PR and requirements" },
    { key: "validation", label: "Verify", detail: "Run required safety checks" },
    { key: "analysis", label: "Inspect", detail: "Review code against the evidence" },
    { key: "delivery", label: "Hand back", detail: "Show evidence or a tested fix" },
  ];
  const completed = new Set(events.filter((event) => event.type === "stage_completed").map((event) => event.stage));
  const successful = ["passed", "checks_passed", "changes_requested", "inconclusive", "delivered", "failed_after_bounds"].includes(status);
  const stopped = ["cancelled", "platform_failed", "budget_exhausted"].includes(status);
  const activeKey = steps.find((step) => !completed.has(step.key))?.key;
  return <section className="review-journey" aria-labelledby="review-journey-title"><div><p className="eyebrow">Review journey</p><h2 id="review-journey-title">What BuildIT completed</h2></div><ol>{steps.map((step, index) => {
    const complete = successful || completed.has(step.key);
    const failed = stopped && !complete && activeKey === step.key;
    const active = !stopped && !successful && currentStage === step.key;
    return <li key={step.key} data-state={complete ? "complete" : failed ? "failed" : active ? "active" : "waiting"}><span aria-hidden="true">{complete ? "✓" : failed ? "!" : index + 1}</span><div><strong>{failed ? `${step.label} stopped` : step.label}</strong><small>{failed ? "No decision was made after this point." : step.detail}</small></div></li>;
  })}</ol></section>;
}

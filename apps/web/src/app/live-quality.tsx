"use client";
import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { NoActiveWorkspace } from "./no-active-workspace";
import { useSampleTour } from "./workspace-route-boundary";

// The evaluation loop recorded every missed verdict and every dismissed finding into a queue with
// no reader. `pendingCandidates` and `markCurated` were written, tested, and called by nothing
// outside those tests, so the corpus that is supposed to grow from production never grew - the
// rows just accumulated. This is the screen that was missing.

type Connection = { organization: null | { id: string; name: string; role?: string } };
type Candidate = { id: string; kind: "missed" | "false_positive"; reasonCode: string; promptVersion: string; model: string; createdAt: number };
type Pending = { candidates: Candidate[]; truncated: boolean };

const connectionQuery = makeFunctionReference<"query", Record<string, never>, Connection>("repositoryConnections:current");
const pendingQuery = makeFunctionReference<"query", { organizationId: string }, Pending>("evalLoop:listPendingCandidates");
const curate = makeFunctionReference<"mutation", { organizationId: string; candidateId: string }, { id: string }>("evalLoop:curateCandidate");

// What each kind is evidence of, in the reader's terms rather than the schema's.
const describe = (kind: Candidate["kind"]) => kind === "missed"
  ? "A review that reached no verdict. The corpus is missing whatever made it undecidable."
  : "A finding a person read and dismissed. The corpus is missing the reason it was wrong.";

export function WorkspaceQuality() {
  const tour = useSampleTour(), { isAuthenticated } = useConvexAuth();
  const connection = useQuery(connectionQuery, !tour && isAuthenticated ? {} : "skip");
  const organizationId = connection?.organization?.id;
  const role = connection?.organization?.role, canCurate = role === "owner" || role === "admin";
  const pending = useQuery(pendingQuery, !tour && canCurate && organizationId ? { organizationId } : "skip");
  const markCurated = useMutation(curate);
  const [working, setWorking] = useState(""), [message, setMessage] = useState("");

  if (tour) return <section className="empty-state compact-empty"><span className="empty-mark">—</span><h2>No sample evaluation queue</h2><p>Candidates are recorded from real reviews in a connected workspace. Illustrative rows are not presented as evidence.</p></section>;
  if (connection && !connection.organization) return <NoActiveWorkspace heading="No workspace is active yet" detail="Evaluation candidates are recorded per workspace, so there is nothing to curate until one is active." />;
  // A role that may not read the queue is told where it lives rather than shown an empty screen,
  // which would read as "nothing to curate" instead of "not yours to curate".
  if (connection?.organization && !canCurate) return <section className="settings-list" aria-label="Evaluation queue">
    <article className="setting-row"><div><strong>Evaluation queue</strong><p>Only an owner or admin can review which reviews and dismissed findings are waiting to enter the evaluation set. Ask one of them if something should be curated.</p></div><span className="status neutral">Owner or admin manages this</span></article>
  </section>;
  if (!organizationId || pending === undefined) return <section className="live-state" aria-live="polite"><span className="state-pulse"/><div><strong>Loading the evaluation queue…</strong><p>Checking the active organization for uncurated candidates.</p></div></section>;
  if (!pending.candidates.length) return <section className="empty-state compact-empty"><span className="empty-mark">0</span><h2>Nothing waiting to be curated</h2><p>A review that reaches no verdict, and a finding someone dismisses, both land here for a human to fold into the evaluation set.</p></section>;

  return <>
    {pending.truncated ? <div className="boundary-note"><strong>Showing the oldest 100 candidates</strong><br/>More are waiting than this page lists. The count below is what is displayed, not the size of the queue.</div> : null}
    {message ? <div className="boundary-note"><strong>{message}</strong></div> : null}
    <section className="settings-list" aria-label="Evaluation queue">
      <article className="setting-row">
        <div><strong>Waiting to be curated</strong><p>Each row is a run worth learning from. Curating one marks it as folded into the evaluation set; it records no repository content, only codes and versions.</p></div>
        <span className="status warning">{pending.candidates.length} pending</span>
      </article>
      {pending.candidates.map(candidate => <article className="setting-row" key={candidate.id}>
        <div>
          <strong>{candidate.kind === "missed" ? "No verdict reached" : "Finding dismissed"} · {candidate.reasonCode}</strong>
          <p>{describe(candidate.kind)} Recorded {new Date(candidate.createdAt).toLocaleDateString()} against {candidate.model} on prompt {candidate.promptVersion}.</p>
        </div>
        <button className="button" type="button" disabled={working === candidate.id} onClick={() => {
          setWorking(candidate.id); setMessage("");
          void markCurated({ organizationId, candidateId: candidate.id })
            .then(() => setMessage("Candidate marked as curated into the evaluation set."))
            .catch(() => setMessage("That candidate could not be curated. It may already have been, or your session may have expired."))
            .finally(() => setWorking(""));
        }}>{working === candidate.id ? "Curating…" : "Mark curated"}</button>
      </article>)}
    </section>
  </>;
}

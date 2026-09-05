"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { makeFunctionReference } from "convex/server";

type Viewer = { id: string; name: string | null; email: string | null; image: string | null } | null;
const viewerQuery = makeFunctionReference<"query", Record<string, never>, Viewer>("users:viewer");
type Session = { id: string; current: boolean; expiresAt: number };
const sessionsQuery = makeFunctionReference<"query", Record<string, never>, Session[]>("users:sessions");
const revokeOtherSessions = makeFunctionReference<"action", Record<string, never>, { currentSessionId: string }>("users:revokeOtherSessions");
// An invitation used to arrive nowhere. organizations:listMine only returns active memberships, so
// an invited person signed in and found no trace of it, and memberships:accept - which existed the
// whole time - had no caller in the product. This is the screen that turns "invited" into "active".
type Invitation = { organizationId: string; name: string; slug: string; role: string; invitedAt: number };
const invitationsQuery = makeFunctionReference<"query", Record<string, never>, Invitation[]>("memberships:listInvitations");
const acceptInvitation = makeFunctionReference<"mutation", { organizationId: string; requestId: string }, string>("memberships:accept");

export default function AccountPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const viewer = useQuery(viewerQuery, isAuthenticated ? {} : "skip");
  const sessions = useQuery(sessionsQuery, isAuthenticated ? {} : "skip");
  const revokeOthers = useAction(revokeOtherSessions);
  const invitations = useQuery(invitationsQuery, isAuthenticated ? {} : "skip");
  const accept = useMutation(acceptInvitation);
  const [sessionMessage, setSessionMessage] = useState("");
  const [invitationMessage, setInvitationMessage] = useState("");
  const [accepting, setAccepting] = useState("");
  if (isLoading) return <div className="content"><p aria-live="polite">Checking account…</p></div>;
  if (!isAuthenticated) return <div className="content auth-card"><h1 className="title">Sign in required</h1><p>Your account details are available only after GitHub sign-in.</p><a className="button" href="/sign-in">Sign in</a></div>;
  if (!viewer) return <div className="content"><p aria-live="polite">Loading account…</p></div>;
  return <div className="content trust-page">
    <p className="eyebrow">Account</p><h1 className="title">Your GitHub identity</h1>
    <dl className="trust-list"><div><dt>Name</dt><dd>{viewer.name || "Not provided by GitHub"}</dd></div><div><dt>Email</dt><dd>{viewer.email || "Not provided by GitHub"}</dd></div><div><dt>Repository access</dt><dd>Managed separately through the BuildIT GitHub App. Signing in alone grants no repository access.</dd></div></dl>
    <section className="session-panel"><div><p className="eyebrow">Sessions</p><h2>Signed-in devices</h2><p>BuildIT stores no browser history or device fingerprint. Sessions are shown by expiry only.</p></div><div className="session-list">{sessions?.map(session => <div key={session.id}><span><strong>{session.current ? "This browser" : "Another signed-in browser"}</strong><small>Expires {new Date(session.expiresAt).toLocaleString()}</small></span><span className={`status ${session.current ? "success" : "neutral"}`}>{session.current ? "Current" : "Active"}</span></div>) ?? <p aria-live="polite">Loading sessions…</p>}</div><button className="button secondary" type="button" disabled={!sessions || sessions.length < 2} onClick={async () => { try { await revokeOthers({}); setSessionMessage("Other sessions were signed out."); } catch { setSessionMessage("Other sessions could not be revoked. Please try again."); } }}>Sign out other sessions</button>{sessionMessage ? <p role="status">{sessionMessage}</p> : null}</section>
    {invitations && invitations.length ? <section className="session-panel">
      <div><p className="eyebrow">Invitations</p><h2>You have been invited to a workspace</h2><p>Accepting adds your GitHub identity to that workspace at the role the admin chose. Nothing is shared with it until you accept.</p></div>
      <ul className="session-list">{invitations.map(invitation => <li key={invitation.organizationId}>
        <div><strong>{invitation.name}</strong><span className="muted"> · invited as {invitation.role}</span></div>
        <button className="button" type="button" disabled={accepting === invitation.organizationId} onClick={() => {
          setAccepting(invitation.organizationId); setInvitationMessage("");
          void accept({ organizationId: invitation.organizationId, requestId: `accept-${invitation.organizationId}-${Date.now()}` })
            .then(() => setInvitationMessage(`You joined ${invitation.name}.`))
            .catch(() => setInvitationMessage("That invitation is no longer available. Ask the admin to send it again."))
            .finally(() => setAccepting(""));
        }}>{accepting === invitation.organizationId ? "Joining…" : "Accept"}</button>
      </li>)}</ul>
      {invitationMessage ? <p aria-live="polite">{invitationMessage}</p> : null}
    </section> : null}
    <div className="actions"><button className="button secondary" type="button" onClick={() => void signOut()}>Sign out this browser</button><a className="button" href="/setup/install">Continue setup</a></div>
  </div>;
}

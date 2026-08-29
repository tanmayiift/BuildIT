"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { useState } from "react";
import { makeFunctionReference } from "convex/server";

type Viewer = { id: string; name: string | null; email: string | null; image: string | null } | null;
const viewerQuery = makeFunctionReference<"query", Record<string, never>, Viewer>("users:viewer");
type Session = { id: string; current: boolean; expiresAt: number };
const sessionsQuery = makeFunctionReference<"query", Record<string, never>, Session[]>("users:sessions");
const revokeOtherSessions = makeFunctionReference<"action", Record<string, never>, { currentSessionId: string }>("users:revokeOtherSessions");

export default function AccountPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const viewer = useQuery(viewerQuery, isAuthenticated ? {} : "skip");
  const sessions = useQuery(sessionsQuery, isAuthenticated ? {} : "skip");
  const revokeOthers = useAction(revokeOtherSessions);
  const [sessionMessage, setSessionMessage] = useState("");
  if (isLoading) return <div className="content"><p aria-live="polite">Checking account…</p></div>;
  if (!isAuthenticated) return <div className="content auth-card"><h1 className="title">Sign in required</h1><p>Your account details are available only after GitHub sign-in.</p><a className="button" href="/sign-in">Sign in</a></div>;
  if (!viewer) return <div className="content"><p aria-live="polite">Loading account…</p></div>;
  return <div className="content trust-page">
    <p className="eyebrow">Account</p><h1 className="title">Your GitHub identity</h1>
    <dl className="trust-list"><div><dt>Name</dt><dd>{viewer.name || "Not provided by GitHub"}</dd></div><div><dt>Email</dt><dd>{viewer.email || "Not provided by GitHub"}</dd></div><div><dt>Repository access</dt><dd>Managed separately through the BuildIT GitHub App. Signing in alone grants no repository access.</dd></div></dl>
    <section className="session-panel"><div><p className="eyebrow">Sessions</p><h2>Signed-in devices</h2><p>BuildIT stores no browser history or device fingerprint. Sessions are shown by expiry only.</p></div><div className="session-list">{sessions?.map(session => <div key={session.id}><span><strong>{session.current ? "This browser" : "Another signed-in browser"}</strong><small>Expires {new Date(session.expiresAt).toLocaleString()}</small></span><span className={`status ${session.current ? "success" : "neutral"}`}>{session.current ? "Current" : "Active"}</span></div>) ?? <p aria-live="polite">Loading sessions…</p>}</div><button className="button secondary" type="button" disabled={!sessions || sessions.length < 2} onClick={async () => { try { await revokeOthers({}); setSessionMessage("Other sessions were signed out."); } catch { setSessionMessage("Other sessions could not be revoked. Please try again."); } }}>Sign out other sessions</button>{sessionMessage ? <p role="status">{sessionMessage}</p> : null}</section>
    <div className="actions"><button className="button secondary" type="button" onClick={() => void signOut()}>Sign out this browser</button><a className="button" href="/setup/install">Continue setup</a></div>
  </div>;
}

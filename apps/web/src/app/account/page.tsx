"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";

type Viewer = { id: string; name: string | null; email: string | null; image: string | null } | null;
const viewerQuery = makeFunctionReference<"query", Record<string, never>, Viewer>("users:viewer");

export default function AccountPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const viewer = useQuery(viewerQuery, isAuthenticated ? {} : "skip");
  if (isLoading) return <div className="content"><p aria-live="polite">Checking account…</p></div>;
  if (!isAuthenticated) return <div className="content auth-card"><h1 className="title">Sign in required</h1><p>Your account details are available only after GitHub sign-in.</p><a className="button" href="/sign-in">Sign in</a></div>;
  if (!viewer) return <div className="content"><p aria-live="polite">Loading account…</p></div>;
  return <div className="content trust-page">
    <p className="eyebrow">Account</p><h1 className="title">Your GitHub identity</h1>
    <dl className="trust-list"><div><dt>Name</dt><dd>{viewer.name || "Not provided by GitHub"}</dd></div><div><dt>Email</dt><dd>{viewer.email || "Not provided by GitHub"}</dd></div><div><dt>Repository access</dt><dd>Managed separately through the BuildIT GitHub App. Signing in alone grants no repository access.</dd></div></dl>
    <div className="actions"><button className="button secondary" type="button" onClick={() => void signOut()}>Sign out</button><a className="button" href="/setup/install">Continue setup</a></div>
  </div>;
}

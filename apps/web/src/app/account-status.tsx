"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";

type Viewer = { id: string; name: string | null; email: string | null; image: string | null } | null;
type Organization = { id: string; name: string; slug: string; timezone: string; region: "eu-west-1" };

const viewerQuery = makeFunctionReference<"query", Record<string, never>, Viewer>("users:viewer");
const organizationsQuery = makeFunctionReference<"query", Record<string, never>, Organization[]>("organizations:listMine");

export function AccountStatus({ compact = false }: { compact?: boolean }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const viewer = useQuery(viewerQuery, isAuthenticated ? {} : "skip");
  const organizations = useQuery(organizationsQuery, isAuthenticated ? {} : "skip");

  if (isLoading) return <span className="muted" aria-live="polite">Checking account…</span>;
  if (!isAuthenticated) return compact
    ? <a className="button compact" href="/sign-in">Sign in</a>
    : <><span className="preview-dot" aria-hidden="true" />Not signed in<br/><a className="account-link" href="/sign-in">Sign in with GitHub</a></>;
  if (!viewer) return <span className="muted" aria-live="polite">Loading account…</span>;

  const label = viewer.name || viewer.email || "GitHub user";
  const organization = organizations?.[0];
  if (compact) return <a className="button compact secondary" href="/account" aria-label={`Account: ${label}`}>Account</a>;
  return <>
    <strong>{label}</strong><br/>
    <span className="muted">{organization ? organization.name : "Setup required"}</span><br/>
    <span className="account-actions"><a className="account-link" href="/account">Manage account</a><button className="link-button" type="button" onClick={() => void signOut()}>Sign out</button></span>
  </>;
}

"use client";

import { useConvexAuth } from "convex/react";
import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";

const SampleTourContext = createContext(false);

export function useSampleTour() {
  return useContext(SampleTourContext);
}

function requiresWorkspace(pathname: string) {
  return pathname === "/account" || pathname === "/reviews" || pathname.startsWith("/reviews/") || [
    "/repositories", "/metrics", "/usage", "/integrations", "/policies", "/members", "/audit",
  ].includes(pathname);
}

export function WorkspaceRouteBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const sampleTour = searchParams.get("tour") === "1";

  if (!requiresWorkspace(pathname)) return <SampleTourContext.Provider value={false}>{children}</SampleTourContext.Provider>;
  if (sampleTour) return <SampleTourContext.Provider value>
    <p className="sample-route-note">Sample tour · no live workspace data</p>
    {children}
  </SampleTourContext.Provider>;
  if (isLoading) return <section className="content route-gate" aria-live="polite"><span className="state-pulse" /><h1>Checking your session…</h1><p>BuildIT is confirming access before requesting workspace data.</p></section>;
  if (isAuthenticated) return <SampleTourContext.Provider value={false}>{children}</SampleTourContext.Provider>;

  const returnTo = encodeURIComponent(pathname);
  return <section className="content route-gate"><span className="empty-mark">ID</span><h1>Sign in to open your workspace</h1><p>Reviews, repositories, usage, and organization settings are private. BuildIT will not request live workspace data before authentication.</p><div className="button-row"><a className="button" href={`/sign-in?returnTo=${returnTo}`}>Sign in with GitHub</a><a className="button secondary" href={`${pathname}?tour=1`}>View the sample tour</a></div></section>;
}

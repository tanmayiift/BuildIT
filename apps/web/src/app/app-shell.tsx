"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { AccountStatus } from "./account-status";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { ConnectionBanner, SetupProgress } from "./live-connections";
import { WorkspaceRouteBoundary } from "./workspace-route-boundary";
import { BrandGlyph } from "./brand-glyph";
import { isPublicRoute } from "./public-routes";
import { PublicShell } from "./public-shell";

const work = [
  { label: "Overview", href: "/", mark: "OV" },
  { label: "Review queue", href: "/reviews", mark: "RQ" },
  { label: "Repositories", href: "/repositories", mark: "RE" },
  { label: "Metrics", href: "/metrics", mark: "ME" },
];
const operations = [
  { label: "Usage", href: "/usage", mark: "US" },
  { label: "Integrations", href: "/integrations", mark: "IN" },
];
const settings = [
  { label: "Policies", href: "/policies" },
  { label: "Members", href: "/members" },
  { label: "Notifications", href: "/notifications" },
  { label: "Audit log", href: "/audit" },
];

function NavLink({ item, current, sampleTour }: { item: { label: string; href: string; mark?: string }; current: boolean; sampleTour: boolean }) {
  const href = sampleTour ? `${item.href}?tour=1` : item.href;
  return <a className="nav-link" data-current={current || undefined} href={href} aria-current={current ? "page" : undefined}>
    {item.mark ? <span className="nav-mark" aria-hidden="true">{item.mark}</span> : null}<span>{item.label}</span>
  </a>;
}

function isCurrent(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const sampleTour = useSearchParams().get("tour") === "1";
  // A marketing route gets marketing chrome whoever is reading it. Keying this on the route rather
  // than on auth state also means the server and the client agree on the first paint, so there is
  // no flash of the wrong shell while the session resolves.
  if (isPublicRoute(pathname)) return <PublicShell>{children}</PublicShell>;
  return <>
    <ConnectionBanner />
    <div className="shell">
      <aside className="side">
        <div className="brand-row"><span className="brand-glyph" aria-hidden="true"><BrandGlyph /></span><a className="brand" href="/">BuildIT<span>Evidence room</span></a></div>
        <WorkspaceSwitcher />
        <nav aria-label="Primary"><p className="nav-heading">Workspace</p>{work.map(item => <NavLink key={item.href} item={item} current={isCurrent(pathname, item.href)} sampleTour={sampleTour} />)}<p className="nav-heading">Operations</p>{operations.map(item => <NavLink key={item.href} item={item} current={isCurrent(pathname, item.href)} sampleTour={sampleTour} />)}</nav>
        <nav className="settings-nav" aria-label="Organization settings">{settings.map(item => <NavLink key={item.href} item={item} current={isCurrent(pathname, item.href)} sampleTour={sampleTour} />)}</nav>
        <div className="account"><AccountStatus /></div>
      </aside>
      <main className="main" id="main" tabIndex={-1}>
        <header className="top"><div><p className="top-kicker">Workspace</p><strong>{pathname.startsWith("/reviews/") ? "Review detail" : "BuildIT"}</strong></div><div className="top-actions"><a className="quiet-link" href="/data-handling">Data & privacy</a><SetupProgress /><AccountStatus compact /></div><details className="mobile-nav"><summary>Menu</summary><nav>{[...work, ...operations, ...settings].map(item => <NavLink key={item.href} item={item} current={isCurrent(pathname, item.href)} sampleTour={sampleTour} />)}</nav></details></header>
        <WorkspaceRouteBoundary>{children}</WorkspaceRouteBoundary>
      </main>
    </div>
  </>;
}

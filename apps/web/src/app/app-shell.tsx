"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AccountStatus } from "./account-status";
import { WorkspaceSwitcher } from "./workspace-switcher";

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
  { label: "Audit log", href: "/audit" },
];

function NavLink({ item, current }: { item: { label: string; href: string; mark?: string }; current: boolean }) {
  return <a className="nav-link" data-current={current || undefined} href={item.href} aria-current={current ? "page" : undefined}>
    {item.mark ? <span className="nav-mark" aria-hidden="true">{item.mark}</span> : null}<span>{item.label}</span>
  </a>;
}

function isCurrent(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <>
    <div className="preview-banner" role="status"><span className="preview-label">Preview</span><span>Sample evidence is clearly marked. GitHub sign-in works; repository execution and AI review remain disabled.</span><a href="/data-handling">Trust boundary</a></div>
    <div className="shell">
      <aside className="side">
        <div className="brand-row"><span className="brand-glyph" aria-hidden="true">B</span><a className="brand" href="/">BuildIT<span>Evidence room</span></a></div>
        <WorkspaceSwitcher />
        <nav aria-label="Primary"><p className="nav-heading">Workspace</p>{work.map(item => <NavLink key={item.href} item={item} current={isCurrent(pathname, item.href)} />)}<p className="nav-heading">Operations</p>{operations.map(item => <NavLink key={item.href} item={item} current={isCurrent(pathname, item.href)} />)}</nav>
        <nav className="settings-nav" aria-label="Organization settings">{settings.map(item => <NavLink key={item.href} item={item} current={isCurrent(pathname, item.href)} />)}</nav>
        <div className="account"><AccountStatus /></div>
      </aside>
      <main className="main">
        <header className="top"><div><p className="top-kicker">Workspace</p><strong>{pathname.startsWith("/reviews/") ? "Review detail" : "BuildIT"}</strong></div><div className="top-actions"><a className="quiet-link" href="/data-handling">Data & privacy</a><a className="setup-state" href="/setup/install"><span className="setup-dot" />Setup 1 of 4</a><AccountStatus compact /></div><details className="mobile-nav"><summary>Menu</summary><nav>{[...work, ...operations, ...settings].map(item => <NavLink key={item.href} item={item} current={isCurrent(pathname, item.href)} />)}</nav></details></header>
        {children}
      </main>
    </div>
  </>;
}

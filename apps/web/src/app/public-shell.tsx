"use client";

import type { ReactNode } from "react";
import { AccountStatus } from "./account-status";
import { BrandGlyph } from "./brand-glyph";
import { ConnectionBanner } from "./live-connections";

// BuildIT had no landing page. AppShell rendered the workspace sidebar on every route and
// "Overview" was href "/", so a stranger arriving at the product met a Workspace kicker, a
// workspace switcher, ten nav destinations across three groups and a "Setup 1 of 4" meter before
// one sentence had told them what BuildIT does. Every "the flows are unclear" symptom came from
// that: the page could not tell whether its reader was evaluating the product, touring a sample,
// or doing work.
//
// The marketing routes were already public - workspace-route-boundary.tsx never gated them - so
// only the chrome was wrong. This is the chrome those routes should have had: the brand, the three
// things a stranger asks for next, and one way in.
const links = [
  { label: "Features", href: "/features" },
  { label: "Pricing", href: "/pricing" },
  { label: "Try a scan", href: "/sandbox" },
  { label: "Data & privacy", href: "/data-handling" },
];

export function PublicShell({ children }: { children: ReactNode }) {
  // The preview banner stays. The three-bands-before-the-headline problem was the workspace header,
  // not this: the banner is the one that tells a reader the evidence on the page is sample data and
  // not their repository, which is a guarantee rather than chrome.
  return <div className="public-shell">
    <ConnectionBanner />
    <header className="public-top">
      <a className="public-brand" href="/">
        <span className="brand-glyph" aria-hidden="true"><BrandGlyph /></span>
        <span>BuildIT<small>Evidence room</small></span>
      </a>
      <nav aria-label="About BuildIT">
        {links.map(item => <a key={item.href} className="public-link" href={item.href}>{item.label}</a>)}
      </nav>
      <AccountStatus compact />
    </header>
    <main className="public-main" id="main" tabIndex={-1}>{children}</main>
    <footer className="public-foot">
      <p>BuildIT reviews pull requests and cites the file, line and commit behind every finding. It never merges.</p>
      <nav aria-label="More about BuildIT">
        {links.map(item => <a key={item.href} className="quiet-link" href={item.href}>{item.label}</a>)}
        <a className="quiet-link" href="/reviews?tour=1">Sample review</a>
      </nav>
    </footer>
  </div>;
}

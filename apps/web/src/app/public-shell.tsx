"use client";

import type { ReactNode } from "react";
import { AccountStatus } from "./account-status";
import { BrandGlyph } from "./brand-glyph";

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
  // The preview banner is gone from here, and only from here. Its copy - "Sample evidence is
  // clearly marked. Connect GitHub to replace setup examples with your isolated workspace." - is
  // about the sample review tour, and there are no samples on a marketing route: the landing page,
  // pricing and features show product copy, and /sandbox scans the reader's own pasted code. So a
  // stranger's first 44px of BuildIT was an amber warning bar about data the page did not contain,
  // sitting above the headline and reading as "something is wrong".
  //
  // The labelling guarantee it carries is not weakened, because it never lived here. The tour is
  // /reviews?tour=1, /reviews is not in public-routes.ts, so AppShell renders it through the
  // workspace branch - which still mounts ConnectionBanner - and WorkspaceRouteBoundary stamps its
  // own "Sample tour - no live workspace data" note on top. public-shell.component.test.tsx pins
  // both halves so this cannot be undone by deleting the banner from the other shell too.
  return <div className="public-shell">
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
        {/* Deliberately in the footer and not in `links`. The top nav is what a stranger needs to
            understand the product; the operating numbers are what they check afterwards, and
            putting a live metrics page beside "Pricing" reads as a boast rather than a receipt. */}
        <a className="quiet-link" href="/proof">Live numbers</a>
        <a className="quiet-link" href="/reviews?tour=1">Sample review</a>
        <a className="quiet-link" href="https://github.com/tanmayiift" target="_blank" rel="noreferrer noopener">Built by @tanmayiift</a>
      </nav>
    </footer>
  </div>;
}

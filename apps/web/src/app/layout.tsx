import "./globals.css";
import "./mobile.css";
import type { ReactNode } from "react";
import { ConvexClientProvider } from "./convex-client-provider";

const nav = ["Review Queue", "Repositories", "Metrics", "Usage", "Integrations", "Policies", "Members", "Audit Log"];
const href = (name: string) => name === "Review Queue" ? "/" : "/" + name.toLowerCase().replace(" log", "").replaceAll(" ", "-");

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><ConvexClientProvider>
    <div className="preview-banner" role="status"><strong>Product preview</strong><span>All reviews, people, organizations, and usage shown here are sample data. Sign-in and repository access are not active yet.</span></div>
    <div className="shell">
      <aside className="side">
        <a className="brand" href="/">BuildIT<span className="org">Agentic review workspace</span></a>
        <nav className="nav" aria-label="Primary">{nav.map(name => <a key={name} href={href(name)}>{name}</a>)}</nav>
        <div className="account"><span className="preview-dot" aria-hidden="true" />Preview mode<br/><a className="account-link" href="/data-handling">How data is handled</a></div>
      </aside>
      <main className="main">
        <header className="top">
          <strong>Evidence-backed PR verification</strong>
          <details className="mobile-nav"><summary>Menu</summary><nav aria-label="Mobile primary">{nav.map(name => <a key={name} href={href(name)}>{name}</a>)}</nav></details>
          <div className="top-actions"><a className="text-link" href="/data-handling">Data & privacy</a><a className="button compact" href="/sign-in">Sign in</a></div>
        </header>
        {children}
      </main>
    </div>
  </ConvexClientProvider></body></html>;
}

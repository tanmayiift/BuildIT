import "@fontsource-variable/manrope/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./globals.css";
import "./mobile.css";
import "./account.css";
import "./flows.css";
import { Suspense, type ReactNode } from "react";
import { ConvexClientProvider } from "./convex-client-provider";
import { AppShell } from "./app-shell";

export const dynamic = "force-dynamic";

const title = "BuildIT — Evidence-backed code review";
const description = "Autonomous pull request review that shows its work, so a merge decision rests on evidence rather than trust.";
const site = process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://buildit-agentic-review.vercel.app");

export const metadata = {
  metadataBase: new URL(site),
  title,
  description,
  applicationName: "BuildIT",
  openGraph: {
    type: "website", siteName: "BuildIT", url: site, title, description,
    images: [{ url: "/social-card.png", width: 2400, height: 1260, alt: "BuildIT — proof before the merge" }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/social-card.png"] },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><a className="skip-link" href="#main">Skip to content</a>
        <ConvexClientProvider><Suspense fallback={<main className="content route-gate" aria-live="polite"><h1>Loading BuildIT…</h1></main>}><AppShell>{children}</AppShell></Suspense></ConvexClientProvider></body></html>;
}

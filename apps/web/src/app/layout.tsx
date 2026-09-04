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
const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://buildit-agentic-review.vercel.app";

export const metadata = {
  metadataBase: new URL(site),
  title,
  description,
  applicationName: "BuildIT",
  // The tab was blank because of the proxy, not the metadata: app/icon.svg does build a route, but
  // route-map.ts did not know /icon.svg, so the Edge proxy answered 404 - the same drift that once
  // 404ed the social card. /favicon.ico missed the proxy entirely via the matcher and fell through
  // to [section], which cannot set a 404 after the Suspense shell is flushed, so it answered 200
  // with HTML. Both files now ship from apps/web/public and are listed in publicAssets. Declaring
  // icons here also suppresses the file-convention link, so only paths the proxy allows are emitted.
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "16x16 32x32 48x48", type: "image/x-icon" }, { url: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
    shortcut: "/favicon.ico",
  },
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

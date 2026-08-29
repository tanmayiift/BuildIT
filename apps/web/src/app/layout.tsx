import "@fontsource-variable/manrope/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./globals.css";
import "./mobile.css";
import "./account.css";
import "./flows.css";
import type { ReactNode } from "react";
import { ConvexClientProvider } from "./convex-client-provider";
import { AppShell } from "./app-shell";

export const metadata = { title: "BuildIT — Evidence-backed code review", description: "Autonomous pull request review with deterministic evidence and human merge authority." };

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><ConvexClientProvider><AppShell>{children}</AppShell></ConvexClientProvider></body></html>;
}

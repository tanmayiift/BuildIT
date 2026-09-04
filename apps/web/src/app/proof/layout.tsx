import type { ReactNode } from "react";

// page.tsx is "use client" because the numbers come from a live Convex subscription, and a client
// component cannot export metadata. The title lives here so this route stops shipping the root
// layout's title - the same reason sandbox/layout.tsx exists.
export const metadata = { title: "Proof · BuildIT" };

export default function ProofLayout({ children }: { children: ReactNode }) {
  return children;
}

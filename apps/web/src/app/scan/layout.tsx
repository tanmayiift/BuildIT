import type { ReactNode } from "react";

// page.tsx is "use client" for the paste-and-scan form, and a client component cannot export
// metadata. The title lives here so this route stops shipping the root layout's title.
export const metadata = { title: "Try a scan · BuildIT" };

export default function SandboxLayout({ children }: { children: ReactNode }) {
  return children;
}

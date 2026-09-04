import type { ReactNode } from "react";

// page.tsx is "use client" for the GitHub sign-in action, and a client component cannot export
// metadata. The title lives here so this route stops shipping the root layout's title.
export const metadata = { title: "Sign in · BuildIT" };

export default function SignInLayout({ children }: { children: ReactNode }) {
  return children;
}

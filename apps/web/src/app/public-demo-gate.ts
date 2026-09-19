// Whether the open scan is currently offered to strangers.
//
// The scan costs nothing per run, but it is the one surface that executes attacker-supplied input
// with no account behind it, and BuildIT now has tenants other than its author. Turning it off is
// not a security fix - the route caps body size, file count and line count, and reads nothing from
// disk - it is a decision about who the product is open to while it is being demonstrated.
//
// Off unless the value is exactly "true", matching convex/lib/executionGate.ts. "TRUE" and "1" are
// off: a flag that guesses at intent is a flag nobody can reason about from the env listing alone.
//
// This lives in apps/web and not in convex/lib because every reader is Next.js code. The BYOK half
// of the same request needed no flag at all: providerCredentials.organizationId is required, so a
// platform-owned key is not representable and every org already has to bring its own. See the
// architecture test that pins that.
//
// NEXT_PUBLIC_, and one name rather than two, because the readers straddle the client boundary:
// /api/scan and the three pages are server code, but the nav in public-shell.tsx and the link on
// /proof are client components, which cannot see a server-only variable. One variable both sides
// can read beats a server flag plus a mirrored client flag that can disagree.
export const PUBLIC_DEMO_ENV = "NEXT_PUBLIC_BUILDIT_PUBLIC_DEMO_ENABLED";

// The default is written as a literal property access, not process.env[PUBLIC_DEMO_ENV]. Next
// inlines NEXT_PUBLIC_ variables into the client bundle only where it can see the exact access at
// build time; a dynamic index compiles to undefined in the browser and the nav link would never
// appear however the variable was set.
export function publicDemoEnabled(value = process.env.NEXT_PUBLIC_BUILDIT_PUBLIC_DEMO_ENABLED) {
  return value === "true";
}

/** What the /sandbox page says when the demo is closed. Kept beside the gate so the two cannot drift. */
export const demoClosedHeading = "The open sandbox is not currently available";
export const demoClosedDetail = "BuildIT's deterministic rules still run on every connected pull request. Connect a repository to see them on your own code, or ask for a walkthrough.";

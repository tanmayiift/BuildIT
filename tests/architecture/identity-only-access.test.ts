import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The identity-only claim is repeated on /data-handling, /sign-in and both launch guides, and the
// only tests asserting it were the two production E2E cases that skip unless BUILDIT_E2E_BASE_URL
// is set - which CI never sets. So the claim was verified by nothing that executes. These are
// assertions about the app's own configuration and markup, which do not need a deployment.

const auth = readFileSync("convex/auth.ts", "utf8");
const connections = readFileSync("apps/web/src/app/live-connections.tsx", "utf8");

describe("identity-only GitHub access", () => {
  // @auth/core's GitHub provider defaults to read:user and user:email. Requesting anything wider
  // takes an explicit authorization.params.scope, so the absence of one IS the control.
  it("requests no repository scope at sign-in", () => {
    expect(auth).toContain("GitHub({");
    expect(auth).not.toMatch(/authorization\s*:/);
    for (const scope of ["repo", "public_repo", "write:org", "admin:org", "delete_repo", "workflow"]) {
      expect(auth, `sign-in must not request ${scope}`).not.toMatch(new RegExp(`scope[^\\n]*\\b${scope}\\b`));
    }
  });

  // Repository access comes from installing the GitHub App, where GitHub - not BuildIT - shows
  // the permission request and lets the owner pick repositories.
  it("sends repository access through the registered App installation", () => {
    expect(connections).toContain("https://github.com/apps/buildit-agentic-review/installations/new");
    expect(connections).not.toMatch(/github\.com\/login\/oauth\/authorize\?[^"]*scope=[^"]*repo/);
  });

  it("refuses an off-site redirect after sign-in", () => {
    expect(auth).toContain('if (!redirectTo.startsWith("/") || redirectTo.startsWith("//")) throw new Error("invalid_redirect");');
    // The destination is built on SITE_URL, so a caller cannot choose the origin.
    expect(auth).toContain("return `${process.env.SITE_URL!}${redirectTo}`;");
  });
});

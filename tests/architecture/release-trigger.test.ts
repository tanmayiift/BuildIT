import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Release used to run on every push to main, beside CI rather than after it. It repeated CI's whole
// verify, and a release-configuration mistake showed up as a red run on main of a public
// repository - eight of them on 5 Oct 2026 while the deploy key and package build were fixed by
// pushing to main. These pin the shape that stops that: release follows a green CI run of a push to
// main, for exactly the commit CI tested, and CI on main is never cancelled out from under it.
const release = readFileSync(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

describe("a release follows CI, never a push", () => {
  it("is triggered by a completed CI run on main, or by hand", () => {
    expect(release).not.toMatch(/^\s{2}push:/m);
    expect(release).toMatch(/workflow_run:\s*\n\s+workflows: \["Build and test"\]\s*\n\s+types: \[completed\]\s*\n\s+branches: \[main\]/);
    expect(release).toContain("workflow_dispatch:");
  });

  it("releases only a successful CI run of a push from this repository", () => {
    expect(release).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(release).toContain("github.event.workflow_run.event == 'push'");
    expect(release).toContain("github.event.workflow_run.head_repository.full_name == github.repository");
    // Nothing produced by the CI run is trusted: no artifact crosses from it into a job holding secrets.
    expect(release).not.toMatch(/download-artifact/);
  });

  it("checks out the commit CI tested in every job, and skips a commit main has moved past", () => {
    expect(release).toContain("RELEASE_SHA: ${{ github.event.workflow_run.head_sha || github.sha }}");
    const checkouts = release.match(/uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n\s+with:\s*\n\s+ref: \$\{\{ env\.RELEASE_SHA \}\}/g) ?? [];
    const jobs = release.match(/^ {2}[a-z-]+:\n/gm) ?? [];
    expect(checkouts.length).toBe(jobs.length);
    expect(release).toContain("git ls-remote origin refs/heads/main");
    expect(release).toContain("needs.preflight.outputs.current == 'true'");
  });

  it("makes a dispatched release prove CI passed for the commit", () => {
    expect(release).toMatch(/gh run list --workflow ci\.yml --commit "\$RELEASE_SHA"/);
  });

  it("never cancels CI on main, and exercises the release plan on every pull request without secrets", () => {
    expect(ci).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    // A queued main run is never displaced either: each push to main has a group of its own.
    expect(ci).toContain("group: buildit-ci-${{ github.event_name == 'pull_request' && github.ref || github.sha }}");
    // And no release is cancelled for waiting: only the deploy job is serialised.
    expect(release).not.toMatch(/^concurrency:/m);
    expect(release).toMatch(/release:\n[\s\S]*?concurrency:\n\s+group: buildit-deploy\n\s+cancel-in-progress: false/);
    expect(ci).not.toMatch(/cancel-in-progress: true/);
    const contract = ci.slice(ci.indexOf("  deploy-contract:"), ci.indexOf("\n  browser:"));
    expect(contract).toContain("pnpm deploy:check");
    expect(contract).not.toMatch(/secrets\./);
    expect(contract).not.toMatch(/^\s+if:/m);
  });
});

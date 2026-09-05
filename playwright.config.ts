import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.BUILDIT_E2E_BASE_URL;
const baseURL = externalBaseUrl ?? "http://127.0.0.1:3107";

export default defineConfig({
  testDir: "tests/e2e",
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}",
  fullyParallel: true,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
    // Interaction proof, not extra coverage. "The setup route is live" was answerable only with a
    // URL, so this project exists to answer it with a recording of a signed-out stranger operating
    // the product end to end.
    //
    // testMatch, not a global `video: "on"`: recording the other ~200 cases would film every axe
    // sweep and every screenshot comparison, slow the browser CI job for evidence nobody watches,
    // and bury the one film that is the point. trace is "on" here for the same reason - the
    // journey is worth stepping through even when it passes.
    {
      name: "onboarding",
      testMatch: /onboarding\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], video: "on", trace: "on" },
    },
  ],
  // The build bakes NEXT_PUBLIC_CONVEX_URL in, so the backend /proof reads is decided here, before
  // any test runs - and deliberately NOT decided here. No default is supplied: one would have to be
  // the production deployment, and that would silently point every local page and every `pnpm dev`
  // session at the production database to keep one assertion green.
  //
  // What is supplied instead is an answer. The preflight resolves the variable exactly as the build
  // will, asks the deployment whether it serves publicProof:summary, and prints what it found to
  // stderr - which Playwright forwards - on every run. It exits non-zero only when the variable is
  // absent, where the alternative is a 120-second webServer timeout reported as "Timed out" for a
  // build that threw in its first second.
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "npx pnpm@10.15.0 exec tsx tests/e2e/convex-backend.ts --preflight && NEXT_PUBLIC_BUILDIT_E2E=1 npx pnpm@10.15.0 --filter @buildit/web build && NEXT_PUBLIC_BUILDIT_E2E=1 npx pnpm@10.15.0 --filter @buildit/web exec next start -p 3107",
        url: baseURL,
        reuseExistingServer: false,
        stderr: "pipe",
        timeout: 120_000,
      },
});

import { defineConfig, devices } from "@playwright/test";

// The open scan is off by default, which means the default is the state that actually ships - and
// the main suite pins the flag on, so without this nothing would ever exercise it end to end. The
// question here is not "does the demo work" but "is the site coherent without it": no nav entry
// leading nowhere, no hero control that can only fail, and the route still answering rather than
// 404ing out from under the proxy and its tests.
const baseURL = "http://127.0.0.1:3108";

export default defineConfig({
  testDir: "tests/e2e-demo-closed",
  fullyParallel: true,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // No NEXT_PUBLIC_BUILDIT_PUBLIC_DEMO_ENABLED at all - unset is the shipping default, and
    // "unset" rather than "false" is deliberately the case under test.
    command: "NEXT_PUBLIC_BUILDIT_E2E=1 npx pnpm@10.15.0 --filter @buildit/web build && NEXT_PUBLIC_BUILDIT_E2E=1 npx pnpm@10.15.0 --filter @buildit/web exec next start -p 3108",
    url: baseURL,
    reuseExistingServer: false,
    stderr: "pipe",
    timeout: 180_000,
  },
});

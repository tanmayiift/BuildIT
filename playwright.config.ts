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
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "npx pnpm@10.15.0 --filter @buildit/web dev --port 3107",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});

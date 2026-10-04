import { defineConfig } from "@playwright/test";

// Two real identities, each in its own Chrome window that its owner signed into; see
// tests/live-browser.ts and scripts/browser-evidence.mjs, which opens the windows. Both endpoints
// must be loopback debugging ports, and they must be two different browsers.
const baseURL = process.env.BUILDIT_E2E_BASE_URL;
const browserA = process.env.BUILDIT_E2E_USER_A_CDP;
const browserB = process.env.BUILDIT_E2E_USER_B_CDP;
if (!baseURL?.startsWith("https://") || !browserA || !browserB) throw new Error("two_user_production_evidence_required");
for (const endpoint of [browserA, browserB]) if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint)) throw new Error("live_browser_must_be_loopback");
if (browserA === browserB) throw new Error("two_independent_browsers_required");

export default defineConfig<object, { cdpEndpoint: string | undefined }>({
  testDir: "tests/e2e-production",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: { baseURL, trace: "off", screenshot: "off" },
  projects: [
    { name: "user-a", use: { cdpEndpoint: browserA } },
    { name: "user-b", use: { cdpEndpoint: browserB } },
  ],
});

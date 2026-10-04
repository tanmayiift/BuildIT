import { defineConfig } from "@playwright/test";

// The only browser suite that runs as a real signed-in user. Every other workspace assertion uses
// the sample tour, the e2e design fixture or a mocked component, so the journey a customer actually
// takes - claimed installation, saved key, prepare, consent, start, read the verdict - had no browser
// coverage at all. GitHub blocks automated OAuth, so the session is a Chrome window its owner signed
// into (tests/live-browser.ts), reached over a loopback debugging port. Without one this refuses to
// run rather than skipping: a skipped suite reads as a passed one.
const baseURL = process.env.BUILDIT_E2E_BASE_URL;
const browser = process.env.BUILDIT_E2E_SESSION_CDP;
if (!baseURL?.startsWith("https://") || !browser) throw new Error("signed_in_session_evidence_required");
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(browser)) throw new Error("live_browser_must_be_loopback");

export default defineConfig<object, { cdpEndpoint: string | undefined }>({
  testDir: "tests/e2e-session",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: { baseURL, trace: "off", screenshot: "off" },
  projects: [{ name: "session", use: { cdpEndpoint: browser } }],
});

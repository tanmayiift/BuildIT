import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The only browser suite that runs as a real signed-in user. Every other workspace assertion uses
// the sample tour, the e2e design fixture or a mocked component, so the journey a customer actually
// takes - claimed installation, saved key, prepare, consent, start, read the verdict - had no browser
// coverage at all. GitHub blocks automated OAuth, so the session is a storage state an operator
// generates by signing in, kept under .local/ (gitignored). Without one this refuses to run rather
// than skipping: a skipped suite reads as a passed one.
const baseURL = process.env.BUILDIT_E2E_BASE_URL;
const state = process.env.BUILDIT_E2E_SESSION_STATE;
if (!baseURL?.startsWith("https://") || !state) throw new Error("signed_in_session_evidence_required");
const localRoot = `${resolve(process.cwd(), ".local")}${sep}`;
if (!resolve(state).startsWith(localRoot) || !existsSync(state)) throw new Error("session_storage_state_must_be_local_and_ignored");

export default defineConfig({
  testDir: "tests/e2e-session",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: { baseURL, storageState: state, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "session", use: { ...devices["Desktop Chrome"] } }],
});

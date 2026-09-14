import { defineConfig, devices } from "@playwright/test";
if (process.env.BUILDIT_E2E_BASE_URL && process.env.BUILDIT_E2E_BASE_URL !== "http://127.0.0.1:3107") throw new Error("local_audit_cannot_target_remote");
export default defineConfig({
  testDir: "tests/e2e-local", testMatch: "**/*.spec.ts", workers: 1, fullyParallel: false,
  outputDir: ".local/audit-runtime/browser-artifacts",
  reporter: [["line"], ["json", { outputFile: process.argv.includes("--list") ? "audit/evidence/local-browser-test-inventory.json" : "audit/evidence/local-browser-results.json" }]],
  use: { baseURL: "http://127.0.0.1:3107", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "local-desktop", use: { ...devices["Desktop Chrome"] } }],
});

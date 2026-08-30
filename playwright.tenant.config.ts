import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BUILDIT_E2E_BASE_URL;
const stateA = process.env.BUILDIT_E2E_USER_A_STATE;
const stateB = process.env.BUILDIT_E2E_USER_B_STATE;
if (!baseURL?.startsWith("https://") || !stateA || !stateB) throw new Error("two_user_production_evidence_required");
const localRoot = `${resolve(process.cwd(), ".local")}${sep}`;
for (const path of [stateA, stateB]) if (!resolve(path).startsWith(localRoot) || !existsSync(path)) throw new Error("two_user_storage_state_must_be_local_and_ignored");
if (resolve(stateA) === resolve(stateB)) throw new Error("two_independent_storage_states_required");

export default defineConfig({
  testDir: "tests/e2e-production",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "user-a", use: { ...devices["Desktop Chrome"], storageState: stateA } },
    { name: "user-b", use: { ...devices["Desktop Chrome"], storageState: stateB } },
  ],
});

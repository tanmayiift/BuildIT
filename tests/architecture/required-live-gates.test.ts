import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("required release evidence", () => {
  const verifyWithoutCredential = (args: string[]) => spawnSync(
    process.execPath, ["scripts/provision-buildit-grafana-alerts.mjs", ...args],
    { cwd: new URL("../../", import.meta.url), encoding: "utf8",
      env: { ...process.env, BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN: "" } },
  );

  it("never claims the deployed rules were verified without a credential", () => {
    const result = verifyWithoutCredential(["--verify"]);
    expect(result.stdout).toContain("buildit_grafana_verification_skipped");
    expect(result.stdout).toContain("were NOT checked");
    // The one thing it must never print, because a later reader takes it as evidence.
    expect(`${result.stdout}${result.stderr}`).not.toContain("buildit_grafana_alerts_match");
  });

  it("still fails hard when a caller demands the evidence", () => {
    for (const flag of ["--require", "--report"]) {
      const result = verifyWithoutCredential([flag]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("buildit_grafana_verification_required");
    }
  });
  it("keeps missing external evidence from passing either CI or the production release", () => {
    const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
    const release = readFileSync(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
    expect(ci).toContain("github.event_name == 'pull_request'");
    expect(ci).toContain("buildit_external_gates_deferred");
    expect(release).not.toMatch(/NOT checked[\s\S]{0,400}exit 0/);
    expect(release).toContain("pnpm alerts:verify");
    expect(release).toContain("pnpm smoke:aws-boundary");
  });
});

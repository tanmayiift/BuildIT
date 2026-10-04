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
  // The two-user isolation proof and the signed-in journey only run where operator storage states
  // exist. Absent, CI must say what was not proven; present, a failure must fail the job.
  it("runs the real-browser evidence off pull requests and never reports it proven without states", () => {
    const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
    const start = ci.indexOf("- name: Signed-in and two-user browser evidence");
    expect(start).toBeGreaterThan(-1);
    const step = ci.slice(start, ci.indexOf("- name:", start + 10));
    expect(step).toContain("if: ${{ github.event_name != 'pull_request' }}");
    expect(step).toContain("pnpm test:e2e:tenant-isolation");
    expect(step).toContain("pnpm test:e2e:session");
    expect(step.match(/::warning title=[^:]+::[^"]*NOT (checked|exercised)/g)).toHaveLength(2);
    // Each run happens only in the branch where its states exist, and nothing in the step can turn
    // a missing state into success: no exit 0, no "|| true".
    expect(step).not.toMatch(/exit 0|\|\| true|continue-on-error/);
  });

  it("refuses to run the signed-in suite without a real session", () => {
    const result = spawnSync("npx", ["playwright", "test", "--config", "playwright.session.config.ts", "--list"], {
      cwd: new URL("../../", import.meta.url), encoding: "utf8",
      env: { ...process.env, BUILDIT_E2E_BASE_URL: "", BUILDIT_E2E_SESSION_STATE: "" },
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("signed_in_session_evidence_required");
  });

  // CI reaches AWS through GitHub's OIDC token and a read-only role (infra/aws/ci-reader.yaml), never a
  // stored key. A long-lived key in a repository secret is exactly what that role exists to avoid.
  it("verifies the AWS boundary through the read-only OIDC role, with no stored AWS key", () => {
    for (const name of ["ci.yml", "release.yml"]) {
      const workflow = readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), "utf8");
      expect(workflow, name).not.toMatch(/AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/);
      expect(workflow, name).toMatch(/aws-actions\/configure-aws-credentials@[0-9a-f]{40}/);
      expect(workflow, name).toContain("role-to-assume: ${{ vars.BUILDIT_AWS_CI_ROLE_ARN }}");
      expect(workflow, name).toMatch(/id-token: write/);
    }
    const reader = readFileSync(new URL("../../infra/aws/ci-reader.yaml", import.meta.url), "utf8");
    expect(reader).toContain('"token.actions.githubusercontent.com:sub": "repo:${Repository}:ref:refs/heads/main"');
    // The immutable owner@id/repository@id subject: a renamed or re-created repository cannot match it.
    expect(reader).toMatch(/Repository:[\s\S]*?Default: tanmayiift@\d+\/BuildIT@\d+/);
    // Read-only: no action in the role's policy may write, delete, decrypt or pass a role.
    const actions = [...reader.matchAll(/^\s+- ([a-z0-9]+:[A-Za-z]+)$|Action: ([a-z0-9]+:[A-Za-z]+)$/gm)].map(match => match[1] ?? match[2]);
    expect(actions.length).toBeGreaterThan(15);
    expect(actions.filter(action => !/^(cloudformation:(Describe|Get)|iam:Get|kms:(Describe|Get)|s3:(Get|List))/.test(action!))).toEqual([]);
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

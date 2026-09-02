import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  aliasArgs, assertAliasMatches, assertBuildITWebDeployContext, assertProbeOk,
  deployArgs, inspectArgs, parseAliasTarget, parseDeploymentUrl, probeWithRetry, resolveDeployLink,
} from "../../scripts/deploy-buildit-web.mjs";
import { assertBuildITBrokerDeployContext } from "../../scripts/deploy-buildit-broker.mjs";

const repoRoot = process.cwd();
const correctLink = {
  projectId: "prj_rU8IPaf1laMTTmQEhGun9mRxXmGA",
  orgId: "team_0C3dsIfWxzBINeWinBvtOLMC",
  projectName: "buildit-agentic-review",
};
const brokerLink = {
  projectId: "prj_tacCioktOE1TKZwHcq0Hxu9VYOU0",
  orgId: "team_0C3dsIfWxzBINeWinBvtOLMC",
  projectName: "buildit-content-broker",
};
const deployedUrl = "https://buildit-agentic-review-opiiyg2yg-buildit-agentic-review.vercel.app";
const staleUrl = "https://buildit-agentic-review-db33qdjyp-buildit-agentic-review.vercel.app";

describe("BuildIT web deployment command", () => {
  it("accepts only the repository root and dedicated BuildIT project", () => {
    expect(assertBuildITWebDeployContext({ cwd: repoRoot, repoRoot, link: correctLink })).toEqual({
      projectName: "buildit-agentic-review",
      teamName: "buildit-agentic-review",
      rootDirectory: "apps/web",
      productionAlias: "buildit-agentic-review.vercel.app",
    });
  });

  it("rejects the historical apps/web double-root deployment", () => {
    expect(() => assertBuildITWebDeployContext({ cwd: `${repoRoot}/apps/web`, repoRoot, link: correctLink })).toThrow("buildit_web_deploy_must_run_from_repo_root");
  });

  it("rejects another Vercel project or team before deployment", () => {
    expect(() => assertBuildITWebDeployContext({ cwd: repoRoot, repoRoot, link: { ...correctLink, projectName: "other" } })).toThrow("buildit_web_deploy_name_refused");
    expect(() => assertBuildITWebDeployContext({ cwd: repoRoot, repoRoot, link: { ...correctLink, orgId: "other" } })).toThrow("buildit_web_deploy_team_refused");
    expect(() => assertBuildITWebDeployContext({ cwd: repoRoot, repoRoot, link: { ...correctLink, projectId: "other" } })).toThrow("buildit_web_deploy_project_refused");
  });

  it("deploys to production against the pinned team", () => {
    expect(deployArgs()).toEqual(["deploy", "--prod", "--yes", "--scope", "buildit-agentic-review"]);
  });
});

describe("production alias release step", () => {
  it("assigns the alias the GitHub App callbacks resolve through", () => {
    expect(aliasArgs(deployedUrl)).toEqual([
      "alias", "set", deployedUrl, "buildit-agentic-review.vercel.app", "--scope", "buildit-agentic-review",
    ]);
  });

  it("refuses to assign an alias without a deployment target", () => {
    expect(() => aliasArgs(undefined)).toThrow("buildit_web_deploy_url_missing");
  });

  it("reads the deployment url from the CLI json envelope", () => {
    const stdout = JSON.stringify({ status: "ok", deployment: { id: "dpl_1", url: deployedUrl, readyState: "READY" } });
    expect(parseDeploymentUrl(stdout)).toBe(deployedUrl);
  });

  it("still finds a deployment url in plain-text CLI output", () => {
    expect(parseDeploymentUrl(`Inspect: https://vercel.com/x\nProduction: ${deployedUrl}\n`)).toBe(deployedUrl);
  });

  it("fails loudly rather than skipping the alias when no url can be read", () => {
    expect(() => parseDeploymentUrl("Deployed.")).toThrow("buildit_web_deploy_url_unparsable");
  });

  // Observed in a real release: the CLI progress stream also names an auto-assigned project
  // domain. Picking that instead of the deployment verified the alias against the wrong target
  // and failed a release that had actually succeeded.
  it("ignores auto-assigned project domains and picks the deployment instance", () => {
    const stdout = `${deployedUrl}\n`;
    expect(parseDeploymentUrl(stdout)).toBe(deployedUrl);
    expect(parseDeploymentUrl(`Aliased https://buildit-lyart-nine.vercel.app\n${deployedUrl}\n`)).toBe(deployedUrl);
    expect(() => parseDeploymentUrl("Aliased https://buildit-lyart-nine.vercel.app\n")).toThrow("buildit_web_deploy_url_unparsable");
  });

  it("reads the deployment an alias currently resolves to", () => {
    const inspect = `  name\tbuildit-agentic-review\n  status\t● Ready\n  url\t\t${staleUrl}\n  created\tWed Sep 02 2026\n`;
    expect(parseAliasTarget(inspect)).toBe(staleUrl);
  });

  it("fails when the alias target cannot be read back", () => {
    expect(() => parseAliasTarget("no url here")).toThrow("buildit_web_deploy_alias_target_unreadable");
  });

  // The exact production defect: a Ready deployment that Vercel calls "current production"
  // while the alias still resolves to an older build.
  it("fails the release when the alias did not move to the new deployment", () => {
    expect(() => assertAliasMatches({ aliasTarget: staleUrl, deploymentUrl: deployedUrl })).toThrow("buildit_web_deploy_alias_not_moved");
  });

  it("passes when the alias resolves to the new deployment", () => {
    expect(assertAliasMatches({ aliasTarget: deployedUrl, deploymentUrl: deployedUrl })).toBe(true);
    expect(assertAliasMatches({ aliasTarget: `${deployedUrl}/`, deploymentUrl: deployedUrl })).toBe(true);
  });

  it("inspects the alias, not the deployment, when verifying", () => {
    expect(inspectArgs("buildit-agentic-review.vercel.app")).toEqual([
      "inspect", "buildit-agentic-review.vercel.app", "--scope", "buildit-agentic-review",
    ]);
  });

  it("requires the released alias to actually serve the app", () => {
    expect(assertProbeOk({ status: 200, url: "https://buildit-agentic-review.vercel.app/reviews" })).toBe(true);
    expect(() => assertProbeOk({ status: 404, url: "https://buildit-agentic-review.vercel.app/reviews" })).toThrow("buildit_web_deploy_probe_failed:404");
    expect(() => assertProbeOk({ status: 500, url: "x" })).toThrow("buildit_web_deploy_probe_failed:500");
  });
});

describe("BuildIT broker deployment command", () => {
  it("accepts only the repository root and the broker project", () => {
    expect(assertBuildITBrokerDeployContext({ cwd: repoRoot, repoRoot, link: brokerLink })).toEqual({
      projectName: "buildit-content-broker",
      teamName: "buildit-agentic-review",
      rootDirectory: "packages/broker",
      productionAlias: "buildit-content-broker.vercel.app",
    });
  });

  // packages/broker/vercel.json builds six sibling workspaces with `pnpm --filter`, which
  // cannot resolve unless the upload originates at the repository root.
  it("rejects deploying from the broker directory", () => {
    expect(() => assertBuildITBrokerDeployContext({ cwd: `${repoRoot}/packages/broker`, repoRoot, link: brokerLink })).toThrow("buildit_broker_deploy_must_run_from_repo_root");
  });

  it("refuses to deploy the broker into the web project", () => {
    expect(() => assertBuildITBrokerDeployContext({ cwd: repoRoot, repoRoot, link: { ...brokerLink, projectId: correctLink.projectId } })).toThrow("buildit_broker_deploy_project_refused");
    expect(() => assertBuildITBrokerDeployContext({ cwd: repoRoot, repoRoot, link: { ...brokerLink, projectName: "buildit-agentic-review" } })).toThrow("buildit_broker_deploy_name_refused");
    expect(() => assertBuildITBrokerDeployContext({ cwd: repoRoot, repoRoot, link: { ...brokerLink, orgId: "other" } })).toThrow("buildit_broker_deploy_team_refused");
  });
});

describe("deploy link resolution", () => {
  const readLink = () => JSON.stringify(correctLink);
  const failRead = () => { throw new Error("ENOENT"); };

  it("prefers the checked-out project link when one exists", () => {
    expect(resolveDeployLink({ repoRoot, env: {}, readFile: readLink })).toEqual(correctLink);
  });

  // .vercel/project.json is gitignored, so a runner has no link file. Vercel's CI contract is
  // VERCEL_PROJECT_ID / VERCEL_ORG_ID; without this the release job cannot deploy at all.
  it("falls back to the Vercel CI environment contract", () => {
    const link = resolveDeployLink({ repoRoot, env: { VERCEL_PROJECT_ID: correctLink.projectId, VERCEL_ORG_ID: correctLink.orgId }, readFile: failRead });
    expect(link).toEqual(correctLink);
    expect(assertBuildITWebDeployContext({ cwd: repoRoot, repoRoot, link })).toMatchObject({ projectName: "buildit-agentic-review" });
  });

  it("refuses to guess when neither a link file nor the environment is present", () => {
    expect(() => resolveDeployLink({ repoRoot, env: {}, readFile: failRead })).toThrow("buildit_web_deploy_link_missing");
    expect(() => resolveDeployLink({ repoRoot, env: { VERCEL_ORG_ID: correctLink.orgId }, readFile: failRead })).toThrow("buildit_web_deploy_link_missing");
  });

  // The id check stays the real guard: a wrong secret must still be refused before deploying.
  it("still refuses a wrong project id supplied by the environment", () => {
    const link = resolveDeployLink({ repoRoot, env: { VERCEL_PROJECT_ID: "prj_someone_else", VERCEL_ORG_ID: correctLink.orgId }, readFile: failRead });
    expect(() => assertBuildITWebDeployContext({ cwd: repoRoot, repoRoot, link })).toThrow("buildit_web_deploy_project_refused");
  });
});

// A single fetch straight after an alias move is the least reliable moment to make one: DNS and
// edge propagation can lose it. Observed in a real release - the alias had already moved and the
// site was serving, and the script still reported the release as failed.
describe("release probe", () => {
  const url = "https://buildit-agentic-review.vercel.app/reviews";
  const noWait = async () => {};

  it("passes on the first try when the alias is already serving", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return new Response("", { status: 200 }); };
    await expect(probeWithRetry(url, fetchImpl, noWait)).resolves.toBe(200);
    expect(calls).toBe(1);
  });

  it("rides out a transient network failure rather than failing a good release", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; if (calls < 3) throw new TypeError("fetch failed"); return new Response("", { status: 200 }); };
    await expect(probeWithRetry(url, fetchImpl, noWait)).resolves.toBe(200);
    expect(calls).toBe(3);
  });

  it("rides out an edge that has not caught up yet", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return new Response("", { status: calls < 2 ? 404 : 200 }); };
    await expect(probeWithRetry(url, fetchImpl, noWait)).resolves.toBe(200);
  });

  // Retrying must not turn a genuinely broken release into a green one.
  it("still fails when the alias never serves", async () => {
    const fetchImpl = async () => new Response("", { status: 500 });
    await expect(probeWithRetry(url, fetchImpl, noWait)).rejects.toThrow("buildit_web_deploy_probe_failed:500");
  });

  it("still fails when every attempt errors", async () => {
    const fetchImpl = async () => { throw new TypeError("fetch failed"); };
    await expect(probeWithRetry(url, fetchImpl, noWait)).rejects.toThrow("fetch failed");
  });
});

// The Release workflow had never been run, and it would have failed on its first use: on a runner
// there is no .vercel/project.json, and the shared VERCEL_PROJECT_ID / VERCEL_ORG_ID pair names
// the web project - so the broker's link resolution returned the web project and its own guard
// refused the release. CI never ran the deploy checks, so nothing caught it.
describe("release runs on a runner with no link file", () => {
  const failRead = () => { throw new Error("ENOENT"); };
  const runnerEnv = { VERCEL_PROJECT_ID: correctLink.projectId, VERCEL_ORG_ID: correctLink.orgId };

  it("resolves the web project from the CI environment", () => {
    const link = resolveDeployLink({ repoRoot, env: runnerEnv, readFile: failRead });
    expect(assertBuildITWebDeployContext({ cwd: repoRoot, repoRoot, link })).toMatchObject({ projectName: "buildit-agentic-review" });
  });

  // The broker must not resolve to the web project just because that pair is what CI exports.
  it("does not let the web ids become the broker's link", () => {
    expect(() => assertBuildITBrokerDeployContext({ cwd: repoRoot, repoRoot, link: { ...correctLink } }))
      .toThrow("buildit_broker_deploy_project_refused");
    expect(assertBuildITBrokerDeployContext({ cwd: repoRoot, repoRoot, link: brokerLink })).toMatchObject({ projectName: "buildit-content-broker" });
  });

  it("names both ids in the release workflow, so the check has something to resolve", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");
    expect(workflow).toContain(`VERCEL_PROJECT_ID: ${correctLink.projectId}`);
    expect(workflow).toContain(`VERCEL_ORG_ID: ${correctLink.orgId}`);
    expect(workflow).toContain("secrets.VERCEL_TOKEN");
  });
});

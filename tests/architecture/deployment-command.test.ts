import { describe, expect, it } from "vitest";
import {
  aliasArgs, assertAliasMatches, assertBuildITWebDeployContext, assertProbeOk,
  deployArgs, inspectArgs, parseAliasTarget, parseDeploymentUrl,
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

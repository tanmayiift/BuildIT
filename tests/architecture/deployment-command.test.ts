import { describe, expect, it } from "vitest";
import { assertBuildITWebDeployContext } from "../../scripts/deploy-buildit-web.mjs";

const repoRoot = process.cwd();
const correctLink = {
  projectId: "prj_rU8IPaf1laMTTmQEhGun9mRxXmGA",
  orgId: "team_0C3dsIfWxzBINeWinBvtOLMC",
  projectName: "buildit-agentic-review",
};

describe("BuildIT web deployment command", () => {
  it("accepts only the repository root and dedicated BuildIT project", () => {
    expect(assertBuildITWebDeployContext({ cwd: repoRoot, repoRoot, link: correctLink })).toEqual({
      projectName: "buildit-agentic-review",
      teamName: "buildit-agentic-review",
      rootDirectory: "apps/web",
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
});

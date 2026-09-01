import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const expected = Object.freeze({
  projectId: "prj_rU8IPaf1laMTTmQEhGun9mRxXmGA",
  orgId: "team_0C3dsIfWxzBINeWinBvtOLMC",
  projectName: "buildit-agentic-review",
  teamName: "buildit-agentic-review",
});

export function assertBuildITWebDeployContext({ cwd, repoRoot, link }) {
  if (resolve(cwd) !== resolve(repoRoot)) throw new Error("buildit_web_deploy_must_run_from_repo_root");
  if (link.projectId !== expected.projectId) throw new Error("buildit_web_deploy_project_refused");
  if (link.orgId !== expected.orgId) throw new Error("buildit_web_deploy_team_refused");
  if (link.projectName !== expected.projectName) throw new Error("buildit_web_deploy_name_refused");
  const rootPackage = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const webPackage = JSON.parse(readFileSync(join(repoRoot, "apps/web/package.json"), "utf8"));
  if (rootPackage.name !== "buildit" || webPackage.name !== "@buildit/web") throw new Error("buildit_web_deploy_root_invalid");
  return { projectName: expected.projectName, teamName: expected.teamName, rootDirectory: "apps/web" };
}

function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const link = JSON.parse(readFileSync(join(repoRoot, ".vercel/project.json"), "utf8"));
  const contract = assertBuildITWebDeployContext({ cwd: process.cwd(), repoRoot, link });
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify({ valid: true, ...contract, deployStarted: false }));
    return;
  }
  const result = spawnSync("vercel", ["deploy", "--prod", "--yes", "--scope", expected.teamName], { cwd: repoRoot, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`buildit_web_deploy_failed:${result.status ?? "unknown"}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();

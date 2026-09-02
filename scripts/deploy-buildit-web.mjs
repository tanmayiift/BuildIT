import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const expected = Object.freeze({
  projectId: "prj_rU8IPaf1laMTTmQEhGun9mRxXmGA",
  orgId: "team_0C3dsIfWxzBINeWinBvtOLMC",
  projectName: "buildit-agentic-review",
  teamName: "buildit-agentic-review",
  // The GitHub App homepage, post-install redirect, and webhook URL all resolve through this
  // alias, so a deployment that is Ready but unaliased still serves the previous handlers.
  productionAlias: "buildit-agentic-review.vercel.app",
  probePath: "/reviews",
});

export function assertBuildITWebDeployContext({ cwd, repoRoot, link }) {
  if (resolve(cwd) !== resolve(repoRoot)) throw new Error("buildit_web_deploy_must_run_from_repo_root");
  if (link.projectId !== expected.projectId) throw new Error("buildit_web_deploy_project_refused");
  if (link.orgId !== expected.orgId) throw new Error("buildit_web_deploy_team_refused");
  if (link.projectName !== expected.projectName) throw new Error("buildit_web_deploy_name_refused");
  const rootPackage = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const webPackage = JSON.parse(readFileSync(join(repoRoot, "apps/web/package.json"), "utf8"));
  if (rootPackage.name !== "buildit" || webPackage.name !== "@buildit/web") throw new Error("buildit_web_deploy_root_invalid");
  return {
    projectName: expected.projectName,
    teamName: expected.teamName,
    rootDirectory: "apps/web",
    productionAlias: expected.productionAlias,
  };
}

export function deployArgs(teamName = expected.teamName) {
  return ["deploy", "--prod", "--yes", "--scope", teamName];
}

export function aliasArgs(deploymentUrl, alias = expected.productionAlias, teamName = expected.teamName) {
  if (!deploymentUrl) throw new Error("buildit_web_deploy_url_missing");
  return ["alias", "set", deploymentUrl, alias, "--scope", teamName];
}

export function inspectArgs(target, teamName = expected.teamName) {
  return ["inspect", target, "--scope", teamName];
}

// `vercel deploy` prints a JSON envelope on success. Fall back to the first deployment URL in
// the stream so a plain-text CLI mode still yields a target instead of silently skipping alias
// assignment — the exact failure this script exists to prevent.
export function parseDeploymentUrl(stdout) {
  const text = String(stdout ?? "");
  try {
    const parsed = JSON.parse(text);
    const url = parsed?.deployment?.url ?? parsed?.url;
    if (typeof url === "string" && url.startsWith("https://")) return url;
  } catch {
    // not a JSON envelope; fall through to scanning
  }
  const match = text.match(/https:\/\/[a-z0-9-]+\.vercel\.app/gi);
  if (!match?.length) throw new Error("buildit_web_deploy_url_unparsable");
  return match[match.length - 1];
}

// `vercel inspect <alias>` reports the deployment the alias currently resolves to.
export function parseAliasTarget(inspectOutput) {
  const match = String(inspectOutput ?? "").match(/^\s*url\s+(https:\/\/\S+)\s*$/mi);
  if (!match) throw new Error("buildit_web_deploy_alias_target_unreadable");
  return match[1];
}

function normalizeUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

export function assertAliasMatches({ aliasTarget, deploymentUrl }) {
  if (normalizeUrl(aliasTarget) !== normalizeUrl(deploymentUrl)) {
    throw new Error("buildit_web_deploy_alias_not_moved");
  }
  return true;
}

export function assertProbeOk({ status, url }) {
  if (status !== 200) throw new Error(`buildit_web_deploy_probe_failed:${status ?? "unknown"}:${url ?? ""}`);
  return true;
}

function vercel(args, cwd) {
  const result = spawnSync("vercel", args, { cwd, encoding: "utf8", shell: false });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) throw new Error(`buildit_web_deploy_failed:${result.status ?? "unknown"}`);
  return output;
}

async function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const link = JSON.parse(readFileSync(join(repoRoot, ".vercel/project.json"), "utf8"));
  const contract = assertBuildITWebDeployContext({ cwd: process.cwd(), repoRoot, link });
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify({ valid: true, ...contract, deployStarted: false }));
    return;
  }

  const deployOutput = vercel(deployArgs(), repoRoot);
  process.stdout.write(deployOutput);
  const deploymentUrl = parseDeploymentUrl(deployOutput);

  // A Ready deployment is not a released one. Assign the alias, then read it back: Vercel can
  // report the deployment as "current production" while the alias still points elsewhere.
  vercel(aliasArgs(deploymentUrl), repoRoot);
  const aliasTarget = parseAliasTarget(vercel(inspectArgs(contract.productionAlias), repoRoot));
  assertAliasMatches({ aliasTarget, deploymentUrl });

  const probeUrl = `https://${contract.productionAlias}${expected.probePath}`;
  const response = await fetch(probeUrl, { redirect: "follow" });
  assertProbeOk({ status: response.status, url: probeUrl });

  console.log(JSON.stringify({ released: true, deploymentUrl, alias: contract.productionAlias, probe: probeUrl, probeStatus: response.status }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error.message ?? error); process.exit(1); });
}

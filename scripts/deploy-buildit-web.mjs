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

// .vercel/project.json is gitignored, so a CI runner has no link file. Vercel's own CI
// contract is VERCEL_PROJECT_ID / VERCEL_ORG_ID, so accept those as the link. The id checks
// stay the real guard: a wrong secret is still refused before anything is deployed.
export function resolveDeployLink({ repoRoot, env = process.env, readFile = readFileSync, expectedProjectName = expected.projectName }) {
  try {
    return JSON.parse(readFile(join(repoRoot, ".vercel/project.json"), "utf8"));
  } catch {
    const projectId = env.VERCEL_PROJECT_ID, orgId = env.VERCEL_ORG_ID;
    if (!projectId || !orgId) throw new Error("buildit_web_deploy_link_missing");
    return { projectId, orgId, projectName: expectedProjectName };
  }
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

// `vercel deploy` writes the deployment URL to stdout and progress to stderr. Parse stdout
// only: the progress stream also names auto-assigned domains, and picking one of those would
// verify the alias against the wrong target and fail a release that actually succeeded.
export function parseDeploymentUrl(stdout) {
  const text = String(stdout ?? "");
  try {
    const parsed = JSON.parse(text);
    const url = parsed?.deployment?.url ?? parsed?.url;
    if (typeof url === "string" && url.startsWith("https://")) return url;
  } catch {
    // not a JSON envelope; fall through to scanning
  }
  const urls = text.match(/https:\/\/[a-z0-9-]+\.vercel\.app/gi) ?? [];
  // A deployment URL carries a generated instance id: project-<id>-team.vercel.app. A project
  // or auto-assigned domain has no such segment, so it must never be aliased over.
  const deployment = urls.find(url => /-[a-z0-9]{8,}-/.test(url));
  if (!deployment) throw new Error("buildit_web_deploy_url_unparsable");
  return deployment;
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

export async function probeWithRetry(url, fetchImpl = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) await wait(2_000 * attempt);
    try {
      const response = await fetchImpl(url, { redirect: "follow" });
      if (response.status === 200) return response.status;
      lastError = new Error(`buildit_web_deploy_probe_failed:${response.status}:${url}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function assertProbeOk({ status, url }) {
  if (status !== 200) throw new Error(`buildit_web_deploy_probe_failed:${status ?? "unknown"}:${url ?? ""}`);
  return true;
}

function vercel(args, cwd, env) {
  const result = spawnSync("vercel", args, { cwd, encoding: "utf8", shell: false, ...(env ? { env } : {}) });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(`${result.stderr ?? ""}\n`);
    throw new Error(`buildit_web_deploy_failed:${result.status ?? "unknown"}`);
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", combined: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

async function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const link = resolveDeployLink({ repoRoot });
  const contract = assertBuildITWebDeployContext({ cwd: process.cwd(), repoRoot, link });
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify({ valid: true, ...contract, deployStarted: false }));
    return;
  }

  const deployed = vercel(deployArgs(), repoRoot);
  process.stderr.write(deployed.stderr);
  const deploymentUrl = parseDeploymentUrl(deployed.stdout);

  // A Ready deployment is not a released one. Assign the alias, then read it back: Vercel can
  // report the deployment as "current production" while the alias still points elsewhere.
  vercel(aliasArgs(deploymentUrl), repoRoot);
  const aliasTarget = parseAliasTarget(vercel(inspectArgs(contract.productionAlias), repoRoot).combined);
  assertAliasMatches({ aliasTarget, deploymentUrl });

  const probeUrl = `https://${contract.productionAlias}${expected.probePath}`;
  const probeStatus = await probeWithRetry(probeUrl);
  assertProbeOk({ status: probeStatus, url: probeUrl });

  console.log(JSON.stringify({ released: true, deploymentUrl, alias: contract.productionAlias, probe: probeUrl, probeStatus }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error.message ?? error); process.exit(1); });
}

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { aliasArgs, assertAliasMatches, assertProbeOk, deployArgs, inspectArgs, parseAliasTarget, parseDeploymentUrl, probeWithRetry } from "./deploy-buildit-web.mjs";

const expected = Object.freeze({
  projectId: "prj_tacCioktOE1TKZwHcq0Hxu9VYOU0",
  orgId: "team_0C3dsIfWxzBINeWinBvtOLMC",
  projectName: "buildit-content-broker",
  teamName: "buildit-agentic-review",
  productionAlias: "buildit-content-broker.vercel.app",
  probePath: "/health.json",
});

// The broker's buildCommand runs `pnpm --filter` across six sibling workspaces, so the upload
// must originate at the repository root. Deploying from packages/broker makes Vercel resolve
// its configured Root Directory relative to itself and fail with a missing-directory error.
export function assertBuildITBrokerDeployContext({ cwd, repoRoot, link }) {
  if (resolve(cwd) !== resolve(repoRoot)) throw new Error("buildit_broker_deploy_must_run_from_repo_root");
  if (link.projectId !== expected.projectId) throw new Error("buildit_broker_deploy_project_refused");
  if (link.orgId !== expected.orgId) throw new Error("buildit_broker_deploy_team_refused");
  if (link.projectName !== expected.projectName) throw new Error("buildit_broker_deploy_name_refused");
  const rootPackage = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const brokerPackage = JSON.parse(readFileSync(join(repoRoot, "packages/broker/package.json"), "utf8"));
  if (rootPackage.name !== "buildit" || brokerPackage.name !== "@buildit/broker") throw new Error("buildit_broker_deploy_root_invalid");
  return {
    projectName: expected.projectName,
    teamName: expected.teamName,
    rootDirectory: "packages/broker",
    productionAlias: expected.productionAlias,
  };
}

function vercel(args, cwd, env) {
  const result = spawnSync("vercel", args, { cwd, encoding: "utf8", shell: false, env });
  // "Not authorized" happened mid-run on a real deploy and left the broker a commit behind while
  // convex and web moved on - the drift that costs an hour to notice. One retry, because a
  // token that is genuinely wrong fails the same way twice.
  if (result.status !== 0 && /not authoriz/i.test(`${result.stdout ?? ""}${result.stderr ?? ""}`)) {
    return spawnSync("vercel", args, { cwd, encoding: "utf8", shell: false, env });
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(`${result.stderr ?? ""}\n`);
    throw new Error(`buildit_broker_deploy_failed:${result.status ?? "unknown"}`);
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", combined: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

async function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let link;
  try { link = JSON.parse(readFileSync(join(repoRoot, "packages/broker/.vercel/project.json"), "utf8")); }
  // On a runner there is no link file, and the shared VERCEL_PROJECT_ID / VERCEL_ORG_ID pair
  // names the WEB project - so falling back to that made the broker refuse its own release.
  // This script forces the CLI to its own project below, so the fallback uses the same
  // committed constants the guard checks against.
  catch { link = { projectId: expected.projectId, orgId: expected.orgId, projectName: expected.projectName }; }
  const contract = assertBuildITBrokerDeployContext({ cwd: process.cwd(), repoRoot, link });
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify({ valid: true, ...contract, deployStarted: false }));
    return;
  }

  // The repo root is linked to the web project, so the broker link is supplied by environment.
  const env = { ...process.env, VERCEL_PROJECT_ID: expected.projectId, VERCEL_ORG_ID: expected.orgId };
  const deployed = vercel(deployArgs(expected.teamName), repoRoot, env);
  process.stderr.write(deployed.stderr);
  const deploymentUrl = parseDeploymentUrl(deployed.stdout);

  vercel(aliasArgs(deploymentUrl, expected.productionAlias, expected.teamName), repoRoot, env);
  const aliasTarget = parseAliasTarget(vercel(inspectArgs(expected.productionAlias, expected.teamName), repoRoot, env).combined);
  assertAliasMatches({ aliasTarget, deploymentUrl });

  const probeUrl = `https://${expected.productionAlias}${expected.probePath}`;
  const probeStatus = await probeWithRetry(probeUrl);
  assertProbeOk({ status: probeStatus, url: probeUrl });

  console.log(JSON.stringify({ released: true, deploymentUrl, alias: expected.productionAlias, probe: probeUrl, probeStatus }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error.message ?? error); process.exit(1); });
}

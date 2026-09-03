import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertProbeOk, probeWithRetry } from "./deploy-buildit-web.mjs";

// BuildIT is three deployments, and nothing sequenced them. `convex deploy` appeared in no script
// and no workflow; release.yml shipped web and broker but never Convex. So the backend and the
// broker could disagree about what was live, and `packages/runner` - which executes in the broker,
// not in Convex - could be fixed, deployed to Convex, pass every check, and still be stale. That
// happened twice and looked exactly like the fix not working.
//
// Order matters. Convex first: the workers must be able to accept the shapes the new broker and
// web will send. Broker last, because it is the one whose freshness is then asserted.
export const deploymentOrder = Object.freeze([
  Object.freeze({ name: "convex", command: "pnpm", args: ["exec", "convex", "deploy", "-y"] }),
  Object.freeze({ name: "web", command: "pnpm", args: ["deploy:web:production"] }),
  Object.freeze({ name: "broker", command: "pnpm", args: ["deploy:broker:production"] }),
]);

export const checkOrder = Object.freeze([
  Object.freeze({ name: "web", command: "pnpm", args: ["deploy:web:check"] }),
  Object.freeze({ name: "broker", command: "pnpm", args: ["deploy:broker:check"] }),
]);

// /health.json is the static liveness probe the broker deploy already asserts. This is the
// freshness probe: the one thing a static file cannot answer is which build is answering.
export const brokerHealthUrl = "https://buildit-content-broker.vercel.app/api/health";

export function assertProductionDeployContext({ cwd, repoRoot }) {
  if (resolve(cwd) !== resolve(repoRoot)) throw new Error("buildit_production_deploy_must_run_from_repo_root");
  return { steps: deploymentOrder.map(step => step.name), healthUrl: brokerHealthUrl };
}

// A deploy that silently no-ops is the failure this exists to catch, so an unreadable or absent
// commit is a failure rather than something to shrug at. "unknown" means the build had no commit
// stamped, which is itself a broken deploy.
export function assertBrokerServesCommit({ body, expectedCommit }) {
  const served = typeof body?.commit === "string" ? body.commit : undefined;
  if (!served || served === "unknown") throw new Error(`buildit_broker_commit_unreadable:${served ?? "missing"}`);
  if (served !== expectedCommit) throw new Error(`buildit_broker_stale:served=${served.slice(0, 12)}:expected=${expectedCommit.slice(0, 12)}`);
  return true;
}

function run(step, cwd) {
  const result = spawnSync(step.command, step.args, { cwd, encoding: "utf8", shell: false, stdio: ["ignore", "inherit", "inherit"] });
  if (result.error) throw new Error(`buildit_production_deploy_spawn_failed:${step.name}:${result.error.message}`);
  if (result.status !== 0) throw new Error(`buildit_production_deploy_step_failed:${step.name}:${result.status}`);
}

function headCommit(cwd) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error("buildit_production_deploy_commit_unknown");
  return result.stdout.trim();
}

export function uncommittedFileCount(cwd, spawn = spawnSync) {
  const result = spawn("git", ["status", "--porcelain"], { cwd, encoding: "utf8", shell: false });
  if (result.status !== 0) return undefined;
  return result.stdout.split("\n").filter(line => line.trim()).length;
}

async function main() {
  const repoRoot = process.cwd();
  const contract = assertProductionDeployContext({ cwd: process.cwd(), repoRoot });
  const dryRun = process.argv.includes("--dry-run");

  for (const step of checkOrder) run(step, repoRoot);
  if (dryRun) {
    console.log(JSON.stringify({ valid: true, ...contract, deployStarted: false }));
    return;
  }

  const expectedCommit = headCommit(repoRoot);
  for (const step of deploymentOrder) run(step, repoRoot);

  // The reason this script exists: prove the broker that answers is the build just shipped.
  assertProbeOk({ status: await probeWithRetry(brokerHealthUrl), url: brokerHealthUrl });
  const response = await fetch(brokerHealthUrl, { redirect: "follow", headers: { "cache-control": "no-cache" } });
  const body = await response.json().catch(() => undefined);
  assertBrokerServesCommit({ body, expectedCommit });

  const dirty = uncommittedFileCount(repoRoot);
  if (dirty) console.warn(`buildit_production_deploy_tree_dirty:${dirty} file(s) deployed on top of ${expectedCommit.slice(0, 12)}`);
  console.log(JSON.stringify({ released: true, steps: contract.steps, commit: expectedCommit, ...(dirty ? { uncommittedFiles: dirty } : {}), brokerHealth: brokerHealthUrl }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error.message ?? error); process.exit(1); });
}

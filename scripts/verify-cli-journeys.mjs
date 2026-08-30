import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, ".."),
  executable = resolve(root, "apps/cli/dist/index.js");

function run(args) {
  return spawnSync(process.execPath, [executable, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { HOME: process.env.HOME, PATH: process.env.PATH, GH_HOST: process.env.GH_HOST },
  });
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function gitStatus() {
  const result = spawnSync("git", ["status", "--porcelain=v1"], { cwd: root, encoding: "utf8" });
  assert(result.status === 0, "cli_journey_git_status_failed");
  return result.stdout;
}
function jsonLines(value) {
  return value.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

const help = run(["--help"]);
assert(help.status === 0, "cli_journey_help_failed");
assert(help.stdout.includes("BuildIT CLI"), "cli_journey_help_missing_title");
assert(help.stdout.includes("Autofix is limited to a stacked PR"), "cli_journey_help_missing_merge_boundary");

const doctor = run(["doctor", "--json"]), doctorResult = JSON.parse(doctor.stdout);
assert([0, 3].includes(doctor.status ?? 1), "cli_journey_doctor_exit_invalid");
assert(typeof doctorResult.node?.ok === "boolean", "cli_journey_doctor_node_invalid");
assert(typeof doctorResult.git?.ok === "boolean", "cli_journey_doctor_git_invalid");
assert(!doctor.stdout.toLowerCase().includes("api_key"), "cli_journey_doctor_secret_name_exposed");

const before = gitStatus(),
  review = run(["review", "--dir", "apps/cli", "--json"]),
  after = gitStatus(),
  events = jsonLines(review.stdout),
  session = events.find((item) => item.type === "session"),
  plan = events.find((item) => item.type === "command_plan"),
  completion = events.find((item) => item.type === "review_completed");
assert(review.status === 3, "cli_journey_review_consent_exit_invalid");
assert(session?.version === 1 && session.data.scope === "apps/cli", "cli_journey_scope_invalid");
assert(plan?.data.uploadsFiles === false, "cli_journey_upload_boundary_invalid");
assert(plan?.data.estimatedProviderCostUsd === 0, "cli_journey_cost_invalid");
assert(plan?.data.requiresConfirmation === true, "cli_journey_consent_missing");
assert(completion?.data.status === "consent_required", "cli_journey_consent_state_invalid");
assert(completion?.data.workingTreeModified === false, "cli_journey_mutation_claim_invalid");
assert(before === after, "cli_journey_worktree_changed");

process.stdout.write(JSON.stringify({ connected: true, journeys: { productReviewer: "help_and_doctor_passed", developer: "scoped_plan_and_consent_passed" }, worktreeUnchanged: true, providerCostUsd: 0 }) + "\n");

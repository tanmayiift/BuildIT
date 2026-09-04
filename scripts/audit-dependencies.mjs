// pnpm audit calls registry.npmjs.org, and the release gate hard-failed when that call timed out -
// twice in a row on CI, which is not a flake but a dependency on someone else's uptime sitting
// inside a required check.
//
// The gate stays strict: a real advisory still fails, and an audit that cannot run still fails.
// What changes is that a timeout is retried before it counts, and the failure says which of the two
// happened - so nobody has to read a stack trace to learn whether their build found a vulnerability
// or npm was slow.
import { spawnSync } from "node:child_process";

const attempts = 3;
const networkFailure = /(?:socket|network|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|FetchError|request to .* failed)/i;

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const result = spawnSync("pnpm", ["audit", "--prod", "--audit-level", "high"], { encoding: "utf8", shell: false });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0) {
    console.log("buildit_audit_clean");
    process.exit(0);
  }
  // An advisory is the answer, not an error. Retrying would not change it and would hide it.
  if (!networkFailure.test(output)) {
    console.error("buildit_audit_found_advisories");
    console.error(output.split("\n").filter(Boolean).slice(-40).join("\n"));
    process.exit(1);
  }
  console.error(`buildit_audit_registry_unreachable attempt=${attempt}/${attempts}`);
  if (attempt < attempts) {
    // Sequential and short: the registry is either coming back or it is not.
    spawnSync("sleep", [String(attempt * 5)], { shell: false });
  }
}

// Still strict. An audit that could not run has not cleared anything, and saying so plainly is the
// difference between a legible failure and a stack trace nobody reads.
console.error("buildit_audit_registry_unreachable_final");
console.error("The npm advisory registry did not answer after 3 attempts. This is not a vulnerability report - it is a failure to obtain one, and the gate stays closed until it can.");
process.exit(1);

// pnpm eval:compare <before.json> <after.json>
//
// Answers the one question a maintainer asks before shipping a prompt change: is this better or
// worse than what is in production? A single run cannot answer it, and a blended score answers it
// misleadingly - 0.83 to 0.81 says nothing about whether the thing you fixed is fixed. This prints
// the movement case by case and names the trade it refuses to make.
import { readFileSync } from "node:fs";
import { compareVersions, versionRegressed, type CaseOutcome, type VersionRun } from "./versionComparison.js";

const outcomes = new Set<CaseOutcome["outcome"]>(["detected", "missed", "false_blocking", "clean_pass"]);

function loadRun(path: string): VersionRun {
  const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  // Validated rather than trusted: a run file with a typo'd outcome would silently compare as
  // "unchanged" and report an improvement that never happened.
  if (typeof value.setVersion !== "string" || typeof value.promptVersion !== "string") {
    throw new Error(`eval_run_identity_missing:${path}`);
  }
  if (!Array.isArray(value.cases) || !value.cases.length) throw new Error(`eval_run_cases_missing:${path}`);
  const cases = value.cases.map((item, index) => {
    const row = item as Record<string, unknown>;
    if (typeof row.caseId !== "string" || !row.caseId) throw new Error(`eval_run_case_id_missing:${path}:${index}`);
    if (typeof row.outcome !== "string" || !outcomes.has(row.outcome as CaseOutcome["outcome"])) {
      throw new Error(`eval_run_outcome_invalid:${path}:${row.caseId}:${String(row.outcome)}`);
    }
    return { caseId: row.caseId, outcome: row.outcome as CaseOutcome["outcome"] };
  });
  const seen = new Set(cases.map(item => item.caseId));
  if (seen.size !== cases.length) throw new Error(`eval_run_case_duplicated:${path}`);
  return { setVersion: value.setVersion, promptVersion: value.promptVersion, cases };
}

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error("usage: pnpm eval:compare <before.json> <after.json>");
  process.exit(2);
}

const comparison = compareVersions(loadRun(beforePath), loadRun(afterPath));
const verdict = versionRegressed(comparison);

console.log(`${comparison.from} → ${comparison.to}  (${comparison.setVersion}, ${comparison.comparedCases} cases compared)`);
console.log("");
for (const movement of comparison.movements) {
  const mark = movement.direction === "improved" ? "+" : movement.direction === "regressed" ? "-" : " ";
  const arrow = movement.direction === "unchanged" ? movement.after : `${movement.before} → ${movement.after}`;
  console.log(`  ${mark} ${movement.caseId.padEnd(42)} ${arrow}`);
}
console.log("");
console.log(`  improved  ${comparison.improved.length}`);
console.log(`  regressed ${comparison.regressed.length}`);
console.log(`  unchanged ${comparison.unchanged}`);
if (comparison.onlyInBefore.length) console.log(`  dropped   ${comparison.onlyInBefore.join(", ")}`);
if (comparison.onlyInAfter.length) console.log(`  added     ${comparison.onlyInAfter.join(", ")} (not compared: no earlier result)`);
if (comparison.newFalseBlocking.length) console.log(`  NEW FALSE BLOCKING: ${comparison.newFalseBlocking.map(item => item.caseId).join(", ")}`);
console.log("");
console.log(verdict.regressed ? `REGRESSED — ${verdict.because}` : `no regression — ${verdict.because}`);
process.exit(verdict.regressed ? 1 : 0);

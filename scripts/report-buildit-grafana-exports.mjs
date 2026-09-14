// Read-only comparison of captured native UI exports. No token or network access is used.
import { readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { compareGrafanaExportGroups } from "./lib/grafana-verification.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const paths = process.argv.slice(2);
if (paths.length !== 2) throw new Error("Provide the current and legacy BuildIT native UI export JSON paths, in that order.");
async function readExport(path) {
  const absolute = await realpath(resolve(root, path));
  if (!absolute.startsWith(`${root}${sep}`) || !absolute.endsWith(".json")) throw new Error("buildit_grafana_export_path_refused");
  const content = await readFile(absolute, "utf8");
  let document;
  try { document = JSON.parse(content); } catch { throw new Error("buildit_grafana_export_invalid"); }
  return { document, path: absolute.slice(root.length + 1), sha256: createHash("sha256").update(content).digest("hex") };
}
const [current, legacy] = await Promise.all(paths.map(readExport));
const source = await readFile(resolve(root, "observability/alerts.yml"), "utf8");
const desired = source.split(/^ {6}- alert: /m).slice(1).map(block => {
  const field = name => block.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, "m"))?.[1]?.trim();
  return { alert: block.split("\n")[0].trim(), expr: field("expr"), for: field("for"), severity: block.match(/severity:\s*([a-z]+)/)?.[1],
    summary: field("summary"), action: field("action"), runbook: field("runbook_url") };
});
if (!desired.length) throw new Error("buildit_grafana_rules_empty");
const report = compareGrafanaExportGroups({ desired, currentExport: current.document, legacyExport: legacy.document });
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), sources: {
  current: { path: current.path, sha256: current.sha256 }, legacy: { path: legacy.path, sha256: legacy.sha256 },
  desired: { path: "observability/alerts.yml", sha256: createHash("sha256").update(source).digest("hex") },
}, ...report }, null, 2));
// An offline comparison cannot satisfy a live release or cleanup gate.
process.exitCode = 1;

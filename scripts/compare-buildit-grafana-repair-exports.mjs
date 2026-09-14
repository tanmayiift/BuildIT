// Explicit input files only. This command writes no files and performs no network requests.
import { readFile, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { compareGrafanaRepairExports } from "./lib/grafana-export-repair-diff.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function readExport(path) {
  const absolute = await realpath(resolve(root, path));
  if (!absolute.startsWith(`${root}${sep}`) || !absolute.endsWith(".json")) throw new Error("buildit_grafana_export_path_refused");
  const metadata = await stat(absolute);
  if (!metadata.isFile() || metadata.size > 2 * 1024 * 1024) throw new Error("buildit_grafana_export_size_refused");
  const content = await readFile(absolute, "utf8");
  if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error("buildit_grafana_export_size_refused");
  return { path: absolute.slice(root.length + 1), sha256: createHash("sha256").update(content).digest("hex"), document: JSON.parse(content) };
}

try {
  const paths = process.argv.slice(2);
  if (paths.length !== 2) throw new Error("Provide before and after native current-group JSON exports, in that order.");
  const [before, after] = await Promise.all(paths.map(readExport));
  const report = compareGrafanaRepairExports(before.document, after.document);
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), sources: {
    before: { path: before.path, sha256: before.sha256 }, after: { path: after.path, sha256: after.sha256 },
  }, ...report }, null, 2));
  process.exitCode = report.repairMatches ? 0 : 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}

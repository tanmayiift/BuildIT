import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import { adaptAacrReview, adaptSweBenchAutofix, type BenchmarkSource } from "./benchmarkAdapters.js";
import { officialPopulation } from "./releaseEvidence.js";

const root = resolve(process.cwd(), ".local", "benchmarks");
await mkdir(root, { recursive: true });
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function pinnedArtifact(name: string) {
  const artifact = officialPopulation.artifacts.find(item => item.name === name);
  if (!artifact) throw new Error("population_artifact_missing");
  const path = resolve(root, `${artifact.sha256}.data`);
  let bytes: Uint8Array;
  try { bytes = await readFile(path); }
  catch {
    const response = await fetch(artifact.url, { redirect: "follow" });
    if (!response.ok) throw new Error(`population_download_failed:${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
    if (sha256(bytes) !== artifact.sha256) throw new Error("population_checksum_mismatch");
    await writeFile(path, bytes, { mode: 0o600 });
  }
  if (sha256(bytes) !== artifact.sha256) throw new Error("population_checksum_mismatch");
  return { artifact, path, bytes };
}

const positive = await pinnedArtifact("AACR-Bench positive"), negative = await pinnedArtifact("AACR-Bench negative");
const aacrSource = (artifact: typeof positive.artifact): BenchmarkSource => ({ benchmark: "AACR-Bench", version: artifact.immutableRevision, license: "Apache-2.0", datasetSha256: artifact.sha256 });
let aacrComments = 0;
for (const item of [positive, negative]) {
  const rows = JSON.parse(new TextDecoder().decode(item.bytes)) as unknown;
  if (!Array.isArray(rows) || rows.length !== item.artifact.cases) throw new Error("aacr_population_count_mismatch");
  for (const row of rows) aacrComments += adaptAacrReview(row, aacrSource(item.artifact)).gold.comments.length;
}

const swe = await pinnedArtifact("SWE-bench Verified");
const rows = await parquetReadObjects({ file: await asyncBufferFromFile(swe.path) });
if (rows.length !== swe.artifact.cases) throw new Error("swe_population_count_mismatch");
const sweSource: BenchmarkSource = { benchmark: "SWE-bench Verified", version: swe.artifact.immutableRevision, license: "MIT", datasetSha256: swe.artifact.sha256 };
for (const row of rows) adaptSweBenchAutofix(row, sweSource);

process.stdout.write(`${JSON.stringify({ passed: true, sourceFree: true, populations: { aacrPositive: positive.artifact.cases, aacrNegative: negative.artifact.cases, aacrComments, sweVerified: rows.length }, immutable: true, checksumsVerified: true, licenses: ["Apache-2.0", "MIT"], cachedUnderIgnoredDirectory: true })}\n`);

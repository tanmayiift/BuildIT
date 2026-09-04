// The release gate used `pnpm audit`, which POSTs the dependency tree to
// registry.npmjs.org/-/npm/v1/security/audits. That endpoint stopped answering: 251 seconds and no
// response, reproducibly, and the same for /security/advisories/bulk with a one-package payload,
// while a GET to the same host returns in 0.13s. It was not a flake and not payload size - it was a
// required check depending on someone else's API being up, and roughly one CI run in five died on
// it after burning nine to twelve minutes on retries that could never succeed.
//
// So the gate now reads the same vulnerability data BuildIT already scans customers' code with.
// packages/runner/image/Dockerfile pins osv-scanner 2.2.3 and the OSV npm database; this reuses
// both, and reuses the exit-code contract packages/runner/src/vercelSandbox.ts already encodes.
//
// The gate stays strict, and strictness now means two things rather than one. A real advisory fails
// and is never retried away. And a database too old to be trusted also fails - because a cached
// fallback that never expires is just a gate that silently stops finding things, which is worse
// than a gate that is loudly down.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { advisoriesFromReport, databaseAgeVerdict, databaseChoice, scanVerdict } from "./lib/audit-decisions.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

// Pinned, and verified on every run. These are the checksums Google publishes in
// osv-scanner_SHA256SUMS for the tag, so a substituted binary fails before it can scan anything.
const scannerVersion = "2.2.3";
const scannerChecksums = {
  "linux-x64": ["osv-scanner_linux_amd64", "8cdb138b36cdb9c99c455cafb32a1c83e1823448dc00e1c8ab9afe474a5e93f0"],
  "linux-arm64": ["osv-scanner_linux_arm64", "7033a49a9566da169529b40bb12e90752b1498151d9e1927506781d36019f689"],
  "darwin-x64": ["osv-scanner_darwin_amd64", "f20893dffc30411babf816e7799265c671ef6a5c8907408c889f00cd26d13a38"],
  "darwin-arm64": ["osv-scanner_darwin_arm64", "2df8fe87db40ec268884bc2bfc984d2ea4f0de528a0c54803d20f7dccf307002"],
};

// Seven days (from audit-decisions.mjs) is the point past which "we checked" stops being a true
// statement about current advisories. OSV refreshes several times a day.
const databaseUrl = "https://osv-vulnerabilities.storage.googleapis.com/npm/all.zip";

// osv-scanner looks for <cacheDirectory>/osv-scanner/<ecosystem>/all.zip - the same layout the
// runner image builds. Keeping it identical means the gate and the sandbox cannot drift.
const cacheRoot = process.env.RUNNER_TEMP
  ? join(process.env.RUNNER_TEMP, "buildit-osv")
  : join(repositoryRoot, "node_modules", ".cache", "buildit-osv");
const databaseDirectory = join(cacheRoot, "db");
const databasePath = join(databaseDirectory, "osv-scanner", "npm", "all.zip");
const databaseMetaPath = join(databaseDirectory, "npm-meta.json");

function fail(code, detail) {
  console.error(code);
  if (detail) console.error(detail);
  process.exit(1);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// curl rather than fetch: this runs on whatever Node the gate happens to have, and a 222MB body
// streamed to disk should not pass through the heap.
function download(url, destination, timeoutSeconds) {
  mkdirSync(dirname(destination), { recursive: true });
  const result = spawnSync("curl", ["-sSL", "--fail", "--max-time", String(timeoutSeconds),
    "-o", destination, url], { encoding: "utf8", shell: false });
  return result.status === 0;
}

function ensureScanner() {
  const key = `${process.platform}-${process.arch}`;
  const entry = scannerChecksums[key];
  if (!entry) fail("buildit_audit_platform_unsupported", `No pinned osv-scanner build for ${key}.`);
  const [asset, expected] = entry;
  const binary = join(cacheRoot, "bin", `osv-scanner-${scannerVersion}`);

  if (existsSync(binary) && sha256(binary) === expected) return binary;

  const url = `https://github.com/google/osv-scanner/releases/download/v${scannerVersion}/${asset}`;
  if (!download(url, binary, 300)) {
    fail("buildit_audit_scanner_unavailable",
      `Could not download osv-scanner ${scannerVersion} from ${url}. The gate cannot scan without it.`);
  }
  const actual = sha256(binary);
  if (actual !== expected) {
    fail("buildit_audit_scanner_checksum_mismatch",
      `Expected ${expected} for ${asset}, got ${actual}. Refusing to run an unverified scanner.`);
  }
  chmodSync(binary, 0o755);
  return binary;
}

// Returns the age of the database that will actually be scanned against. A download failure is
// survivable - that is the whole point of the cache - but only if what is on disk is still fresh
// enough to mean something, which assertFreshness decides separately.
function ensureDatabase() {
  const cached = existsSync(databaseMetaPath) && existsSync(databasePath)
    ? JSON.parse(readFileSync(databaseMetaPath, "utf8")) : null;

  const head = spawnSync("curl", ["-sSI", "--fail", "--max-time", "60", databaseUrl],
    { encoding: "utf8", shell: false });
  const headers = head.status === 0 ? head.stdout : "";
  const generation = headers.match(/^x-goog-generation:\s*(\d+)/im)?.[1];
  const lastModified = headers.match(/^last-modified:\s*(.+)$/im)?.[1]?.trim();

  // Already holding the exact object the bucket is serving? Then no 222MB download.
  if (databaseChoice({ cached, liveGeneration: generation, downloaded: false }).use === "cache") return cached;

  const downloaded = Boolean(generation && lastModified && download(databaseUrl, databasePath, 900));
  const choice = databaseChoice({ cached, liveGeneration: generation, downloaded });

  if (choice.use === "downloaded") {
    const meta = { generation, lastModified, retrievedAt: new Date().toISOString() };
    writeFileSync(databaseMetaPath, `${JSON.stringify(meta, null, 2)}\n`);
    return meta;
  }
  if (choice.use === "cache") {
    console.error("buildit_audit_database_download_failed_using_cache");
    return cached;
  }
  fail(choice.code,
    `Could not download the OSV npm database from ${databaseUrl} and no cached copy exists. This is not a vulnerability report - it is a failure to obtain one, and the gate stays closed until it can.`);
}

function assertFreshness(meta) {
  const verdict = databaseAgeVerdict({ lastModified: meta.lastModified, now: Date.now() });
  if (!verdict.ok) {
    const days = verdict.ageMs === undefined ? "an unreadable number of" : Math.floor(verdict.ageMs / (24 * 60 * 60 * 1000));
    fail(verdict.code,
      `The OSV npm database on disk is ${days} days old and could not be refreshed. A cached database that never expires is a gate that has quietly stopped finding things, so this fails rather than passing on stale data.`);
  }
  return verdict.ageMs;
}

function scan(binary) {
  const report = join(cacheRoot, "npm-report.json");
  // A report left by an earlier run would otherwise be read as this run's answer.
  rmSync(report, { force: true });
  const result = spawnSync(binary, ["scan", "source", "--offline", "--no-resolve",
    "--format", "json", "--output", report, "--lockfile", join(repositoryRoot, "pnpm-lock.yaml")], {
    encoding: "utf8", shell: false, cwd: repositoryRoot,
    env: { ...process.env, OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY: databaseDirectory },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  const verdict = scanVerdict({ status: result.status ?? -1, output, reportExists: existsSync(report) });
  if (verdict.kind === "empty") return [];
  if (verdict.kind === "failed") {
    fail(verdict.code, output.split("\n").filter(Boolean).slice(-20).join("\n"));
  }
  return advisoriesFromReport(JSON.parse(readFileSync(report, "utf8")));
}

const binary = ensureScanner();
const meta = ensureDatabase();
const ageMs = assertFreshness(meta);
const advisories = scan(binary);

if (advisories.length) {
  // An advisory is the answer, not an error. Retrying would not change it and would hide it.
  console.error("buildit_audit_found_advisories");
  for (const item of advisories) console.error(`  ${item.package}@${item.version}  ${item.id}  ${item.summary}`);
  process.exit(1);
}

const ageHours = Math.round(ageMs / (60 * 60 * 1000));
console.log(`buildit_audit_clean database_generation=${meta.generation} database_age_hours=${ageHours}`);

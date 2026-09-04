// The decisions the dependency gate makes, separated from the downloading and process-spawning so
// they can be proved without a network. Every one of these branches is a way the gate can be wrong
// in a direction that matters: passing when it did not really check, or failing on something that
// is not a vulnerability.

// A cached database is what makes the gate survive an OSV outage. It is also what would let the
// gate quietly stop finding things, so the cache and its expiry are one decision, not two.
export const maximumDatabaseAgeMs = 7 * 24 * 60 * 60 * 1000;

export function databaseAgeVerdict({ lastModified, now, maximumAgeMs = maximumDatabaseAgeMs }) {
  const modified = Date.parse(lastModified ?? "");
  if (!Number.isFinite(modified)) {
    return { ok: false, code: "buildit_audit_database_unreadable", ageMs: undefined };
  }
  const ageMs = now - modified;
  if (ageMs > maximumAgeMs) {
    return { ok: false, code: "buildit_audit_database_stale", ageMs };
  }
  return { ok: true, ageMs };
}

// osv-scanner's exit codes, read the same way packages/runner/src/vercelSandbox.ts reads them.
// 128 with no package sources is a complete scan of nothing - a repository with no manifest has no
// dependency vulnerabilities, and saying so is different from claiming the scanner was down.
export function scanVerdict({ status, output = "", reportExists }) {
  if (status === 128 && /No package sources found/.test(output)) {
    return { kind: "empty" };
  }
  if (![0, 1].includes(status)) {
    return { kind: "failed", code: "buildit_audit_scanner_failed" };
  }
  if (!reportExists) {
    return { kind: "failed", code: "buildit_audit_report_missing" };
  }
  return { kind: "report" };
}

export function advisoriesFromReport(parsed) {
  const advisories = [];
  for (const entry of parsed?.results ?? []) {
    for (const item of entry?.packages ?? []) {
      for (const vulnerability of item?.vulnerabilities ?? []) {
        advisories.push({
          package: item.package?.name,
          version: item.package?.version,
          id: vulnerability.id,
          summary: (vulnerability.summary ?? "").slice(0, 100),
        });
      }
    }
  }
  return advisories;
}

// Which database to scan against, given what the bucket says and what is already on disk. Returning
// the cached copy on a download failure is deliberate; letting it be *stale* is not, which is why
// the age verdict is a separate gate applied to whatever this returns.
export function databaseChoice({ cached, liveGeneration, downloaded }) {
  if (cached && liveGeneration && cached.generation === liveGeneration) {
    return { use: "cache", reason: "current" };
  }
  if (downloaded) return { use: "downloaded" };
  if (cached) return { use: "cache", reason: "download_failed" };
  return { use: "none", code: "buildit_audit_database_unavailable" };
}

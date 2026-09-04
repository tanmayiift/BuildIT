import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error - the gate is a plain script, deliberately runnable without a build step.
import { advisoriesFromReport, databaseAgeVerdict, databaseChoice, maximumDatabaseAgeMs, scanVerdict } from "../../scripts/lib/audit-decisions.mjs";

// The release gate used `pnpm audit`, which POSTs to registry.npmjs.org's advisory endpoint. That
// endpoint stopped answering - 251 seconds and no response, reproducibly, and the same for the
// newer bulk endpoint with a one-package payload, while a GET to the same host returned in 0.13s.
// Roughly one CI run in five died on it after burning nine to twelve minutes on retries that could
// never succeed, and it was read as flakiness for days.
//
// The replacement scans the same OSV database BuildIT already uses on customers' code. That buys
// reliability by keeping a local copy, which introduces the failure mode worth guarding hardest:
// a cached database that never expires is not a working gate, it is a gate that has silently
// stopped finding things. These tests exist mostly to hold that line.

const day = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-09-04T12:00:00Z");
const at = (daysAgo: number) => new Date(now - daysAgo * day).toUTCString();

describe("how old a database may be before the gate stops believing it", () => {
  it("accepts a database refreshed today", () => {
    expect(databaseAgeVerdict({ lastModified: at(0), now })).toMatchObject({ ok: true });
  });

  it("accepts one within the window", () => {
    expect(databaseAgeVerdict({ lastModified: at(6), now }).ok).toBe(true);
  });

  it("refuses one past the window rather than passing on stale data", () => {
    const verdict = databaseAgeVerdict({ lastModified: at(8), now });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("buildit_audit_database_stale");
  });

  it("refuses a date it cannot read, rather than treating it as fresh", () => {
    for (const value of [undefined, "", "whenever", "not-a-date"]) {
      const verdict = databaseAgeVerdict({ lastModified: value, now });
      expect(verdict.ok).toBe(false);
      expect(verdict.code).toBe("buildit_audit_database_unreadable");
    }
  });

  it("keeps the window at a week, so nobody widens it by accident", () => {
    expect(maximumDatabaseAgeMs).toBe(7 * day);
  });
});

describe("which database the gate scans against", () => {
  const cached = { generation: "100", lastModified: at(1) };

  it("reuses the cache when it already holds what the bucket is serving", () => {
    expect(databaseChoice({ cached, liveGeneration: "100", downloaded: false }))
      .toMatchObject({ use: "cache", reason: "current" });
  });

  it("takes the download when the bucket has moved on", () => {
    expect(databaseChoice({ cached, liveGeneration: "200", downloaded: true }).use).toBe("downloaded");
  });

  // The whole point of the cache: an OSV outage must not fail a build. The age check is what
  // stops that from becoming permanent.
  it("falls back to the cache when the download fails", () => {
    expect(databaseChoice({ cached, liveGeneration: "200", downloaded: false }))
      .toMatchObject({ use: "cache", reason: "download_failed" });
  });

  it("has nothing to offer when there is no cache and no download", () => {
    expect(databaseChoice({ cached: null, liveGeneration: undefined, downloaded: false }))
      .toMatchObject({ use: "none", code: "buildit_audit_database_unavailable" });
  });
});

describe("reading what the scanner did", () => {
  // The same contract packages/runner/src/vercelSandbox.ts relies on.
  it("treats a clean scan and a findings scan as answers", () => {
    expect(scanVerdict({ status: 0, reportExists: true }).kind).toBe("report");
    expect(scanVerdict({ status: 1, reportExists: true }).kind).toBe("report");
  });

  it("treats no package sources as a complete empty scan, not an outage", () => {
    expect(scanVerdict({ status: 128, output: "No package sources found", reportExists: false }).kind).toBe("empty");
  });

  it("refuses every other exit code", () => {
    for (const status of [2, 127, 128, -1]) {
      const verdict = scanVerdict({ status, output: "something else", reportExists: true });
      expect(verdict.kind).toBe("failed");
    }
  });

  it("refuses a run that produced no report, whatever it exited with", () => {
    expect(scanVerdict({ status: 0, reportExists: false }))
      .toMatchObject({ kind: "failed", code: "buildit_audit_report_missing" });
  });
});

describe("what counts as an advisory", () => {
  it("finds every vulnerability across packages and results", () => {
    const advisories = advisoriesFromReport({ results: [
      { packages: [
        { package: { name: "left-pad", version: "1.0.0" }, vulnerabilities: [{ id: "GHSA-1", summary: "bad" }] },
        { package: { name: "safe", version: "2.0.0" }, vulnerabilities: [] },
      ] },
      { packages: [{ package: { name: "tar", version: "3.0.0" },
        vulnerabilities: [{ id: "GHSA-2", summary: "worse" }, { id: "GHSA-3", summary: "worst" }] }] },
    ] });
    expect(advisories).toHaveLength(3);
    expect(advisories.map((item: { id: string }) => item.id)).toEqual(["GHSA-1", "GHSA-2", "GHSA-3"]);
  });

  it("reads an empty or malformed report as no advisories rather than throwing", () => {
    for (const value of [{}, { results: [] }, { results: [{}] }, { results: [{ packages: [{}] }] }, null]) {
      expect(advisoriesFromReport(value)).toEqual([]);
    }
  });
});

// The gate is only as good as the pins. A drifting scanner version or an unverified download is the
// same class of problem as the endpoint that started this.
describe("what the gate pins", () => {
  const script = readFileSync(join(import.meta.dirname, "../../scripts/audit-dependencies.mjs"), "utf8");

  it("pins the scanner to the version the sandbox image uses", () => {
    const image = readFileSync(join(import.meta.dirname, "../../packages/runner/image/Dockerfile"), "utf8");
    const pinned = script.match(/const scannerVersion = "([\d.]+)"/)?.[1];
    expect(pinned).toBeDefined();
    expect(image).toContain(`dev.buildit.osv-scanner="${pinned}"`);
  });

  it("verifies the binary it downloaded before running it", () => {
    expect(script).toContain("buildit_audit_scanner_checksum_mismatch");
    expect(script).toMatch(/sha256\(binary\) === expected/);
  });

  // Guarding the prose would ban the comment that explains why the endpoint was dropped, so this
  // reads the code with comments stripped: what the gate *runs*, not what it says about itself.
  it("no longer calls the npm advisory endpoint that caused this", () => {
    const code = script.replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("security/audits");
    expect(code).not.toContain("security/advisories");
    expect(code).not.toMatch(/spawnSync\(\s*"pnpm"/);
    // And it does run the scanner it pinned.
    expect(code).toContain("OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY");
  });
});

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error - executable scripts do not require a TypeScript build.
import { databaseChoice } from "../../scripts/lib/audit-decisions.mjs";

// Run the real orchestration with an in-memory filesystem and network. Decision-only
// tests missed that the caller mistook the fallback decision for permission to skip refresh.
function refresh({ downloadOk = true, generation = "200" } = {}) {
  const files = new Map<string, string>([
    ["db.zip", "valid-old-archive"],
    ["meta.json", JSON.stringify({ generation: "100", lastModified: "2026-08-01" })],
  ]);
  const download = vi.fn((_url: string, destination: string) => {
    files.set(destination, downloadOk ? "valid-new-archive" : "partial-download");
    return downloadOk;
  });
  const script = readFileSync(new URL("../../scripts/audit-dependencies.mjs", import.meta.url), "utf8");
  const body = script.slice(script.indexOf("function ensureDatabase()"), script.indexOf("function assertFreshness("));
  const meta = runInNewContext(`${body}\nensureDatabase();`, {
    existsSync: (path: string) => files.has(path), readFileSync: (path: string) => files.get(path),
    writeFileSync: (path: string, value: string) => files.set(path, value),
    renameSync: (from: string, to: string) => { files.set(to, files.get(from)!); files.delete(from); },
    rmSync: (path: string) => files.delete(path), databasePath: "db.zip", databaseMetaPath: "meta.json",
    databaseUrl: "https://osv-vulnerabilities.storage.googleapis.com/npm/all.zip", databaseChoice, download,
    spawnSync: () => ({ status: 0, stdout: `x-goog-generation: ${generation}\nlast-modified: Mon, 14 Sep 2026 00:00:00 GMT\n` }),
    fail: (code: string) => { throw new Error(code); }, console: { error: vi.fn() }, Date, URL,
  });
  return { meta, files, download };
}

function refreshThroughMetadataApi() {
  const files = new Map<string, string>([
    ["db.zip", "valid-old-archive"],
    ["meta.json", JSON.stringify({ generation: "100", lastModified: "2026-08-01" })],
  ]);
  const download = vi.fn((_url: string, destination: string) => {
    files.set(destination, "valid-new-archive");
    return true;
  });
  const spawnSync = vi.fn()
    .mockReturnValueOnce({ status: 6, stdout: "" })
    .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ generation: "200", updated: "2026-09-14T00:00:00.000Z" }) });
  const script = readFileSync(new URL("../../scripts/audit-dependencies.mjs", import.meta.url), "utf8");
  const body = script.slice(script.indexOf("function ensureDatabase()"), script.indexOf("function assertFreshness("));
  const meta = runInNewContext(`${body}\nensureDatabase();`, {
    existsSync: (path: string) => files.has(path), readFileSync: (path: string) => files.get(path),
    writeFileSync: (path: string, value: string) => files.set(path, value),
    renameSync: (from: string, to: string) => { files.set(to, files.get(from)!); files.delete(from); },
    rmSync: (path: string) => files.delete(path), databasePath: "db.zip", databaseMetaPath: "meta.json",
    databaseUrl: "https://osv-vulnerabilities.storage.googleapis.com/npm/all.zip", databaseChoice, download,
    spawnSync, fail: (code: string) => { throw new Error(code); }, console: { error: vi.fn() }, Date, URL,
  });
  return { meta, files, download, spawnSync };
}

describe("dependency database refresh orchestration", () => {
  it("downloads a newer generation instead of failing later on the old cache's age", () => {
    const result = refresh();
    expect(result.download).toHaveBeenCalledOnce();
    expect(result.meta.generation).toBe("200");
    expect(result.files.get("db.zip")).toBe("valid-new-archive");
  });
  it("does not overwrite a usable cache when a refresh downloads only part of the archive", () => {
    const result = refresh({ downloadOk: false });
    expect(result.download).toHaveBeenCalledOnce();
    expect(result.meta.generation).toBe("100");
    expect(result.files.get("db.zip")).toBe("valid-old-archive");
  });
  it("avoids a download only when the served generation already matches", () => {
    const result = refresh({ generation: "100" });
    expect(result.download).not.toHaveBeenCalled();
    expect(result.meta.generation).toBe("100");
  });

  it("uses the public metadata API when a runner cannot issue HEAD", () => {
    const result = refreshThroughMetadataApi();
    expect(result.spawnSync).toHaveBeenCalledTimes(2);
    expect(result.download).toHaveBeenCalledOnce();
    expect(result.meta.generation).toBe("200");
    expect(result.files.get("db.zip")).toBe("valid-new-archive");
  });
});

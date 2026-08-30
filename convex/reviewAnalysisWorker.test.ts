import { describe, expect, it } from "vitest";
import { boundedAnalysisContext } from "./reviewAnalysisWorker";

const pull = { title: "Fix transfer limit", body: "Must reject amounts above the daily limit", files: [{ path: "src/changed.ts", status: "modified", patch: "@@ guard" }], omitted: [], urlHash: "a".repeat(64) };
describe("bounded model evidence selection", () => {
  it("prioritizes changed-file contents and stays inside the byte ceiling", () => {
    const result = boundedAnalysisContext([{ pull, snapshot: { coverage: "full", omitted: [], files: [{ path: "src/other.ts", content: "o".repeat(200), size: 200 }, { path: "src/changed.ts", content: "changed", size: 7 }] } }], 500);
    expect(result.files[0]).toEqual({ path: "src/changed.ts", content: "changed" });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(550);
  });

  it("reports excluded paths and partial coverage instead of silently truncating", () => {
    const result = boundedAnalysisContext([{ pull, snapshot: { coverage: "full", omitted: [], files: [{ path: "src/changed.ts", content: "x".repeat(2_000), size: 2_000 }] } }], 500);
    expect(result.files).toEqual([]);
    expect(result.exclusions.paths).toEqual(["src/changed.ts"]);
    expect(result.coverage).toBe("partial");
  });

  it("names changed files whose patches exceed the prompt budget", () => {
    const result = boundedAnalysisContext([{ pull: { ...pull, files: [{ path: "src/changed.ts", status: "modified", patch: "x".repeat(40_000) }] }, snapshot: { coverage: "full", omitted: [], files: [] } }], 80_000);
    expect(result.exclusions.patchPaths).toEqual(["src/changed.ts"]);
    expect(result.coverage).toBe("partial");
  });

  it("requires pull-request intent and changed-file context", () => {
    expect(() => boundedAnalysisContext([{ snapshot: { coverage: "full", omitted: [], files: [] } }], 500)).toThrow("pull_request_context_missing");
  });
});

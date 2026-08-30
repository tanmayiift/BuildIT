import { describe, expect, it } from "vitest";
import { boundedAnalysisContext, boundedValidationEvidence, redactModelOutput } from "./reviewAnalysisWorker";

const pull = { title: "Fix transfer limit", body: "Must reject amounts above the daily limit", files: [{ path: "src/changed.ts", status: "modified", patch: "@@ guard" }], omitted: [], urlHash: "a".repeat(64) };
describe("bounded model evidence selection", () => {
  it("prioritizes changed-file contents and stays inside the byte ceiling", () => {
    const result = boundedAnalysisContext([{ pull, snapshot: { coverage: "full", omitted: [], files: [{ path: "src/other.ts", content: "o".repeat(200), size: 200 }, { path: "src/changed.ts", content: "changed", size: 7 }] } }], 800);
    expect(result.files[0]).toMatchObject({ path: "src/changed.ts", content: "changed", startLine: 1, endLine: 1 });
    expect(result.files[0]?.evidenceId).toMatch(/^source-[0-9a-f]{24}$/);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(850);
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

  it("passes pinned ticket criteria to the model and preserves incomplete intent coverage", () => {
    const result = boundedAnalysisContext([{ pull: { ...pull, requirementCoverage: "partial", requirementSources: [{ id: "linked-1", type: "github_issue", status: "available", version: '"issue-v2"', urlHash: "b".repeat(64), content: "## Acceptance criteria\n- Reject empty names" }, { id: "linked-2", type: "linear", status: "inaccessible", version: "connection_unavailable", urlHash: "c".repeat(64) }], requirements: [{ id: "req-linked-1-2", text: "Reject empty names", sourceId: "linked-1", line: 2, evidenceHash: "d".repeat(64), certainty: "explicit" }] }, snapshot: { coverage: "full", omitted: [], files: [] } }], 80_000);
    expect(result.pull.requirements).toEqual([expect.objectContaining({ text: "Reject empty names", evidenceHash: "d".repeat(64) })]);
    expect(result.pull.requirementSources).toEqual(expect.arrayContaining([expect.objectContaining({ type: "github_issue", version: '"issue-v2"' }), expect.objectContaining({ type: "linear", status: "inaccessible" })]));
    expect(result.coverage).toBe("partial");
  });

  it("removes secret-looking values from every model-bound text source", () => {
    const secret = "super-secret-value-123", result = boundedAnalysisContext([{ pull: { ...pull, title: `token=${secret}`, body: `password=${secret}`, files: [{ path: "src/a.ts", status: "modified", patch: `api_key=${secret}` }], requirementSources: [{ id: "linked-1", type: "github_issue", status: "available", version: "v1", urlHash: "a".repeat(64), content: `access_token=${secret}` }], requirements: [{ id: "r1", text: `client_secret=${secret}`, sourceId: "linked-1", line: 1, evidenceHash: "b".repeat(64), certainty: "explicit" }] }, snapshot: { coverage: "full", omitted: [], files: [{ path: "src/a.ts", content: `auth_token=${secret}\nexport const ok = true`, size: 1 }] } }], 80_000);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.files[0]?.endLine).toBe(2);
  });

  it("requires pull-request intent and changed-file context", () => {
    expect(() => boundedAnalysisContext([{ snapshot: { coverage: "full", omitted: [], files: [] } }], 500)).toThrow("pull_request_context_missing");
  });
});

describe("bounded validation evidence",()=>{it("requires exact commits and redacts bounded stdout",()=>{const pinned={headSha:"a".repeat(40),baseSha:"b".repeat(40)},value={version:1,pinned,manager:"npm",output:{base:{results:[],outputs:[{planId:"test",text:"ghp_abcdefghijk",truncated:false,evidenceTruncated:false}]},head:{results:[],outputs:[]},scanners:{}}};expect(boundedValidationEvidence(value,pinned).base.outputs[0]?.text).toBe("[REDACTED]");expect(()=>boundedValidationEvidence({...value,pinned:{...pinned,headSha:"c".repeat(40)}},pinned)).toThrow("validation_evidence_pinning_failed")})});

describe("model output retention", () => {
  it("recursively redacts a provider key before analysis, patch, or report output is stored", () => {
    const secret = ["AI", "za", "SyA", "1234567890", "1234567890", "1234567890"].join("");
    const value = { stage: "findings", value: { findings: [{ title: `Leaked ${secret}`, evidenceIds: ["source-1"] }] } };
    const safe = redactModelOutput(value);
    expect(JSON.stringify(safe)).not.toContain(secret);
    expect(safe.value.findings[0]?.title).toBe("Leaked [REDACTED]");
  });
});

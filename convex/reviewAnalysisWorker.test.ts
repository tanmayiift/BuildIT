import { describe, expect, it } from "vitest";
import { analysisSkipReason, boundedAnalysisContext, boundedValidationEvidence, introducedScannerFindings, redactModelOutput,requireIndependentCritic,selectCriticModel,selectFindingsModel } from "./reviewAnalysisWorker";

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

  it("bounds many-file PR metadata and reports exact omission totals instead of crashing", () => {
    const manyFiles = Array.from({ length: 1_200 }, (_, index) => ({ path: `src/generated/very-long-component-name-${String(index).padStart(4, "0")}.ts`, status: "modified", patch: `@@ ${index}\n${"x".repeat(300)}` }));
    const omissions = Array.from({ length: 1_200 }, (_, index) => ({ path: `vendor/omitted-${index}.bin`, reason: "budget" }));
    const result = boundedAnalysisContext([{ pull: { ...pull, files: manyFiles, omitted: omissions }, snapshot: { coverage: "partial", omitted: omissions, files: [] } }], 80_000);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(80_000);
    expect(result.coverage).toBe("partial");
    expect(result.exclusions.totals.changedFiles).toBeGreaterThan(0);
    expect(result.exclusions.totals.patches).toBeGreaterThan(0);
    expect(result.exclusions.totals.sourceOmissions).toBe(1_200);
    expect(result.exclusions.totals.pullOmissions).toBe(1_200);
  });

  it("passes pinned ticket criteria to the model and preserves incomplete intent coverage", () => {
    const result = boundedAnalysisContext([{ pull: { ...pull, requirementCoverage: "partial", requirementSources: [{ id: "linked-1", type: "github_issue", status: "available", version: '"issue-v2"', urlHash: "b".repeat(64), content: "## Acceptance criteria\n- Reject empty names" }, { id: "linked-2", type: "linear", status: "inaccessible", version: "connection_unavailable", urlHash: "c".repeat(64) }], requirements: [{ id: "req-linked-1-2", text: "Reject empty names", sourceId: "linked-1", line: 2, evidenceHash: "d".repeat(64), certainty: "explicit" }] }, snapshot: { coverage: "full", omitted: [], files: [] } }], 80_000);
    expect(result.pull.requirements).toEqual([expect.objectContaining({ text: "Reject empty names", evidenceHash: "d".repeat(64) })]);
    expect(result.pull.requirementSources).toEqual(expect.arrayContaining([expect.objectContaining({ type: "github_issue", version: '"issue-v2"' }), expect.objectContaining({ type: "linear", status: "inaccessible" })]));
    expect(result.coverage).toBe("partial");
  });

  it("preserves requirement conflicts and prevents full coverage", () => {
    const result = boundedAnalysisContext([{ pull: { ...pull, requirementCoverage: "partial", requirementConflicts: [{ canonical: "allow empty names", requirementIds: ["r1", "r2"], sourceIds: ["pr", "ticket"] }] }, snapshot: { coverage: "full", omitted: [], files: [] } }], 80_000);
    expect(result.pull.requirementConflicts).toEqual([{ canonical: "allow empty names", requirementIds: ["r1", "r2"], sourceIds: ["pr", "ticket"] }]);
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

describe("scanner PR attribution", () => {
  const finding = (fingerprint: string) => ({ scanner: "gitleaks", ruleId: "generic-api-key", fingerprint, severity: "critical" as const, path: "src/config.ts", startLine: 4, endLine: 4, summary: "Potential secret" });
  it("removes an unchanged base finding and preserves an introduced finding", () => {
    expect(introducedScannerFindings([finding("same")], [finding("same"), finding("new")]).map(item => item.fingerprint)).toEqual(["new"]);
  });
  // Three JWT fixtures that had been in zod's string.test.ts all along came back Critical and
  // Blocking on a pull request that never opened that file. The base diff could not catch it: head
  // fetches requirement sources and test files, base fetches only what the diff touched, so the
  // scanner never saw those lines on base and every one of them looked introduced.
  it("never blames a pull request for a finding in a file it did not touch", () => {
    const untouched = { ...finding("upstream"), path: "packages/zod/src/v4/mini/tests/string.test.ts" };
    const changed = new Set(["packages/zod/src/v4/classic/tests/number.test.ts"]);
    expect(introducedScannerFindings([], [untouched], changed)).toEqual([]);
  });

  it("still reports a finding the pull request did introduce into a file it touched", () => {
    const changed = new Set(["src/config.ts"]);
    expect(introducedScannerFindings([finding("old")], [finding("old"), finding("new")], changed)
      .map(item => item.fingerprint)).toEqual(["new"]);
  });

  // Without changedPaths the old behaviour has to survive, because the base diff is still the only
  // thing standing between a pre-existing finding and a blocked merge on paths that were touched.
  it("falls back to the base comparison when no changed set is supplied", () => {
    expect(introducedScannerFindings([finding("same")], [finding("same"), finding("new")], undefined)
      .map(item => item.fingerprint)).toEqual(["new"]);
  });

  it("uses multiset counts and keeps malformed or unfingerprinted head evidence fail-safe", () => {
    const result = introducedScannerFindings([finding("same")], [finding("same"), finding("same"), { ...finding(""), fingerprint: undefined }]);
    expect(result).toHaveLength(2);
    expect(result[0]?.fingerprint).toBe("same");
    expect(result[1]?.fingerprint).toBeUndefined();
  });
});

describe("model output retention", () => {
  it("recursively redacts a provider key before analysis, patch, or report output is stored", () => {
    const secret = ["AI", "za", "SyA", "1234567890", "1234567890", "1234567890"].join("");
    const value = { stage: "findings", value: { findings: [{ title: `Leaked ${secret}`, evidenceIds: ["source-1"] }] } };
    const safe = redactModelOutput(value);
    expect(JSON.stringify(safe)).not.toContain(secret);
    expect(safe.value.findings[0]?.title).toBe("Leaked [REDACTED]");
  });
});
describe("critic independence",()=>{
  it("uses the strongest approved OpenAI model only for findings",()=>{
    expect(selectFindingsModel("openai","gpt-5.4-mini",["gpt-5.4-mini","gpt-5.4"])).toBe("gpt-5.4");
    expect(selectCriticModel("openai","gpt-5.4",["gpt-5.4-mini","gpt-5.4"])).toEqual({model:"gpt-5.4-mini",independent:true});
  });

  it("keeps the primary model when the stronger OpenAI model was not validated",()=>{
    expect(selectFindingsModel("openai","gpt-5.4-mini",["gpt-5.4-mini"])).toBe("gpt-5.4-mini");
    expect(selectCriticModel("openai","gpt-5.4-mini",["gpt-5.4-mini"])).toEqual({model:"gpt-5.4-mini",independent:false});
  });

  it("does not change findings routing for Gemini or Anthropic",()=>{
    expect(selectFindingsModel("gemini","gemini-2.5-pro",["gemini-2.5-pro","gemini-2.5-flash"])).toBe("gemini-2.5-pro");
    expect(selectFindingsModel("anthropic","claude-sonnet-4-5",["claude-sonnet-4-5","claude-sonnet-4-6"])).toBe("claude-sonnet-4-5");
  });

  it("chooses a different critic only when the saved key proved both models available",()=>{
    expect(selectCriticModel("gemini","gemini-2.5-pro",["gemini-2.5-pro","gemini-2.5-flash"])).toEqual({model:"gemini-2.5-flash",independent:true});
    expect(selectCriticModel("openai","not-approved",["gpt-5.4-mini"])).toEqual({model:"gpt-5.4-mini",independent:true});
    expect(selectCriticModel("gemini","gemini-2.5-pro")).toEqual({model:"gemini-2.5-pro",independent:false});
  });

  it("forces risky model findings uncertain when independence is unavailable",()=>{const findings=[{id:"f1",severity:"critical",origin:"model"},{id:"s1",severity:"critical",origin:"scanner"}] as never;const decisions=[{findingId:"f1",verdict:"supported",missingEvidenceIds:[],injectionDetected:false,explanation:"ok"},{findingId:"s1",verdict:"supported",missingEvidenceIds:[],injectionDetected:false,explanation:"ok"}] as never;expect(requireIndependentCritic(findings,decisions,false)).toEqual([expect.objectContaining({findingId:"f1",verdict:"uncertain"}),expect.objectContaining({findingId:"s1",verdict:"supported"})])});
});

// The model used to read the changed files and then the rest of the snapshot alphabetically until the
// budget ran out. These pin what replaced it: the change, its import neighbours, nothing else.
describe("what the model reads of the repository", () => {
  const snapshot = (files: Array<{ path: string; content: string }>) => ({ coverage: "full", omitted: [], files: files.map(file => ({ ...file, size: file.content.length })) });
  const complete = { ...pull, requirementCoverage: "complete" as const };

  it("sends the changed file and its import neighbours, and nothing unrelated", () => {
    const result = boundedAnalysisContext([{ pull: { ...complete, files: [{ path: "src/a.ts", status: "modified", patch: "@@ -1,2 +1,2 @@" }] }, snapshot: snapshot([
      { path: "README.md", content: "# readme" },
      { path: "src/a.ts", content: 'import { b } from "./b.js";\nexport const a = b + 1;' },
      { path: "src/b.ts", content: "export const b = 1;" },
      { path: "src/unrelated.ts", content: "export const z = 0;" },
      { path: "test/a.test.ts", content: 'import { a } from "../src/a";\nexpect(a).toBe(2);' },
    ]) }], 80_000);
    expect(result.files.map(file => file.path)).toEqual(["src/a.ts", "src/b.ts", "test/a.test.ts"]);
    expect(result.files.filter(file => file.related).map(file => file.path)).toEqual(["src/b.ts", "test/a.test.ts"]);
    // Leaving out a file the change does not touch is not a gap in the review.
    expect(result.coverage).toBe("full");
  });

  it("sends a large changed file as windows around each hunk, under the whole file's evidence id", () => {
    const content = Array.from({ length: 3_000 }, (_, index) => `line ${index + 1}`).join("\n");
    const patch = "@@ -100,3 +100,4 @@ one\n+x\n@@ -2000,2 +2001,2 @@ two\n-y\n+z";
    const result = boundedAnalysisContext([{ pull: { ...complete, files: [{ path: "src/big.ts", status: "modified", patch }] }, snapshot: snapshot([{ path: "src/big.ts", content }]) }], 80_000);
    expect(result.files.map(file => [file.startLine, file.endLine, file.excerpt])).toEqual([[60, 143, true], [1961, 2042, true]]);
    expect(result.files[0]?.content.split("\n")[0]).toBe("line 60");
    expect(new Set(result.files.map(file => file.evidenceId)).size).toBe(1);
    expect(result.exclusions.totals).toMatchObject({ changedExcerpts: 1 });
    // Every changed line was shown, so nothing was dropped.
    expect(result.exclusions.totals.repositoryFiles).toBeUndefined();
    expect(result.exclusions.paths).toEqual([]);
  });

  it("sends an added file once: as the file when it has it, as the patch when it does not", () => {
    const added = { path: "src/new.ts", status: "added", patch: "@@ -0,0 +1,2 @@\n+export const x = 1;\n+export const y = 2;" };
    const withFile = boundedAnalysisContext([{ pull: { ...complete, files: [added] }, snapshot: snapshot([{ path: "src/new.ts", content: "export const x = 1;\nexport const y = 2;" }]) }], 80_000);
    expect(withFile.files.map(file => file.path)).toEqual(["src/new.ts"]);
    expect(withFile.pull.changes[0]).toEqual({ path: "src/new.ts", status: "added" });
    const withoutFile = boundedAnalysisContext([{ pull: { ...complete, files: [added] }, snapshot: snapshot([]) }], 80_000);
    expect(withoutFile.pull.changes[0]?.patch).toContain("export const y = 2;");
  });

  it("offers a repository document's text only when a requirement was read out of it", () => {
    const source = (id: string, type: "repository_document" | "github_issue", content: string) => ({ id, type, status: "available", version: "v1", urlHash: "c".repeat(64), content });
    const result = boundedAnalysisContext([{ pull: { ...pull,
      requirementSources: [source("doc-1", "repository_document", "## Usage"), source("doc-2", "repository_document", "Names must not be empty"), source("linked-1", "github_issue", "Reported: empty names save")],
      requirements: [{ id: "req-doc-2-1", text: "Names must not be empty", sourceId: "doc-2", line: 1, evidenceHash: "d".repeat(64), certainty: "explicit" }] }, snapshot: snapshot([]) }], 80_000);
    expect(Object.fromEntries(result.pull.requirementSources.map(item => [item.id, item.content]))).toEqual({ "doc-1": undefined, "doc-2": "Names must not be empty", "linked-1": "Reported: empty names save" });
  });

  it("keeps omission samples short and their totals exact", () => {
    const omitted = Array.from({ length: 500 }, (_, index) => ({ path: `vendor/${index}.bin`, reason: "budget" }));
    const result = boundedAnalysisContext([{ pull: { ...pull, omitted }, snapshot: { coverage: "partial", omitted, files: [] } }], 80_000);
    expect([result.exclusions.source.length, result.exclusions.pull.length]).toEqual([20, 20]);
    expect(result.exclusions.totals).toMatchObject({ sourceOmissions: 500, pullOmissions: 500 });
  });
});

// BuildIT could not review its own repository. Every attempt reached the analysis stage - context
// and validation both succeeded, the sandbox ran for four minutes - and then threw
// analysis_context_too_large. The budget arithmetic was out by a byte, which only matters on a
// tree big enough to run the budget flat against the ceiling. A 474-file repository is.
describe("the context budget holds on a repository large enough to exhaust it", () => {
  const manyFiles = (count: number, bytes: number) =>
    Array.from({ length: count }, (_, index) => ({ path: `src/file-${index}.ts`, content: "x".repeat(bytes), size: bytes }));
  // Only the files a pull request changed (and their import neighbours) are offered to the model, so
  // a tree that exhausts the budget is one whose pull request touched all of it.
  const changing = <T extends { path: string }>(base: typeof pull, files: T[]) =>
    ({ ...base, files: files.map(file => ({ path: file.path, status: "modified", patch: "@@ -1 +1 @@" })) });

  it("never exceeds the ceiling, at any ceiling, however many files are offered", () => {
    // Sweeping the ceiling is the point: the leak was a single separator byte plus counter digits,
    // so it only surfaced at sizes where the loop packs the budget exactly full.
    for (const ceiling of [4_000, 8_000, 20_000, 50_000, 80_000]) {
      const result = boundedAnalysisContext(
        [{ pull: changing(pull, manyFiles(600, 300)), snapshot: { coverage: "full", omitted: [], files: manyFiles(600, 300) } }], ceiling);
      expect(Buffer.byteLength(JSON.stringify(result)), `ceiling ${ceiling}`).toBeLessThanOrEqual(ceiling);
      // It must still do its job - a budget that fits by returning nothing is not a fix.
      expect(result.files.length, `ceiling ${ceiling}`).toBeGreaterThan(0);
      expect(result.coverage, `ceiling ${ceiling}`).toBe("partial");
    }
  });

  it("fits even when recording the exclusions is itself what overflows", () => {
    // The reserve alone did not fix production, and this is why: exclusions.paths had the full
    // ceiling, so recording which files were dropped consumed exactly the room the counters needed,
    // and increment() - which no pop can undo - then pushed past it. Heavy requirement context
    // plus hundreds of excluded files is the shape that does it.
    const requirementSources = Array.from({ length: 63 }, (_, index) => ({
      id: `req-${index}`, type: "repository_document" as const, status: "resolved", urlHash: `${index}`.padStart(64, "0"), version: "v1", content: "r".repeat(5_000),
    }));
    // Each source has a requirement read out of it, or its text would not be offered at all.
    const requirements = requirementSources.map(source => ({ id: `${source.id}-1`, text: "The handler must reject an empty name", sourceId: source.id, line: 1, evidenceHash: "e".repeat(64), certainty: "explicit" }));
    const files = Array.from({ length: 500 }, (_, index) => ({ path: `src/deeply/nested/module-${index}/index.ts`, content: "x".repeat(900), size: 900 }));
    const heavy = { ...changing(pull, files), body: "b".repeat(20_000), requirementSources, requirements, requirementCoverage: "partial" as const };
    const result = boundedAnalysisContext([{ pull: heavy, snapshot: { coverage: "full", omitted: [], files } }], 80_000);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(80_000);
    // The sample of paths may be trimmed, but the count of what was excluded must survive - that
    // is the number a reader needs to know the review was partial.
    expect(result.exclusions.totals.repositoryFiles).toBeGreaterThan(400);
    expect(result.coverage).toBe("partial");
  });

  it("survives the counters growing a digit after the last file is admitted", () => {
    // increment() writes into the same object the budget measures and is not covered by the
    // pop-on-overflow, so exclusion counters crossing 9 -> 10 -> 100 used to grow the payload with
    // nothing to undo it. Enough files to push every counter into three digits.
    const result = boundedAnalysisContext(
      [{ pull: changing(pull, manyFiles(1_500, 120)), snapshot: { coverage: "full", omitted: [], files: manyFiles(1_500, 120) } }], 30_000);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(30_000);
    expect(result.exclusions.totals.repositoryFiles).toBeGreaterThan(99);
  });
});

// The third instance of one shape: a pre-existing problem reported as this pull request's fault.
// The first was the base/head fetch asymmetry, the second the check run disagreeing with its own
// comment. This one is subtler - both revisions were read, both were scanned, and the comparison
// still failed, because the key it compared on encodes where the match sits rather than what it is.
// builditRules fingerprints as `${path}:${line}:${rule}` and gitleaks carries its own File:Rule:Line,
// so adding one import above a years-old finding makes head's key differ from base's and the author
// is told, blocking, that they committed it.
describe("a scanner finding whose line moved", () => {
  const at = (line: number, path = "src/http.ts", ruleId = "tls-disabled") => ({
    scanner: "builditRules" as const, ruleId, path, severity: "critical" as const,
    startLine: line, endLine: line, fingerprint: `${path}:${line}:${ruleId}`,
  });

  it("is not introduced when the pull request only shifted it down the file", () => {
    expect(introducedScannerFindings([at(12)], [at(19)])).toEqual([]);
  });

  it("is still introduced when the pull request adds a second match of the same rule", () => {
    const introduced = introducedScannerFindings([at(12)], [at(19), at(64)]);
    expect(introduced).toHaveLength(1);
  });

  it("counts matches per rule and per file rather than collapsing them", () => {
    // Two on base, three on head: exactly one is new however the other two moved.
    expect(introducedScannerFindings([at(4), at(40)], [at(9), at(44), at(90)])).toHaveLength(1);
    // A different rule in the same file is its own match, not a shifted one.
    expect(introducedScannerFindings([at(4)], [at(9), at(30, "src/http.ts", "aws-key")])).toHaveLength(1);
    // A different file is not the same match either.
    expect(introducedScannerFindings([at(4)], [at(9), at(4, "src/other.ts")])).toHaveLength(1);
  });

  it("still reports a match on a file the base never had", () => {
    expect(introducedScannerFindings([], [at(3)])).toHaveLength(1);
  });
});

// Skipping is safe only when the call could not change the result. These pin the two proofs: with no
// model finding past the evidence gate the critic's decisions are never read, and with no model
// finding accepted the arbitration is never read.
describe("skipping a model call that could not change the review", () => {
  const head = "a".repeat(40);
  const gate = { provenance: new Map(), headSha: head, allowedPaths: new Set(["src/a.ts"]),
    evidence: [{ id: "ev-1", artifactExists: true, commitSha: head, path: "src/a.ts", pathExists: true, startLine: 1, endLine: 20, contentHash: "h", lineHashMatches: true, truncated: false }] };
  const finding = { id: "f-1", title: "Off-by-one", category: "correctness", severity: "warning", confidence: 0.8, criterionId: "", path: "src/a.ts",
    startLine: 3, endLine: 4, evidenceIds: ["ev-1"], impact: "Wrong bound", explanation: "Uses <= where < is meant" };
  const record = (stage: string, value: Record<string, unknown>) => ({ stage, promptVersion: "v", schemaVersion: "v", value, attempts: 1 }) as never;
  const findings = (items: unknown[]) => [record("findings", { findings: items })];
  const withCritic = (items: unknown[], verdict: string) => [...findings(items), record("critic", { decisions: [{ findingId: "f-1", verdict, missingEvidenceIds: [], injectionDetected: false, explanation: "" }] })];

  it("skips critic and arbitration when the model found nothing", () => {
    expect(analysisSkipReason("critic", findings([]), gate, true)).toBe("no model finding passed the evidence gate");
    expect(analysisSkipReason("arbitration", withCritic([], "supported"), gate, true)).toBe("no model finding passed the evidence gate");
  });

  it("skips the critic when every model finding failed the evidence gate", () => {
    expect(analysisSkipReason("critic", findings([{ ...finding, path: "src/elsewhere.ts" }]), gate, true)).toBe("no model finding passed the evidence gate");
    expect(analysisSkipReason("critic", findings([{ ...finding, evidenceIds: ["invented"] }]), gate, true)).toBe("no model finding passed the evidence gate");
  });

  it("runs the critic for a finding that passed, and arbitration only once one is accepted", () => {
    expect(analysisSkipReason("critic", findings([finding]), gate, true)).toBeUndefined();
    expect(analysisSkipReason("arbitration", withCritic([finding], "supported"), gate, true)).toBeUndefined();
    expect(analysisSkipReason("arbitration", withCritic([finding], "unsupported"), gate, true)).toBe("no model finding was accepted");
    expect(analysisSkipReason("arbitration", withCritic([finding], "uncertain"), gate, true)).toBe("no model finding was accepted");
  });

  it("never skips requirements or findings", () => {
    for (const stage of ["requirements", "findings"] as const) expect(analysisSkipReason(stage, [], gate, true)).toBeUndefined();
  });
});

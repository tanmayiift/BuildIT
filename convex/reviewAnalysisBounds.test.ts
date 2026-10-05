import { describe, expect, it } from "vitest";
import { boundJson, boundedValidationEvidence, modelValidationView } from "./reviewAnalysisWorker";

const pinned = { headSha: "a".repeat(40), baseSha: "b".repeat(40) };

// boundedValidationEvidence budgeted outputs[].text and handed results and scanners through
// verbatim. scanners carries one record per finding including a repository-controlled path of up
// to 1024 bytes, so a repository with many files tripping one built-in rule (say `eval(`) pushes
// the rendered stage input past its 250 KB ceiling - and then every stage and every retry throws
// stage_input_too_large. The review can never complete, at any commit, until the code changes.
describe("validation evidence bounds", () => {
  const scannerFindings = (count: number) => ({
    head: { findings: Array.from({ length: count }, (_, index) => ({ ruleId: "no-eval", path: `${"nested/".repeat(100)}file-${index}.ts`, line: index + 1 })) },
  });
  const artifact = (count: number) => ({
    version: 1, pinned, manager: "pnpm",
    output: { base: { results: [], outputs: [] }, head: { results: [], outputs: [] }, scanners: scannerFindings(count) },
  });

  it("passes a small scanner run through untouched", () => {
    const bounded = boundedValidationEvidence(artifact(3), pinned);
    expect(bounded.scannersTruncated).toBe(false);
    expect(bounded.scanners).toEqual(scannerFindings(3));
  });

  it("bounds a scanner run that would blow the stage ceiling", () => {
    const bounded = boundedValidationEvidence(artifact(2_000), pinned);
    expect(bounded.scannersTruncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThan(250_000);
  });

  it("still pins the exact commits it claims to have validated", () => {
    expect(() => boundedValidationEvidence(artifact(1), { headSha: "c".repeat(40), baseSha: pinned.baseSha }))
      .toThrow("validation_evidence_pinning_failed");
  });
});

describe("boundJson", () => {
  // Truncating mid-JSON would hand the model a malformed structure to reason over.
  it("drops whole elements rather than cutting a value in half", () => {
    const items = Array.from({ length: 50 }, (_, index) => ({ path: "x".repeat(100), index }));
    const bounded = boundJson(items, 1_000);
    expect(bounded.truncated).toBe(true);
    expect(Array.isArray(bounded.value)).toBe(true);
    expect(() => JSON.parse(JSON.stringify(bounded.value))).not.toThrow();
    expect(Buffer.byteLength(JSON.stringify(bounded.value))).toBeLessThanOrEqual(1_000);
  });

  it("leaves a value that already fits exactly as it was", () => {
    const value = { a: 1, b: ["two"] };
    expect(boundJson(value, 10_000)).toEqual({ value, truncated: false });
  });

  it("reports a budget of zero as truncated rather than silently emptying", () => {
    expect(boundJson([{ a: 1 }], 0)).toEqual({ value: [], truncated: true });
  });
});

// Base was evaluated first from the shared budget, so a long base test log left the head's - the
// commit under review - empty. And results were sized against the budget without being charged to it.
describe("validation evidence for the commit under review", () => {
  const artifact = (baseText: string, headText: string, results: unknown[] = []) => ({ version: 1, pinned, manager: "pnpm",
    output: { base: { results, outputs: [{ planId: "test", text: baseText }] }, head: { results, outputs: [{ planId: "test", text: headText }] }, scanners: { base: { findings: [] }, head: { findings: [] } } } });

  it("keeps the head output when the base output alone could fill the budget", () => {
    const stored = boundedValidationEvidence(artifact("b".repeat(60_000), "HEAD_FAILURE_LINE"), pinned);
    expect(stored.head.outputs[0]!.text).toBe("HEAD_FAILURE_LINE");
  });

  it("charges results to the budget instead of handing them through on top of it", () => {
    const results = Array.from({ length: 200 }, (_, index) => ({ planId: `check-${index}`, conclusion: "passed", note: "r".repeat(200) }));
    const stored = boundedValidationEvidence(artifact("", "h".repeat(60_000), results), pinned, 60_000);
    expect(Buffer.byteLength(JSON.stringify(stored))).toBeLessThan(60_000 * 1.25);
  });
});

describe("the validation the findings model sees", () => {
  const head = (conclusion: string) => ({ planId: "test", kind: "test", required: true, conclusion, testCounts: { passed: 7, failed: 5 } });
  const lint = { planId: "lint", kind: "lint", required: false, conclusion: "passed" };
  const view = (headConclusion: string, baseConclusion: string, headText: string, scanners = { base: { findings: [] as unknown[] }, head: { findings: [] as unknown[] } }) =>
    modelValidationView({ version: 1, pinned, manager: "pnpm", output: {
      base: { results: [{ ...head(baseConclusion) }, lint], outputs: [{ planId: "test", text: "BASE_ONLY_OUTPUT" }, { planId: "lint", text: "BASE_LINT" }] },
      head: { results: [head(headConclusion), lint], outputs: [{ planId: "test", text: headText }, { planId: "lint", text: "PASSING_LINT_OUTPUT" }] },
      scanners } } as never, pinned, new Set(["src/changed.ts"]));

  it("is one row per check, with the base result beside the head's and the runner's counts", () => {
    expect(view("failed", "passed", "x").checks).toEqual([
      { planId: "test", kind: "test", required: true, conclusion: "failed", baseConclusion: "passed", testCounts: { passed: 7, failed: 5 } },
      { planId: "lint", kind: "lint", required: false, conclusion: "passed", baseConclusion: "passed" },
    ]);
  });

  it("carries head output only for failing checks, and never the base commit's", () => {
    const shown = JSON.stringify(view("failed", "passed", "HEAD_FAILURE"));
    expect(shown).toContain("HEAD_FAILURE");
    for (const absent of ["BASE_ONLY_OUTPUT", "BASE_LINT", "PASSING_LINT_OUTPUT"]) expect(shown).not.toContain(absent);
  });

  it("keeps where a new failure starts and ends, and only the end of one the base shares", () => {
    const long = ["START_OF_FAILURE", ...Array.from({ length: 2_000 }, (_, index) => `line ${index}`), "END_OF_FAILURE"].join("\n");
    const fresh = view("failed", "passed", long).outputs[0]!.text, shared = view("failed", "failed", long).outputs[0]!.text;
    expect(fresh).toContain("START_OF_FAILURE"); expect(fresh).toContain("END_OF_FAILURE"); expect(fresh.length).toBeLessThan(8_500);
    expect(shared).not.toContain("START_OF_FAILURE"); expect(shared).toContain("END_OF_FAILURE"); expect(shared.length).toBeLessThanOrEqual(1_500);
    expect(view("failed", "failed", long).checks[0]).toMatchObject({ preExisting: true });
  });

  it("lists only scanner findings this pull request introduced, in files it changed", () => {
    const finding = (path: string, ruleId: string) => ({ scanner: "builditRules", ruleId, fingerprint: `${path}:${ruleId}`, path, startLine: 1, endLine: 1, severity: "warning", summary: "s" });
    const shown = view("passed", "passed", "", { base: { findings: [finding("src/changed.ts", "old")] }, head: { findings: [finding("src/changed.ts", "old"), finding("src/changed.ts", "new"), finding("src/untouched.ts", "other")] } });
    expect(shown.scanners).toEqual({ introduced: [expect.objectContaining({ ruleId: "new", path: "src/changed.ts" })], introducedTotal: 1 });
  });

  it("stays inside its byte ceiling and refuses unpinned evidence", () => {
    expect(Buffer.byteLength(JSON.stringify(view("failed", "passed", "z".repeat(500_000))))).toBeLessThanOrEqual(24_000);
    expect(() => modelValidationView({ version: 1, pinned: { headSha: "c".repeat(40), baseSha: pinned.baseSha }, output: { base: {}, head: {} } } as never, pinned, new Set())).toThrow("validation_evidence_pinning_failed");
  });
});

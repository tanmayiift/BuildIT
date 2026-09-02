import { describe, expect, it } from "vitest";
import { boundJson, boundedValidationEvidence } from "./reviewAnalysisWorker";

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

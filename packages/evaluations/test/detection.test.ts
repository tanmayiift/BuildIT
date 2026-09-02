import { describe, expect, it } from "vitest";
import { detectionCases } from "../src/detectionCases.js";
import { detectionGate, scoreCase, scoreDetection, type ReviewedFinding } from "../src/detection.js";

// Nothing asked "given this diff, does it find this defect?", which is how a production false
// negative went unmeasured. These tests are about the grader: a grader that scores a miss as a
// pass would be worse than no grader at all.

const caseById = (id: string) => detectionCases.find(item => item.id === id)!;
const finding = (over: Partial<ReviewedFinding> = {}): ReviewedFinding => ({
  title: "Half-cent values like 1.005 round down incorrectly",
  path: "src/currency.js", severity: "high", blocking: true, resolution: "accepted", ...over,
});

describe("detection grading", () => {
  const rounding = caseById("det-round-half-cent");

  it("counts a finding that cites the right file and understands the defect", () => {
    expect(scoreCase(rounding, [finding()]).passed).toBe(true);
  });

  it("does not count a finding on a different file", () => {
    const outcome = scoreCase(rounding, [finding({ path: "src/other.js" })]);
    expect(outcome.passed).toBe(false);
    expect(outcome.because).toContain("nothing reported on src/currency.js");
  });

  // The exact production miss: something was said about the file, but not about the bug.
  it("does not count a coverage complaint as finding the bug", () => {
    const outcome = scoreCase(rounding, [finding({ title: "New currency helper is completely unvalidated by the repository's checks" })]);
    expect(outcome.passed).toBe(false);
    expect(outcome.because).toContain("but not this defect");
  });

  it("does not count a finding the critic disproved", () => {
    expect(scoreCase(rounding, [finding({ resolution: "rejected" })]).passed).toBe(false);
  });

  it("does not count an advisory whisper when the defect must block", () => {
    expect(scoreCase(rounding, [finding({ blocking: false })]).passed).toBe(false);
    expect(scoreCase(rounding, [finding({ severity: "info" })]).passed).toBe(false);
  });

  it("reads the explanation, not only the title", () => {
    const outcome = scoreCase(rounding, [finding({ title: "Money helper is wrong", explanation: "It mis-rounds 1.005 because of binary floating point." })]);
    expect(outcome.passed).toBe(true);
  });

  // Without this, a reviewer that flags every file scores 100%.
  it("fails a clean case that was blocked anyway", () => {
    const clean = caseById("det-clean-tax");
    expect(scoreCase(clean, []).passed).toBe(true);
    const outcome = scoreCase(clean, [finding({ path: "src/tax.js", title: "Consider extracting a constant" })]);
    expect(outcome.passed).toBe(false);
    expect(outcome.because).toContain("blocked correct code");
  });

  it("allows a non-blocking remark on clean code", () => {
    expect(scoreCase(caseById("det-clean-tax"), [finding({ path: "src/tax.js", blocking: false, severity: "info" })]).passed).toBe(true);
  });
});

describe("detection report", () => {
  const perfect = detectionCases.map(item => ({
    id: item.id,
    findings: item.expect ? [finding({ path: item.expect.path, title: item.expect.anyOf[0]!, severity: item.expect.severityAtLeast, blocking: item.expect.blocking })] : [],
  }));

  it("scores a run that found everything", () => {
    const report = scoreDetection(perfect);
    expect(report.detectionRate).toBe(1);
    expect(report.missed).toEqual([]);
    expect(report.falseBlocking).toEqual([]);
    expect(report.passed).toBe(true);
  });

  // A runner that crashes must not read as a clean sheet.
  it("treats a missing result as a miss, not an omission", () => {
    const report = scoreDetection([]);
    expect(report.detected).toBe(0);
    expect(report.passed).toBe(false);
    expect(report.outcomes.every(outcome => outcome.because.includes("no result"))).toBe(true);
  });

  it("reports which defects were missed by name", () => {
    const partial = perfect.filter(entry => entry.id !== "det-tls-disabled");
    const report = scoreDetection(partial);
    expect(report.missed).toEqual(["det-tls-disabled"]);
    expect(report.detectionRate).toBeLessThan(1);
  });
});

describe("detection gate", () => {
  const report = (rate: number, falseBlocking: string[] = []) => ({
    total: 6, defects: 5, detected: Math.round(rate * 5), missed: [], falseBlocking,
    detectionRate: rate, outcomes: [], passed: false,
  });

  it("passes at or above the floor", () => {
    expect(detectionGate(report(1)).passed).toBe(true);
    expect(detectionGate(report(0.8)).passed).toBe(true);
  });

  it("fails below the floor and says the number", () => {
    const gate = detectionGate(report(0.6));
    expect(gate.passed).toBe(false);
    expect(gate.reasons.join(" ")).toContain("60%");
  });

  // Detection varies run to run, which is why the floor is a rate. Blocking correct code is not
  // a matter of degree.
  it("never tolerates blocking correct code, however high the rate", () => {
    expect(detectionGate(report(1, ["det-clean-tax"])).passed).toBe(false);
  });
});

describe("the corpus itself", () => {
  it("keeps every case unambiguous and self-describing", () => {
    for (const item of detectionCases) {
      expect(item.files.length, item.id).toBeGreaterThan(0);
      expect(item.summary.length, item.id).toBeGreaterThan(20);
      if (item.kind === "defect") {
        expect(item.expect, item.id).toBeTruthy();
        expect(item.files.some(file => file.path === item.expect!.path), item.id).toBe(true);
        expect(item.expect!.anyOf.length, item.id).toBeGreaterThan(0);
      }
    }
  });

  it("includes a clean control, or the grader rewards noise", () => {
    expect(detectionCases.some(item => item.kind === "clean")).toBe(true);
  });

  it("includes the defect production actually missed", () => {
    expect(detectionCases.map(item => item.id)).toContain("det-round-half-cent");
  });
});

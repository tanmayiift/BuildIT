import { describe, expect, it } from "vitest";
import { resolvedScannerFindings, type ResolvableFinding } from "./findingResolution";

const finding = (over: Partial<ResolvableFinding> = {}): ResolvableFinding =>
  ({ id: "f1", ruleId: "buildit-tls-disabled", pathHmac: "aa", resolution: "open", ...over });

describe("which findings a delivered autofix fixed", () => {
  it("marks a scanner finding the candidate no longer reproduces", () => {
    expect(resolvedScannerFindings([finding()], [])).toEqual(["f1"]);
  });

  it("leaves one the candidate still reproduces", () => {
    expect(resolvedScannerFindings([finding()], [{ ruleId: "buildit-tls-disabled", pathHmac: "aa" }])).toEqual([]);
  });

  // The whole reason this is scanner-only. A model finding has no rule to re-run, so a passing
  // candidate says nothing about whether that particular finding was addressed.
  it("never marks a model finding, because nothing here can check one", () => {
    expect(resolvedScannerFindings([finding({ ruleId: undefined })], [])).toEqual([]);
    expect(resolvedScannerFindings([finding({ ruleId: "" })], [])).toEqual([]);
  });

  it("only claims findings that were open or accepted", () => {
    for (const resolution of ["uncertain", "dismissed", "fixed"]) {
      expect(resolvedScannerFindings([finding({ resolution })], []), resolution).toEqual([]);
    }
  });

  it("matches on rule and file together, not either alone", () => {
    const rows = [finding({ id: "same-rule-other-file", pathHmac: "bb" }), finding({ id: "same-file-other-rule", ruleId: "buildit-secret" })];
    // The candidate still has the original rule-and-file pair, which covers neither of these.
    expect(resolvedScannerFindings(rows, [{ ruleId: "buildit-tls-disabled", pathHmac: "aa" }]).sort())
      .toEqual(["same-file-other-rule", "same-rule-other-file"]);
  });

  // Under-claiming on purpose: two matches of one rule in one file, one of them fixed, still reads
  // as present. Saying "fixed" while a match remains in that file would be the wrong direction.
  it("does not claim a fix while any match of that rule remains in the file", () => {
    expect(resolvedScannerFindings([finding({ id: "a" }), finding({ id: "b" })], [{ ruleId: "buildit-tls-disabled", pathHmac: "aa" }])).toEqual([]);
  });
});

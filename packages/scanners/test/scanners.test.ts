import { describe, expect, it } from "vitest";
import { combineScannerRuns, parseGitleaks, parseOsv, scanBuildITRules, scannerInventory } from "../src/index";

const sha = "a".repeat(40);

describe("deterministic scanner evidence", () => {
  it("normalizes pinned Gitleaks evidence without storing the secret", () => {
    const raw = JSON.stringify([{ File: "src/config.ts", StartLine: 4, EndLine: 4, RuleID: "generic-api-key", Fingerprint: "fp" }]);
    const run = parseGitleaks(raw, sha, scannerInventory.gitleaks);
    expect(run).toMatchObject({ complete: true, commitSha: sha, findings: [{ severity: "critical", path: "src/config.ts", startLine: 4 }] });
    expect(JSON.stringify(run)).not.toContain("Secret");
  });

  it("normalizes every OSV vulnerability with manifest provenance", () => {
    const raw = JSON.stringify({ results: [{ source: { path: "package-lock.json" }, packages: [{ vulnerabilities: [{ id: "GHSA-test" }, { id: "CVE-test" }] }] }] });
    expect(parseOsv(raw, sha, scannerInventory.osvScanner).findings.map(item => item.ruleId)).toEqual(["GHSA-test", "CVE-test"]);
  });

  it("runs BuildIT-owned rules with exact lines", () => {
    const run = scanBuildITRules([{ path: "src/server.ts", content: "const ok = 1;\neval(userInput);\nconst agent = { rejectUnauthorized: false };" }], sha);
    expect(run.findings.map(item => [item.ruleId, item.startLine, item.severity])).toEqual([
      ["buildit-js-eval", 2, "warning"],
      ["buildit-tls-disabled", 3, "critical"],
    ]);
  });

  it("refuses unpinned versions, malformed output, commits, and paths", () => {
    expect(() => parseGitleaks("[]", sha, "latest")).toThrow("scanner_version_untrusted");
    expect(() => parseGitleaks("not-json", sha, scannerInventory.gitleaks)).toThrow("scanner_output_malformed");
    expect(() => parseOsv("{}", sha, scannerInventory.osvScanner)).toThrow("scanner_output_malformed");
    expect(() => scanBuildITRules([{ path: "../escape.ts", content: "eval(x)" }], sha)).toThrow("scanner_unsafe_path");
    expect(() => scanBuildITRules([], "branch-name")).toThrow("invalid_scanner_commit");
  });

  it("preserves every scanner name and version in combined evidence", () => {
    const authored = scanBuildITRules([], sha), gitleaks = parseGitleaks("[]", sha, scannerInventory.gitleaks);
    expect(combineScannerRuns(sha, [authored, gitleaks])).toMatchObject({
      complete: true,
      runs: [{ scanner: "builditRules", scannerVersion: "1.0.0" }, { scanner: "gitleaks", scannerVersion: "8.28.0" }],
      findings: [],
    });
    expect(() => combineScannerRuns(sha, [{ ...gitleaks, commitSha: "b".repeat(40) }])).toThrow("scanner_evidence_incomplete");
  });
});

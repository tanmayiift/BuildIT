import { describe, expect, it } from "vitest";
import { combineScannerRuns, parseGitleaks, parseOsv, scanBuildITRules, scannerInventory } from "../src/index";

const sha = "a".repeat(40);
const tlsOff = (quote = "") => `${quote}rejectUnauthorized${quote}: ${["fal", "se"].join("")}`;

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

  it("removes only the sandbox-owned absolute prefix from scanner evidence", () => {
    const gitleaks = JSON.stringify([{ File: "/vercel/sandbox/repo/src/config.ts", StartLine: 4, RuleID: "generic-api-key", Fingerprint: "fp" }]);
    const osv = JSON.stringify({ results: [{ source: { path: "/vercel/sandbox/repo/pnpm-lock.yaml" }, packages: [{ vulnerabilities: [{ id: "GHSA-test" }] }] }] });
    expect(parseGitleaks(gitleaks, sha, scannerInventory.gitleaks).findings[0]?.path).toBe("src/config.ts");
    expect(parseOsv(osv, sha, scannerInventory.osvScanner).findings[0]?.path).toBe("pnpm-lock.yaml");
    for (const unsafe of ["/etc/passwd", "/vercel/sandbox/repository/file", "/vercel/sandbox/repo/../escape"]) {
      const unsafeOsv = JSON.stringify({ results: [{ source: { path: unsafe }, packages: [] }] });
      expect(() => parseOsv(unsafeOsv, sha, scannerInventory.osvScanner)).toThrow("scanner_output_malformed");
    }
  });

  it("runs BuildIT-owned rules with exact lines", () => {
    const run = scanBuildITRules([{ path: "src/server.ts", content: `const ok = 1;\neval(userInput);\nconst agent = { ${tlsOff()} };` }], sha);
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

// BuildIT reviewed its own pull request and raised three findings, all false: buildit-js-eval on
// a Markdown file, buildit-js-eval on a comment reading "React's development build needs eval()",
// and buildit-node-shell on a test file. A finding a reviewer has to dismiss is worse than no
// finding, because it trains people to skim the list that also carries the real ones.
describe("authored rules do not cry wolf", () => {
  const scan = (path: string, content: string) => scanBuildITRules([{ path, content }], "a".repeat(40)).findings;

  it("still catches the thing it is for", () => {
    expect(scan("src/run.ts", "const result = eval(userInput);").map(f => f.ruleId)).toEqual(["buildit-js-eval"]);
    expect(scan("src/run.ts", "execSync(command);").map(f => f.ruleId)).toEqual(["buildit-node-shell"]);
    expect(scan("src/run.ts", "eval(payload) // deliberately dynamic").map(f => f.ruleId)).toEqual(["buildit-js-eval"]);
  });

  it("does not scan prose for JavaScript", () => {
    expect(scan("audit/DEFECT_REGISTER.md", "The runner may eval( untrusted input.")).toEqual([]);
    expect(scan("docs/notes.txt", "we removed eval( last year")).toEqual([]);
    expect(scan("README.md", "execSync( is banned here")).toEqual([]);
  });

  it("does not read a comment as code", () => {
    expect(scan("src/a.ts", "// React's development build needs eval() for callstacks.")).toEqual([]);
    expect(scan("src/a.ts", " * needs eval() at runtime")).toEqual([]);
    expect(scan("src/a.ts", "/* eval( */")).toEqual([]);
    expect(scan("scripts/run.mjs", "# eval( in a shell comment")).toEqual([]);
  });

  // TLS is as easy to disable in configuration as in code, so that rule keeps a wider net.
  it("still checks configuration for a disabled TLS check", () => {
    expect(scan("config/app.json", tlsOff('"')).map(f => f.ruleId)).toEqual(["buildit-tls-disabled"]);
    expect(scan("src/client.ts", tlsOff()).map(f => f.ruleId)).toEqual(["buildit-tls-disabled"]);
  });
});

// The shell rule matched RegExp.prototype.exec - /pattern/.exec(value) - which is among the most
// common calls in any JavaScript codebase. BuildIT reported one on its own pull request as
// "shell command execution requires manual taint review".
describe("shell rule tells a regex from a shell", () => {
  const ruleIds = (content: string) => scanBuildITRules([{ path: "src/a.ts", content }], "a".repeat(40)).findings.map(finding => finding.ruleId);

  it("ignores a regular expression exec", () => {
    expect(ruleIds("const year = /max-age=(\\d+)/.exec(header)?.[1];")).toEqual([]);
    expect(ruleIds("while ((match = pattern.exec(text)) !== null) {}")).toEqual([]);
    expect(ruleIds("const m = someRegex.exec(value);")).toEqual([]);
  });

  it("still catches a shell call", () => {
    expect(ruleIds("exec(command);")).toEqual(["buildit-node-shell"]);
    expect(ruleIds("execSync(`rm -rf ${dir}`);")).toEqual(["buildit-node-shell"]);
    expect(ruleIds("child_process.execSync(command);")).toEqual(["buildit-node-shell"]);
    expect(ruleIds("  const output = exec(userInput);")).toEqual(["buildit-node-shell"]);
  });
});

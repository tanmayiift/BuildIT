export const scannerInventory = {
  gitleaks: "8.28.0",
  osvScanner: "2.2.3",
  builditRules: "1.0.0",
} as const;

export type ScannerFinding = {
  scanner: keyof typeof scannerInventory;
  scannerVersion: string;
  ruleId: string;
  severity: "critical" | "warning" | "info";
  path: string;
  startLine: number;
  endLine: number;
  fingerprint: string;
  summary: string;
};

export type ScannerRun = {
  scanner: keyof typeof scannerInventory;
  scannerVersion: string;
  commitSha: string;
  complete: true;
  findings: ScannerFinding[];
};

export type CombinedScannerRun = ScannerRun & { runs: Array<{ scanner: ScannerRun["scanner"]; scannerVersion: string }> };

export function combineScannerRuns(commitSha: string, runs: ScannerRun[]): CombinedScannerRun {
  const commit = pinnedCommit(commitSha);
  if (!runs.length || runs.some(run => !run.complete || run.commitSha !== commit)) throw new Error("scanner_evidence_incomplete");
  return { scanner: "builditRules", scannerVersion: runs.map(run => `${run.scanner}@${run.scannerVersion}`).join("+"), commitSha: commit, complete: true,
    runs: runs.map(run => ({ scanner: run.scanner, scannerVersion: run.scannerVersion })), findings: runs.flatMap(run => run.findings) };
}

function pinnedCommit(commitSha: string) {
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) throw new Error("invalid_scanner_commit");
  return commitSha.toLowerCase();
}
function parseJson(raw: string) { try { return JSON.parse(raw) as unknown; } catch { throw new Error("scanner_output_malformed"); } }
function safePath(path: unknown): path is string { return typeof path === "string" && path.length > 0 && !path.startsWith("/") && !path.split("/").includes(".."); }
function scannerPath(path: unknown) { const prefix = "/vercel/sandbox/repo/", relative = typeof path === "string" && path.startsWith(prefix) ? path.slice(prefix.length) : path; return safePath(relative) ? relative : undefined; }

export function parseGitleaks(raw: string, commitSha: string, version: string): ScannerRun {
  if (version !== scannerInventory.gitleaks) throw new Error("scanner_version_untrusted");
  const value = parseJson(raw);
  if (!Array.isArray(value)) throw new Error("scanner_output_malformed");
  const findings = value.map((item): ScannerFinding => {
    if (!item || typeof item !== "object") throw new Error("scanner_output_malformed");
    const record = item as Record<string, unknown>, path = scannerPath(record.File), line = record.StartLine, rule = record.RuleID, fingerprint = record.Fingerprint;
    if (!path || !Number.isInteger(line) || (line as number) < 1 || typeof rule !== "string" || typeof fingerprint !== "string") throw new Error("scanner_output_malformed");
    return { scanner: "gitleaks", scannerVersion: version, ruleId: rule, severity: "critical", path, startLine: line as number, endLine: Number.isInteger(record.EndLine) ? record.EndLine as number : line as number, fingerprint, summary: "Potential secret detected by Gitleaks" };
  });
  return { scanner: "gitleaks", scannerVersion: version, commitSha: pinnedCommit(commitSha), complete: true, findings };
}

export function parseOsv(raw: string, commitSha: string, version: string): ScannerRun {
  if (version !== scannerInventory.osvScanner) throw new Error("scanner_version_untrusted");
  const value = parseJson(raw) as { results?: Array<{ source?: { path?: string }; packages?: Array<{ vulnerabilities?: Array<{ id?: string; modified?: string }> }> }> };
  if (!value || !Array.isArray(value.results)) throw new Error("scanner_output_malformed");
  const findings: ScannerFinding[] = [];
  for (const result of value.results) {
    const path = scannerPath(result.source?.path);
    if (!path || !Array.isArray(result.packages)) throw new Error("scanner_output_malformed");
    for (const pkg of result.packages) for (const vulnerability of pkg.vulnerabilities ?? []) {
      if (typeof vulnerability.id !== "string") throw new Error("scanner_output_malformed");
      findings.push({ scanner: "osvScanner", scannerVersion: version, ruleId: vulnerability.id, severity: "warning", path, startLine: 1, endLine: 1, fingerprint: `${path}:${vulnerability.id}`, summary: `Known dependency vulnerability ${vulnerability.id}` });
    }
  }
  return { scanner: "osvScanner", scannerVersion: version, commitSha: pinnedCommit(commitSha), complete: true, findings };
}

const scriptExtensions = /\.[cm]?[jt]sx?$/i;
const configExtensions = /\.(?:json|ya?ml|toml|env|conf)$/i;
// A line that is entirely a comment is prose, whatever words it contains. Code on the same line
// as a trailing comment still matches, because the rule tests the whole line.
const commentLine = /^\s*(?:\/\/|\/\*|\*|#|<!--|--)/;

const authoredRules = [
  { id: "buildit-js-eval", pattern: /\beval\s*\(/g, summary: "Dynamic code execution through eval", severity: "warning" as const, scope: "script" as const },
  { id: "buildit-node-shell", pattern: /\bexec(?:Sync)?\s*\(/g, summary: "Shell command execution requires manual taint review", severity: "warning" as const, scope: "script" as const },
  // Configuration can disable TLS as readily as code can.
  { id: "buildit-tls-disabled", pattern: /["']?rejectUnauthorized["']?\s*:\s*false/g, summary: "TLS certificate verification is disabled", severity: "critical" as const, scope: "script_or_config" as const },
];

function ruleApplies(rule: { scope: "script" | "script_or_config" }, path: string) {
  if (scriptExtensions.test(path)) return true;
  return rule.scope === "script_or_config" && configExtensions.test(path);
}

export function scanBuildITRules(files: Array<{ path: string; content: string }>, commitSha: string): ScannerRun {
  const findings: ScannerFinding[] = [];
  for (const file of files) {
    if (!safePath(file.path)) throw new Error("scanner_unsafe_path");
    const lines = file.content.split("\n");
    for (const rule of authoredRules) lines.forEach((line, index) => {
      if (!ruleApplies(rule, file.path) || commentLine.test(line)) return;
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(line)) findings.push({ scanner: "builditRules", scannerVersion: scannerInventory.builditRules, ruleId: rule.id, severity: rule.severity, path: file.path, startLine: index + 1, endLine: index + 1, fingerprint: `${file.path}:${index + 1}:${rule.id}`, summary: rule.summary });
    });
  }
  return { scanner: "builditRules", scannerVersion: scannerInventory.builditRules, commitSha: pinnedCommit(commitSha), complete: true, findings };
}

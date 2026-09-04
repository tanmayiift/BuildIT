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

// `buildit-rules` is a REQUIRED check, which sets the bar: a rule earns a place here only if it
// fires on the vulnerable form AND stays silent on the ordinary form. The previous set failed that
// on two of its three rules - `exec` matched `regex.exec(input)`, the commonest correct use of the
// word in JavaScript, and blocking a merge over that is how a required check gets turned off in a
// week. packages/scanners/test/rule-corpus.test.ts holds both halves, and the silent half is the
// one that decides whether a team keeps this on.
//
// Severity is proportionate for the same reason. Critical means exploitable as written; anything
// needing human judgement is a warning, because a wolf cried once is a check disabled forever.
const authoredRules = [
  // CWE-295. Exploitable as written: any active network attacker can present any certificate.
  { id: "buildit-tls-disabled", pattern: /["']?rejectUnauthorized["']?\s*:\s*false\b/g,
    summary: "TLS certificate verification is disabled", severity: "critical" as const, scope: "script_or_config" as const },
  // Same defect, process-wide, and easy to miss in review because it looks like configuration.
  { id: "buildit-tls-env-disabled", pattern: /NODE_TLS_REJECT_UNAUTHORIZED\s*(?::|=)\s*["']?0["']?/g,
    summary: "TLS verification disabled for the whole process", severity: "critical" as const, scope: "script_or_config" as const },
  // CWE-78. Only when the command is built from a template or concatenation - a fixed string
  // argument is how everyone correctly shells out, and flagging it is pure noise.
  { id: "buildit-shell-interpolation", pattern: /(?:(?<![.\w])|(?<=child_process\.))(?:exec|execSync|spawn|spawnSync)\s*\(\s*(?:[A-Za-z_$][\w$.]*\s*[,)]|`[^`]*\$\{|["'][^"']*["']\s*\+)/g,
    summary: "Shell command built from interpolated input", severity: "warning" as const, scope: "script" as const },
  // CWE-95. eval of a literal cannot be attacker-controlled, so the rule requires a non-literal.
  { id: "buildit-dynamic-eval", pattern: /(?<![.\w])eval\s*\(\s*(?!["'`])|new\s+Function\s*\(\s*(?!\s*\))/g,
    summary: "Dynamic code execution over a value that is not a literal", severity: "warning" as const, scope: "script" as const },
  // CWE-347. decode() reads the claims without checking the signature; verify() is the correct call.
  { id: "buildit-jwt-unverified", pattern: /\bjwt\s*\.\s*decode\s*\(/g,
    summary: "JWT read without verifying its signature", severity: "critical" as const, scope: "script" as const },
  // CWE-208. Comparing a secret with === leaks its prefix through timing.
  // The right-hand side decides whether this is a timing risk at all, and getting that wrong cost
  // three separate false positives on unmodified upstream code in real reviews, each failing a
  // required check on lines the pull request never touched. `password !== undefined` and
  // `url.password !== ''` are existence and emptiness checks: there is no secret on the other side
  // of the comparison, so there is nothing whose comparison time could leak.
  //
  // Excluding those also fixed the opposite and worse error. The original tail was `\w`, and a
  // quote is not a word character, so a secret compared against a key-shaped string literal - the
  // one shape everybody writes when they get this wrong - could never match at all. The rule was
  // reporting the safe cases and missing the dangerous one.
  { id: "buildit-timing-unsafe-compare", pattern: /\b(?:\w*(?:password|passwd|secret|token|apiKey|api_key|signature|hmac|digest)\w*)\s*(?:===|!==|==|!=)\s*(?:"(?!")|'(?!')|`(?!`)|(?!(?:undefined|null|true|false|NaN)\b|\d)[A-Za-z_$])/gi,
    summary: "Secret compared without a constant-time comparison", severity: "warning" as const, scope: "script" as const },
  // CWE-89. Only interpolation inside something that reads as SQL, so a template literal in a log
  // line does not match.
  { id: "buildit-sql-interpolation", pattern: /`[^`]*\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WHERE|UNION\s+ALL|DROP\s+TABLE)\b[^`]*\$\{/gi,
    summary: "SQL assembled by string interpolation", severity: "critical" as const, scope: "script" as const },
  // CWE-942. A wildcard origin is ordinary for a public API; paired with credentials it is not,
  // and browsers reject the combination precisely because it is unsafe.
  { id: "buildit-cors-wildcard-credentials", pattern: /origin\s*:\s*["']\*["'][^}]{0,120}?credentials\s*:\s*true|credentials\s*:\s*true[^}]{0,120}?origin\s*:\s*["']\*["']/g,
    summary: "CORS allows any origin while sending credentials", severity: "critical" as const, scope: "script_or_config" as const },
];

const testPath = /(?:^|\/)(?:test|tests|spec|specs|__tests__|__fixtures__|fixtures)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/i;

function ruleApplies(rule: { scope: "script" | "script_or_config" }, path: string) {
  if (testPath.test(path)) return false;
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
  findings.sort((left, right) => left.path.localeCompare(right.path) || left.startLine - right.startLine || left.ruleId.localeCompare(right.ruleId));
  return { scanner: "builditRules", scannerVersion: scannerInventory.builditRules, commitSha: pinnedCommit(commitSha), complete: true, findings };
}

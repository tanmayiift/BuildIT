"use node";
import { createHash } from "node:crypto";
import type { CheckResult, PackageManager } from "@buildit/runner";

export type ContextArtifact = { id: string; storageKey: string; checksum: string; size: number };
export type ExecutionResult = { credentialTeardownProved: boolean; stopped: boolean; results: CheckResult[]; outputs: Array<{ planId: string; text: string; truncated: boolean; evidenceTruncated: boolean }> };
export type ScannerSummary = { scanner: string; scannerVersion: string; commitSha: string; complete: true;
  runs?: Array<{ scanner: string; scannerVersion: string }>;
  findings: Array<{ scanner?: string; severity: "critical" | "warning" | "info" }> };
export type ExecutionResponse = { base: ExecutionResult; head: ExecutionResult; scanners: { base: ScannerSummary; head: ScannerSummary } };

export const sha256Json = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function revisionFromStorageKey(storageKey: string): "base" | "head" {
  const match = storageKey.match(/\/context-(base|head)-\d+\.json$/);
  if (!match) throw new Error("context_artifact_revision_invalid");
  return match[1] as "base" | "head";
}

export function detectPackageManager(pathsByRevision: { base: Set<string>; head: Set<string> }): PackageManager {
  const manager = (paths: Set<string>) => {
    const found = [["package-lock.json", "npm"], ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"]].filter(([path]) => paths.has(path!)).map(([, value]) => value as PackageManager);
    if (found.length !== 1 || !paths.has("package.json")) throw new Error("package_manager_unsupported_or_ambiguous");
    return found[0]!;
  };
  const base = manager(pathsByRevision.base), head = manager(pathsByRevision.head);
  if (base !== head) throw new Error("package_manager_changed");
  return base;
}

export function summarizeExecution(output: ExecutionResponse, baseSha: string, headSha: string) {
  if (!output.base.credentialTeardownProved || !output.head.credentialTeardownProved) throw new Error("credential_teardown_unproved");
  const summarize = (revision: "base" | "head", commitSha: string, result: ExecutionResult) => result.results.map(item => ({ revision, commitSha, planId: item.planId, kind: item.kind, required: item.required, conclusion: item.conclusion, ...(item.exitCode === undefined ? {} : { exitCode: item.exitCode }), durationMs: item.durationMs, commandFingerprint: sha256Json({ planId: item.planId, origin: item.origin, executable: item.executable, args: item.args, limits: { timeoutMs: item.timeoutMs, cpuLimit: item.cpuLimit, memoryMb: item.memoryMb, outputBytes: item.outputBytes, fileBytes: item.fileBytes, network: item.network } }) }));
  const scanner = (revision: "base" | "head", commitSha: string, run: ScannerSummary) => {
    if (!run.complete || run.commitSha !== commitSha) throw new Error("scanner_evidence_incomplete");
    const runs = run.runs?.length ? run.runs : [{ scanner: run.scanner, scannerVersion: run.scannerVersion }];
    return runs.map(item => ({ revision, commitSha, planId: item.scanner === "gitleaks" ? "gitleaks" : item.scanner === "osvScanner" ? "osv-scanner" : "buildit-rules",
      kind: item.scanner === "gitleaks" ? "secret_scan" as const : item.scanner === "osvScanner" ? "dependency_audit" as const : "static_analysis" as const,
      required: true, conclusion: run.findings.some(finding => (!finding.scanner || finding.scanner === item.scanner) && finding.severity === "critical") ? "failed" as const : "passed" as const,
      durationMs: 0, commandFingerprint: sha256Json({ scanner: item.scanner, version: item.scannerVersion }) }));
  };
  return [...summarize("base", baseSha, output.base), ...scanner("base", baseSha, output.scanners.base), ...summarize("head", headSha, output.head), ...scanner("head", headSha, output.scanners.head)];
}

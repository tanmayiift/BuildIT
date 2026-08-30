"use node";
import { createHash } from "node:crypto";
import type { CheckResult, PackageManager } from "@buildit/runner";

export type ContextArtifact = { id: string; storageKey: string; checksum: string; size: number };
export type ExecutionResult = { credentialTeardownProved: boolean; stopped: boolean; results: CheckResult[]; outputs: Array<{ planId: string; text: string; truncated: boolean; evidenceTruncated: boolean }> };
export type ScannerSummary = { scanner: string; scannerVersion: string; commitSha: string; complete: true; findings: Array<{ severity: "critical" | "warning" | "info" }> };
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
    return { revision, commitSha, planId: "buildit-rules", kind: "static_analysis" as const, required: true, conclusion: run.findings.some(item => item.severity === "critical") ? "failed" as const : "passed" as const, durationMs: 0, commandFingerprint: sha256Json({ scanner: run.scanner, version: run.scannerVersion }) };
  };
  return [...summarize("base", baseSha, output.base), scanner("base", baseSha, output.scanners.base), ...summarize("head", headSha, output.head), scanner("head", headSha, output.scanners.head)];
}

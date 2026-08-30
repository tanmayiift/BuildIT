"use node";
import { createHash } from "node:crypto";
import { classifyRegression, diagnoseFlakiness, type CheckResult, type CommandPlan, type DiagnosticRun, type PackageManager } from "@buildit/runner";

export type ContextArtifact = { id: string; storageKey: string; checksum: string; size: number };
export type ExecutionResult = { credentialTeardownProved: boolean; stopped: boolean; results: CheckResult[]; outputs: Array<{ planId: string; text: string; truncated: boolean; evidenceTruncated: boolean }> };
export type ScannerSummary = { scanner: string; scannerVersion: string; commitSha: string; complete: true;
  runs?: Array<{ scanner: string; scannerVersion: string }>;
  findings: Array<{ scanner?: string; severity: "critical" | "warning" | "info" }> };
export type ExecutionResponse = { base: ExecutionResult; head: ExecutionResult; diagnostics?:{base:Record<string,DiagnosticRun[]>;head:Record<string,DiagnosticRun[]>}; scanners: { base: ScannerSummary; head: ScannerSummary } };
export type ExecutionEnvironment={configRevision:string;runnerImage:string;runtime:"node22"|"node24";manager:PackageManager;architecture:string;networkPolicy:string;toolVersions:Array<{name:string;version:string}>;install:CommandPlan;checks:CommandPlan[]};

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
  if (!output.base.stopped || !output.head.stopped) throw new Error("sandbox_stop_unproved");
  const proof = { credentialTeardownProved: true as const, sandboxStopped: true as const };
  const summarize = (revision: "base" | "head", commitSha: string, result: ExecutionResult) => result.results.map(item => ({ revision, commitSha, ...proof, planId: item.planId, kind: item.kind, required: item.required, conclusion: item.conclusion, ...(item.exitCode === undefined ? {} : { exitCode: item.exitCode }), durationMs: item.durationMs, commandFingerprint: sha256Json({ planId: item.planId, origin: item.origin, executable: item.executable, args: item.args, limits: { timeoutMs: item.timeoutMs, cpuLimit: item.cpuLimit, memoryMb: item.memoryMb, outputBytes: item.outputBytes, fileBytes: item.fileBytes, network: item.network } }) }));
  const scanner = (revision: "base" | "head", commitSha: string, run: ScannerSummary) => {
    if (!run.complete || run.commitSha !== commitSha) throw new Error("scanner_evidence_incomplete");
    const runs = run.runs?.length ? run.runs : [{ scanner: run.scanner, scannerVersion: run.scannerVersion }];
    return runs.map(item => ({ revision, commitSha, ...proof, planId: item.scanner === "gitleaks" ? "gitleaks" : item.scanner === "osvScanner" ? "osv-scanner" : "buildit-rules",
      kind: item.scanner === "gitleaks" ? "secret_scan" as const : item.scanner === "osvScanner" ? "dependency_audit" as const : "static_analysis" as const,
      required: true, conclusion: run.findings.some(finding => (!finding.scanner || finding.scanner === item.scanner) && finding.severity === "critical") ? "failed" as const : "passed" as const,
      durationMs: 0, commandFingerprint: sha256Json({ scanner: item.scanner, version: item.scannerVersion }) }));
  };
  return [...summarize("base", baseSha, output.base), ...scanner("base", baseSha, output.scanners.base), ...summarize("head", headSha, output.head), ...scanner("head", headSha, output.scanners.head)];
}

export function pairExecutionEvidence(output:ExecutionResponse,baseSha:string,headSha:string,environment:ExecutionEnvironment){if(!/^[0-9a-f]{40}$/.test(baseSha)||!/^[0-9a-f]{40}$/.test(headSha)||baseSha===headSha||!/@sha256:[0-9a-f]{64}$/.test(environment.runnerImage)||!environment.configRevision)throw new Error("execution_environment_invalid");const executionFingerprint=sha256Json({...environment,toolVersions:[...environment.toolVersions].sort((a,b)=>a.name.localeCompare(b.name))}),summaries=summarizeExecution(output,baseSha,headSha),groups=new Map<string,typeof summaries>();for(const item of summaries)groups.set(item.planId,[...(groups.get(item.planId)??[]),item]);const evidence=[];for(const [planId,items] of [...groups].sort(([a],[b])=>a.localeCompare(b))){const rawBase=items.find(item=>item.revision==="base"),rawHead=items.find(item=>item.revision==="head");if(!rawBase||!rawHead||items.length!==2)throw new Error("paired_execution_incomplete");const conclusion=(revision:"base"|"head",fallback:typeof rawBase.conclusion)=>{const runs=output.diagnostics?.[revision]?.[planId];return runs&&runs.length>=2&&diagnoseFlakiness(runs).classification==="flaky"?"flaky" as const:fallback},base={...rawBase,conclusion:conclusion("base",rawBase.conclusion)},head={...rawHead,conclusion:conclusion("head",rawHead.conclusion)},comparable={configRevision:environment.configRevision,runnerImage:environment.runnerImage,toolVersions:sha256Json(environment.toolVersions),architecture:environment.architecture,networkPolicy:environment.networkPolicy};const regression=classifyRegression({commitSha:baseSha,commandFingerprint:base.commandFingerprint,conclusion:base.conclusion,...comparable},{commitSha:headSha,commandFingerprint:head.commandFingerprint,conclusion:head.conclusion,...comparable});const outputFor=(revision:"base"|"head")=>output[revision].outputs.find(item=>item.planId===planId),scannerFor=(revision:"base"|"head")=>{const run=output.scanners[revision],item=(run.runs?.length?run.runs:[{scanner:run.scanner,scannerVersion:run.scannerVersion}]).find(candidate=>(candidate.scanner==="gitleaks"?"gitleaks":candidate.scanner==="osvScanner"?"osv-scanner":"buildit-rules")===planId);return item};const enrich=(revision:"base"|"head",item:typeof base)=>{const commandOutput=outputFor(revision),scanner=scannerFor(revision);return{...item,executionFingerprint,regressionClassification:regression.classification,outputHash:sha256Json(commandOutput?{text:commandOutput.text,truncated:commandOutput.truncated,evidenceTruncated:commandOutput.evidenceTruncated}:{scanner:scanner?.scanner,scannerVersion:scanner?.scannerVersion}),outputTruncated:Boolean(commandOutput?.truncated||commandOutput?.evidenceTruncated),...(scanner?{scannerName:scanner.scanner,scannerVersion:scanner.scannerVersion}:{})}};evidence.push(enrich("base",base),enrich("head",head))}return{executionFingerprint,summaries:evidence}}

"use node";
import { createHash } from "node:crypto";
import { classifyRegression, diagnoseFlakiness, type CheckResult, type CommandPlan, type DiagnosticRun, type PackageManager } from "@buildit/runner";
import { lockfileManager, passedTestCount, testCounts } from "@buildit/contracts";

export type ContextArtifact = { id: string; storageKey: string; checksum: string; size: number };
export type ExecutionResult = { credentialTeardownProved: boolean; stopped: boolean; results: CheckResult[]; outputs: Array<{ planId: string; text: string; truncated: boolean; evidenceTruncated: boolean }> };
export type ScannerSummary = { scanner: string; scannerVersion: string; commitSha: string; complete: true;
  // durationMs is how long that scanner ran, measured where it ran: the runner for Gitleaks and
  // OSV-Scanner, the broker for BuildIT's own rules. Absent from evidence recorded before it existed.
  runs?: Array<{ scanner: string; scannerVersion: string; durationMs?: number }>;
  // Scanners that ran but could not read this repository. Their findings list is empty because they
  // saw nothing, not because there was nothing to see, and the report says so rather than showing
  // a passing check.
  unavailableScanners?: string[];
  findings: Array<{ scanner?: string; severity: "critical" | "warning" | "info" }> };
export type ExecutionResponse = { base: ExecutionResult; head: ExecutionResult; diagnostics?:{base:Record<string,DiagnosticRun[]>;head:Record<string,DiagnosticRun[]>}; scanners: { base: ScannerSummary; head: ScannerSummary } };
export type ExecutionEnvironment={configRevision:string;runnerImage:string;runtime:"node22"|"node24";manager:PackageManager|"none";architecture:string;networkPolicy:string;toolVersions:Array<{name:string;version:string}>;install?:CommandPlan;checks:CommandPlan[]};

export const sha256Json = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function revisionFromStorageKey(storageKey: string): "base" | "head" {
  const match = storageKey.match(/\/context-(base|head)-\d+\.json$/);
  if (!match) throw new Error("context_artifact_revision_invalid");
  return match[1] as "base" | "head";
}

export function detectPackageManager(pathsByRevision: { base: Set<string>; head: Set<string> }): PackageManager | undefined {
  // The lockfile rule is @buildit/contracts' lockfileManager, which the consent panel reads too, so the
  // checks a reader consents to and the checks that run cannot be decided two different ways.
  const manager = (paths: Set<string>): PackageManager | undefined => {
    const found = lockfileManager(paths);
    if (found === "ambiguous") throw new Error("package_manager_unsupported_or_ambiguous");
    if (!found || !paths.has("package.json")) return undefined;
    return found;
  };
  const base = manager(pathsByRevision.base), head = manager(pathsByRevision.head);
  if (base !== head) throw new Error("package_manager_changed");
  return base;
}

export function summarizeExecution(output: ExecutionResponse, baseSha: string, headSha: string) {
  if (!output.base.credentialTeardownProved || !output.head.credentialTeardownProved) throw new Error("credential_teardown_unproved");
  if (!output.base.stopped || !output.head.stopped) throw new Error("sandbox_stop_unproved");
  const proof = { credentialTeardownProved: true as const, sandboxStopped: true as const };
  const summarize = (revision: "base" | "head", commitSha: string, result: ExecutionResult) => result.results.map(item => ({ revision, commitSha, ...proof, planId: item.planId, kind: item.kind, required: item.required, conclusion: item.conclusion, ...(item.exitCode === undefined ? {} : { exitCode: item.exitCode }), ...(item.notRunReason ? { notRunReason: item.notRunReason } : {}), ...(item.noPassingTests ? { noPassingTests: true as const } : {}), ...(item.testCounts ? { testCounts: item.testCounts } : {}), durationMs: item.durationMs, commandFingerprint: sha256Json({ planId: item.planId, origin: item.origin, executable: item.executable, args: item.args, limits: { timeoutMs: item.timeoutMs, cpuLimit: item.cpuLimit, memoryMb: item.memoryMb, outputBytes: item.outputBytes, fileBytes: item.fileBytes, network: item.network } }) }));
  const scanner = (revision: "base" | "head", commitSha: string, run: ScannerSummary) => {
    if (!run.complete || run.commitSha !== commitSha) throw new Error("scanner_evidence_incomplete");
    const runs = run.runs?.length ? run.runs : [{ scanner: run.scanner, scannerVersion: run.scannerVersion }];
    return runs.map(item => ({ revision, commitSha, ...proof, planId: item.scanner === "gitleaks" ? "gitleaks" : item.scanner === "osvScanner" ? "osv-scanner" : "buildit-rules",
      kind: item.scanner === "gitleaks" ? "secret_scan" as const : item.scanner === "osvScanner" ? "dependency_audit" as const : "static_analysis" as const,
      required: !(run.unavailableScanners ?? []).includes(item.scanner ?? ""),
      conclusion: (run.unavailableScanners ?? []).includes(item.scanner ?? "") ? "not_run" as const
        : run.findings.some(finding => (!finding.scanner || finding.scanner === item.scanner) && finding.severity === "critical") ? "failed" as const : "passed" as const,
      durationMs: "durationMs" in item && typeof item.durationMs === "number" && item.durationMs >= 0 ? Math.round(item.durationMs) : 0,
      commandFingerprint: sha256Json({ scanner: item.scanner, version: item.scannerVersion }) }));
  };
  return [...summarize("base", baseSha, output.base), ...scanner("base", baseSha, output.scanners.base), ...summarize("head", headSha, output.head), ...scanner("head", headSha, output.scanners.head)];
}

export function pairExecutionEvidence(output:ExecutionResponse,baseSha:string,headSha:string,environment:ExecutionEnvironment){if(!/^[0-9a-f]{40}$/.test(baseSha)||!/^[0-9a-f]{40}$/.test(headSha)||baseSha===headSha||!/@sha256:[0-9a-f]{64}$/.test(environment.runnerImage)||!environment.configRevision)throw new Error("execution_environment_invalid");const executionFingerprint=sha256Json({...environment,toolVersions:[...environment.toolVersions].sort((a,b)=>a.name.localeCompare(b.name))}),summaries=summarizeExecution(output,baseSha,headSha),groups=new Map<string,typeof summaries>();for(const item of summaries)groups.set(item.planId,[...(groups.get(item.planId)??[]),item]);const evidence=[];for(const [planId,items] of [...groups].sort(([a],[b])=>a.localeCompare(b))){const rawBase=items.find(item=>item.revision==="base"),rawHead=items.find(item=>item.revision==="head");if(!rawBase||!rawHead||items.length!==2)throw new Error("paired_execution_incomplete");const conclusion=(revision:"base"|"head",fallback:typeof rawBase.conclusion)=>{const runs=output.diagnostics?.[revision]?.[planId];return runs&&runs.length>=2&&diagnoseFlakiness(runs).classification==="flaky"?"flaky" as const:fallback},base={...rawBase,conclusion:conclusion("base",rawBase.conclusion)},head={...rawHead,conclusion:conclusion("head",rawHead.conclusion)},comparable={configRevision:environment.configRevision,runnerImage:environment.runnerImage,toolVersions:sha256Json(environment.toolVersions),architecture:environment.architecture,networkPolicy:environment.networkPolicy},insufficientDiagnostics=(["base","head"] as const).some(revision=>{const item=revision==="base"?base:head;return item.conclusion==="failed"&&(output.diagnostics?.[revision]?.[planId]?.length??0)<2});const regression=insufficientDiagnostics?{classification:"unknown" as const,reason:"insufficient_diagnostics"}:classifyRegression({commitSha:baseSha,commandFingerprint:base.commandFingerprint,conclusion:base.conclusion,...comparable},{commitSha:headSha,commandFingerprint:head.commandFingerprint,conclusion:head.conclusion,...comparable});const outputFor=(revision:"base"|"head")=>output[revision].outputs.find(item=>item.planId===planId),scannerFor=(revision:"base"|"head")=>{const run=output.scanners[revision],item=(run.runs?.length?run.runs:[{scanner:run.scanner,scannerVersion:run.scannerVersion}]).find(candidate=>(candidate.scanner==="gitleaks"?"gitleaks":candidate.scanner==="osvScanner"?"osv-scanner":"buildit-rules")===planId);return item};const enrich=(revision:"base"|"head",item:typeof base)=>{const commandOutput=outputFor(revision),scanner=scannerFor(revision);return{...item,executionFingerprint,regressionClassification:regression.classification,outputHash:sha256Json(commandOutput?{text:commandOutput.text,truncated:commandOutput.truncated,evidenceTruncated:commandOutput.evidenceTruncated}:{scanner:scanner?.scanner,scannerVersion:scanner?.scannerVersion}),outputTruncated:Boolean(commandOutput?.truncated||commandOutput?.evidenceTruncated),...(scanner?{scannerName:scanner.scanner,scannerVersion:scanner.scannerVersion}:{})}};evidence.push(enrich("base",base),enrich("head",head))}return{executionFingerprint,summaries:evidence}}

// A project that declares tests BuildIT could not run - package.json has a test script, but there is no
// lockfile to install from - gets a required "test" check on both commits that did not run, with the
// reason recorded. Without it the only required checks are the scanners, they pass, and the verdict
// reads "All required checks passed" for a project whose own test suite never ran. Injected into the
// broker's response, not beside it, so checkRuns, the stored validation artifact and the report all
// read the same check: computeReviewDecision then ends the review inconclusive (tests_need_lockfile).
export const untestableProjectExplanation = "BuildIT did not run this repository's tests. package.json declares a test script, but there is no lockfile (package-lock.json, pnpm-lock.yaml or yarn.lock) at this commit, and BuildIT installs dependencies only from a lockfile. Commit one, then start a new review.";
export function withUntestableProject(output: ExecutionResponse, reason: "no_lockfile" | undefined): ExecutionResponse {
  if (!reason) return output;
  const check: CheckResult = { planId: "test", origin: "built_in", kind: "test", executable: "npm", args: [], required: true,
    timeoutMs: 0, cpuLimit: 0, memoryMb: 0, outputBytes: 0, fileBytes: 0, network: "none", conclusion: "not_run", durationMs: 0, notRunReason: reason };
  const side = (result: ExecutionResult): ExecutionResult => result.results.some(item => item.planId === "test") ? result : {
    ...result,
    results: [...result.results, check],
    outputs: [...result.outputs, { planId: "test", text: untestableProjectExplanation, truncated: false, evidenceTruncated: false }],
  };
  return { ...output, base: side(output.base), head: side(output.head) };
}

// A failed test suite whose own output shows no test passing. computeReviewDecision excuses a test
// failure that was already on the base commit only when the suite otherwise ran; a suite that fails
// entirely - buildit-demo-zod's 194 tests all failing to load - shows nothing about the change. Marked
// on the broker's response, like the not-run test above, so every reader decides from the same flag.
// The counts themselves are recorded too. The page and the comment show only the last six lines of
// output, where vitest never prints its summary, so a suite with 3 of 197 files passing read exactly
// like one with 192 of 194 tests passing; the full text is encrypted and has no operator read path.
export function withTestSuiteEvidence(output: ExecutionResponse): ExecutionResponse {
  const side = (result: ExecutionResult): ExecutionResult => ({
    ...result,
    results: result.results.map(item => {
      if (item.kind !== "test") return item;
      const text = result.outputs.find(entry => entry.planId === item.planId)?.text, counts = testCounts(text);
      const recorded = Object.keys(counts).length ? { ...item, testCounts: counts } : item;
      if (item.conclusion !== "failed") return recorded;
      const passed = passedTestCount(text);
      return passed !== undefined && passed > 0 ? recorded : { ...recorded, noPassingTests: true as const };
    }),
  });
  return { ...output, base: side(output.base), head: side(output.head) };
}

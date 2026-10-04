import { describe, expect, it, vi } from "vitest";
import { computeReviewDecision } from "@buildit/contracts";
import { defaultExecutionPlans, VercelSandboxRunner, type CheckResult, type SandboxFactory, type SandboxLike } from "@buildit/runner";
import { detectPackageManager, pairExecutionEvidence, revisionFromStorageKey, summarizeExecution, untestableProjectExplanation, withTestSuiteEvidence, withUntestableProject, type ExecutionResponse, type ScannerSummary } from "./validationEvidence";

describe("validation evidence", () => {
  it("requires the same unambiguous package manager on base and head", () => {
    expect(detectPackageManager({ base: new Set(["package.json", "pnpm-lock.yaml"]), head: new Set(["package.json", "pnpm-lock.yaml"]) })).toBe("pnpm");
    expect(() => detectPackageManager({ base: new Set(["package.json", "pnpm-lock.yaml"]), head: new Set(["package.json", "package-lock.json"]) })).toThrow("package_manager_changed");
    expect(() => detectPackageManager({ base: new Set(["package.json", "pnpm-lock.yaml", "yarn.lock"]), head: new Set(["package.json", "pnpm-lock.yaml"]) })).toThrow("package_manager_unsupported_or_ambiguous");
  });

  // BuildIT could not review a repository that is not a Node project at all: this threw, the throw
  // sat inside the validation workflow step, and the review died with "a required platform step
  // failed" rather than degrading. Nothing about a review requires a package manager - the three
  // pinned scanners run on any tree and are themselves required checks.
  it("recognises no package manager instead of refusing the repository", () => {
    const gradle = new Set(["build.gradle.kts", "settings.gradle.kts", "gradlew", "composeApp/src/Main.kt"]);
    expect(detectPackageManager({ base: gradle, head: gradle })).toBeUndefined();
    const go = new Set(["go.mod", "go.sum", "main.go"]);
    expect(detectPackageManager({ base: go, head: go })).toBeUndefined();
    // A lockfile with no package.json is still not a Node project BuildIT can install.
    expect(detectPackageManager({ base: new Set(["pnpm-lock.yaml"]), head: new Set(["pnpm-lock.yaml"]) })).toBeUndefined();
  });

  it("still refuses ambiguity, which is a different thing from having nothing to run", () => {
    // Two lockfiles means BuildIT cannot tell which install is correct, and guessing would run the
    // wrong one. That stays a refusal.
    const both = new Set(["package.json", "pnpm-lock.yaml", "package-lock.json"]);
    expect(() => detectPackageManager({ base: both, head: both })).toThrow("package_manager_unsupported_or_ambiguous");
    // Gaining or losing an ecosystem between base and head is also a refusal.
    expect(() => detectPackageManager({ base: new Set(["build.gradle.kts"]), head: new Set(["package.json", "pnpm-lock.yaml"]) })).toThrow("package_manager_changed");
  });

  it("derives revision only from the collision-safe artifact name", () => {
    expect(revisionFromStorageKey("artifacts/o/r/v/a/context-base-12.json")).toBe("base");
    expect(() => revisionFromStorageKey("artifacts/o/r/v/a/context-12.json")).toThrow("context_artifact_revision_invalid");
  });

  it("refuses missing teardown proof and records a critical scanner failure", () => {
    const plan = { planId: "test", origin: "built_in", kind: "test", executable: "npm", args: ["run", "test"], required: true, timeoutMs: 45_000, cpuLimit: 2, memoryMb: 4096, outputBytes: 10_000_000, fileBytes: 1_000_000_000, network: "none", conclusion: "passed", exitCode: 0, durationMs: 5 } as const;
    const run = (commitSha: string, critical = false) => ({ credentialTeardownProved: true, stopped: true, results: [plan], outputs: [], scanner: { scanner: "builditRules", scannerVersion: "1.0.0", commitSha, complete: true as const, findings: critical ? [{ severity: "critical" as const }] : [] } });
    const baseSha = "a".repeat(40), headSha = "b".repeat(40), base = run(baseSha), head = run(headSha, true);
    const output = { base, head, scanners: { base: base.scanner, head: head.scanner } } as unknown as ExecutionResponse;
    expect(summarizeExecution(output, baseSha, headSha).at(-1)).toMatchObject({ revision: "head", kind: "static_analysis", conclusion: "failed" });
    output.head.credentialTeardownProved = false;
    expect(() => summarizeExecution(output, baseSha, headSha)).toThrow("credential_teardown_unproved");
    output.head.credentialTeardownProved = true;
    output.head.stopped = false;
    expect(() => summarizeExecution(output, baseSha, headSha)).toThrow("sandbox_stop_unproved");
  });

  it("records combined scanner runs as separate required checks", () => {
    const plan = { planId: "test", origin: "built_in", kind: "test", executable: "npm", args: ["run", "test"], required: true, timeoutMs: 45_000, cpuLimit: 2, memoryMb: 4096, outputBytes: 10_000_000, fileBytes: 1_000_000_000, network: "none", conclusion: "passed", exitCode: 0, durationMs: 5 } as const;
    const baseSha = "a".repeat(40), headSha = "b".repeat(40);
    const run = (commitSha: string) => ({ credentialTeardownProved: true, stopped: true, results: [plan], outputs: [] });
    const scanner = (commitSha: string) => ({ scanner: "builditRules", scannerVersion: "combined", commitSha, complete: true as const,
      runs: [{ scanner: "builditRules", scannerVersion: "1.0.0" }, { scanner: "gitleaks", scannerVersion: "8.28.0" }],
      findings: [{ scanner: "gitleaks", severity: "critical" as const }] });
    const response = { base: run(baseSha), head: run(headSha), scanners: { base: scanner(baseSha), head: scanner(headSha) } } as unknown as ExecutionResponse;
    const summaries = summarizeExecution(response, baseSha, headSha);
    expect(summaries.every(item => item.credentialTeardownProved && item.sandboxStopped)).toBe(true);
    expect(summaries.filter(item => item.revision === "head" && ["buildit-rules", "gitleaks"].includes(item.planId)).map(item => [item.planId, item.kind, item.conclusion])).toEqual([
      ["buildit-rules", "static_analysis", "passed"], ["gitleaks", "secret_scan", "failed"],
    ]);
  });

  it("binds paired evidence to one environment and classifies each exact command",()=>{const baseSha="a".repeat(40),headSha="b".repeat(40),{install,checks}=defaultExecutionPlans("pnpm"),result=(commitSha:string,failed=false)=>({credentialTeardownProved:true,stopped:true,results:[{...checks[0]!,conclusion:failed?"failed" as const:"passed" as const,exitCode:failed?1:0,durationMs:4}],outputs:[{planId:"test" as const,text:failed?"failed":"passed",truncated:false,evidenceTruncated:false}]}),scanner=(commitSha:string)=>({scanner:"builditRules",scannerVersion:"combined",commitSha,complete:true as const,runs:[{scanner:"builditRules",scannerVersion:"1"}],findings:[]}),output={base:result(baseSha),head:result(headSha,true),diagnostics:{base:{test:[{conclusion:"passed"}]},head:{test:[{conclusion:"failed",failureFingerprint:"x"},{conclusion:"failed",failureFingerprint:"x"}]}},scanners:{base:scanner(baseSha),head:scanner(headSha)}} as ExecutionResponse,environment={configRevision:"cfg-1",runnerImage:`runner@sha256:${"c".repeat(64)}`,runtime:"node24" as const,manager:"pnpm" as const,architecture:"linux-x64",networkPolicy:"deny-all-v1",toolVersions:[{name:"node",version:"24"},{name:"pnpm",version:"10"}],install,checks},paired=pairExecutionEvidence(output,baseSha,headSha,environment);expect(paired.executionFingerprint).toMatch(/^[0-9a-f]{64}$/);expect(paired.summaries.filter(item=>item.planId==="test").every(item=>item.regressionClassification==="introduced"&&item.executionFingerprint===paired.executionFingerprint)).toBe(true);expect(paired.summaries.find(item=>item.planId==="test"&&item.revision==="head")).toMatchObject({outputTruncated:false,outputHash:expect.stringMatching(/^[0-9a-f]{64}$/)})});

  it("rejects an unpinned environment or incomplete base/head pair",()=>{const baseSha="a".repeat(40),headSha="b".repeat(40),{install,checks}=defaultExecutionPlans("npm"),scanner=(commitSha:string)=>({scanner:"builditRules",scannerVersion:"1",commitSha,complete:true as const,findings:[]}),empty={credentialTeardownProved:true,stopped:true,results:[],outputs:[]},output={base:empty,head:empty,scanners:{base:scanner(baseSha),head:scanner(headSha)}} as ExecutionResponse,environment={configRevision:"cfg",runnerImage:"latest",runtime:"node24" as const,manager:"npm" as const,architecture:"linux-x64",networkPolicy:"deny-all-v1",toolVersions:[],install,checks};expect(()=>pairExecutionEvidence(output,baseSha,headSha,environment)).toThrow("execution_environment_invalid")});

  it("makes an alternating diagnostic flaky and never an introduced regression",()=>{const baseSha="a".repeat(40),headSha="b".repeat(40),{install,checks}=defaultExecutionPlans("npm"),plan={...checks[0]!,conclusion:"failed" as const,exitCode:1,durationMs:1},run={credentialTeardownProved:true,stopped:true,results:[plan],outputs:[{planId:"test" as const,text:"failure",truncated:false,evidenceTruncated:false}]},scanner=(commitSha:string)=>({scanner:"builditRules",scannerVersion:"1",commitSha,complete:true as const,findings:[]}),output={base:{...run,results:[{...plan,conclusion:"passed" as const,exitCode:0}]},head:run,diagnostics:{base:{test:[{conclusion:"passed"}]},head:{test:[{conclusion:"failed",failureFingerprint:"x"},{conclusion:"passed"}]}},scanners:{base:scanner(baseSha),head:scanner(headSha)}} as ExecutionResponse,environment={configRevision:"cfg",runnerImage:`runner@sha256:${"c".repeat(64)}`,runtime:"node24" as const,manager:"npm" as const,architecture:"linux-x64",networkPolicy:"deny-all-v1",toolVersions:[],install,checks},paired=pairExecutionEvidence(output,baseSha,headSha,environment),head=paired.summaries.find(item=>item.planId==="test"&&item.revision==="head");expect(head).toMatchObject({conclusion:"flaky",regressionClassification:"flaky"})});
  it("does not call a single failed execution an introduced regression",()=>{const baseSha="a".repeat(40),headSha="b".repeat(40),{install,checks}=defaultExecutionPlans("npm"),basePlan={...checks[0]!,conclusion:"passed" as const,exitCode:0,durationMs:1},headPlan={...basePlan,conclusion:"failed" as const,exitCode:1},result=(plan:CheckResult)=>({credentialTeardownProved:true,stopped:true,results:[plan],outputs:[{planId:"test" as const,text:"bounded",truncated:false,evidenceTruncated:false}]}),scanner=(commitSha:string)=>({scanner:"builditRules",scannerVersion:"1",commitSha,complete:true as const,findings:[]}),output={base:result(basePlan),head:result(headPlan),diagnostics:{base:{test:[{conclusion:"passed"}]},head:{test:[{conclusion:"failed",failureFingerprint:"x"}]}},scanners:{base:scanner(baseSha),head:scanner(headSha)}} as ExecutionResponse,environment={configRevision:"cfg",runnerImage:`runner@sha256:${"c".repeat(64)}`,runtime:"node24" as const,manager:"npm" as const,architecture:"linux-x64",networkPolicy:"deny-all-v1",toolVersions:[],install,checks},paired=pairExecutionEvidence(output,baseSha,headSha,environment),head=paired.summaries.find(item=>item.planId==="test"&&item.revision==="head");expect(head?.regressionClassification).toBe("unknown")});
});

// The end of the chain finding #1 named. A root lockfile above the fetch ceiling is dropped before
// selection can force it in, so detectPackageManager finds nothing on either revision and no
// install, test, lint or typecheck runs - and the dependency audit used to report an empty result,
// which summarizeExecution records as required and passed. The published check said
// "Ready for human review" over `| osv-scanner | Required | Passed |` for a repository whose
// dependencies were never read, and nothing an author or an operator could see explained it.
//
// The other half of the requirement is that the review still decides. Treating an unread manifest
// as grounds to void the verdict is the mistake this codebase has already made twice; the
// deterministic checks did run, so the fix reports what was and was not scanned and leaves the
// verdict alone.
describe("a repository whose dependency manifest never arrived", () => {
  function sandbox() {
    const fake: SandboxLike = {
      writeFiles: vi.fn(async () => {}),
      readFileToBuffer: vi.fn(async file => Buffer.from(file.path.includes("osv") ? '{"results":[]}' : "[]")),
      updateNetworkPolicy: vi.fn(async () => ({})),
      runCommand: vi.fn(async () => ({ exitCode: 0, durationMs: 5, stdout: async () => "CI=true\n", stderr: async () => "" })),
      stop: vi.fn(async () => ({})),
    };
    return vi.fn(async (_input: Parameters<SandboxFactory>[0]) => fake);
  }

  // Exactly what packages/broker/src/execution-http.ts composes from a runner result.
  const scannerSummary = (commitSha: string, unavailableScanners?: string[]): ScannerSummary => ({
    scanner: "builditRules", scannerVersion: "combined", commitSha, complete: true,
    runs: [{ scanner: "builditRules", scannerVersion: "1.0.0" }, { scanner: "gitleaks", scannerVersion: "8.28.0" }, { scanner: "osvScanner", scannerVersion: "2.2.3" }],
    ...(unavailableScanners?.length ? { unavailableScanners } : {}), findings: [],
  });

  // The runner timed nothing about the scanners, so every scanner check recorded 0 ms and the per-review
  // sandbox ledger read 0 for a review that used thirteen seconds of sandbox.
  it("times each scanner command it runs in the sandbox", async () => {
    const runner = new VercelSandboxRunner(sandbox());
    const common = { runtime: "node24" as const, revision: "base" as const, sandboxName: "buildit-timing", files: [{ path: "src/index.ts", content: "export {}" }], checks: [] };
    await runner.runSegment({ ...common, segment: { stage: "prepare", index: 0 } });
    const scanned = await runner.runSegment({ ...common, segment: { stage: "scanners", index: 0 } }) as { gitleaksDurationMs?: number; osvDurationMs?: number };
    expect(typeof scanned.gitleaksDurationMs).toBe("number");
    expect(typeof scanned.osvDurationMs).toBe("number");
    expect(scanned.gitleaksDurationMs!).toBeGreaterThanOrEqual(0);
  });

  it("reports the dependency audit as advisory and still reaches a verdict", async () => {
    const baseSha = "a".repeat(40), headSha = "b".repeat(40);
    // No manager was detected, so reviewValidationWorker sends no install and no checks - and the
    // three segments that remain are the ones that still have something to do on any tree.
    const revision = async () => {
      const runner = new VercelSandboxRunner(sandbox());
      const common = { runtime: "node24" as const, revision: "base" as const, sandboxName: "buildit-evidence", files: [{ path: "src/index.ts", content: "export {}" }], checks: [] };
      const prepared = await runner.runSegment({ ...common, segment: { stage: "prepare", index: 0 } });
      const scanned = await runner.runSegment({ ...common, segment: { stage: "scanners", index: 0 } });
      const released = await runner.runSegment({ ...common, segment: { stage: "compare", index: 0 } });
      return { ...prepared, ...scanned, ...released };
    };
    const [base, head] = [await revision(), await revision()];
    const output = { base: { ...base, outputs: [] }, head: { ...head, outputs: [] },
      scanners: { base: scannerSummary(baseSha, base.unavailableScanners), head: scannerSummary(headSha, head.unavailableScanners) } } as unknown as ExecutionResponse;
    const summaries = summarizeExecution(output, baseSha, headSha);
    const osv = summaries.find(item => item.revision === "head" && item.planId === "osv-scanner");
    expect(osv).toMatchObject({ kind: "dependency_audit", required: false, conclusion: "not_run" });

    const decision = computeReviewDecision({ isStale: false, environmentAvailable: true, findings: [],
      checks: summaries.filter(item => item.revision === "head").map(item => ({ name: item.planId, required: item.required, conclusion: item.conclusion, evidenceComplete: true })) });
    // Not inconclusive: gitleaks and buildit-rules did run on the delivered tree and are required.
    expect(decision.status).toBe("checks_passed");
    expect(summaries.filter(item => item.revision === "head" && item.required).map(item => item.planId).sort()).toEqual(["buildit-rules", "gitleaks"]);
  });
});

// buildit-demo-p-queue#2 on 4 October 2026: package.json has a test script, there is no lockfile, so no
// package manager was detected and only the scanners ran. The verdict read "All required checks
// passed" for a project whose own test suite never ran. These hold the fix end to end, from the
// broker's response to the verdict, through the same functions the worker and the report use.
describe("a project whose declared tests cannot run", () => {
  const baseSha = "a".repeat(40), headSha = "b".repeat(40);
  const scanners = (commitSha: string, durations?: [number, number, number]): ScannerSummary => ({
    scanner: "builditRules", scannerVersion: "combined", commitSha, complete: true,
    runs: [{ scanner: "builditRules", scannerVersion: "1.0.0", ...(durations ? { durationMs: durations[0] } : {}) },
      { scanner: "gitleaks", scannerVersion: "8.28.0", ...(durations ? { durationMs: durations[1] } : {}) },
      { scanner: "osvScanner", scannerVersion: "2.2.3", ...(durations ? { durationMs: durations[2] } : {}) }],
    unavailableScanners: ["osvScanner"], findings: [],
  });
  const scannerOnly = (durations?: [number, number, number]): ExecutionResponse => ({
    base: { credentialTeardownProved: true, stopped: true, results: [], outputs: [] },
    head: { credentialTeardownProved: true, stopped: true, results: [], outputs: [] },
    scanners: { base: scanners(baseSha, durations), head: scanners(headSha, durations) },
  });
  const decide = (output: ExecutionResponse) => computeReviewDecision({ isStale: false, environmentAvailable: true, findings: [],
    checks: summarizeExecution(output, baseSha, headSha).filter(item => item.revision === "head").map(item => ({ name: item.planId, required: item.required,
      conclusion: item.conclusion, evidenceComplete: true, ...("notRunReason" in item && item.notRunReason ? { notRunReason: item.notRunReason } : {}) })) });

  it("was a plain pass on the scanners alone, which is the defect", () => {
    expect(decide(scannerOnly()).status).toBe("checks_passed");
  });

  it("is inconclusive with a reason that points at the lockfile, not at a retry", () => {
    const decision = decide(withUntestableProject(scannerOnly(), "no_lockfile"));
    expect(decision).toMatchObject({ status: "inconclusive", reason: "tests_need_lockfile", nextAction: "add_lockfile", missingChecks: ["test"] });
  });

  it("records the not-run test on both commits, with its reason, in the evidence checkRuns is built from", () => {
    const environment = { configRevision: "cfg-1", runnerImage: `runner@sha256:${"c".repeat(64)}`, runtime: "node24" as const, manager: "none" as const,
      architecture: "linux-x64", networkPolicy: "deny-all-v1", toolVersions: [{ name: "node", version: "24" }], checks: [] };
    const paired = pairExecutionEvidence(withUntestableProject(scannerOnly(), "no_lockfile"), baseSha, headSha, environment);
    const tests = paired.summaries.filter(item => item.planId === "test");
    expect(tests.map(item => [item.revision, item.required, item.conclusion, "notRunReason" in item ? item.notRunReason : undefined]))
      .toEqual([["base", true, "not_run", "no_lockfile"], ["head", true, "not_run", "no_lockfile"]]);
  });

  it("says why in the output the report and the review page read", () => {
    const output = withUntestableProject(scannerOnly(), "no_lockfile");
    expect(output.head.outputs.find(item => item.planId === "test")?.text).toBe(untestableProjectExplanation);
    expect(untestableProjectExplanation).toMatch(/lockfile/);
    expect(untestableProjectExplanation).toMatch(/did not run/);
  });

  it("leaves a project without a reason untouched", () => {
    const output = scannerOnly();
    expect(withUntestableProject(output, undefined)).toBe(output);
  });

  // The per-review sandbox ledger is the sum of check durations, and every scanner used to record 0.
  it("records how long each scanner ran instead of 0", () => {
    const head = summarizeExecution(scannerOnly([40, 3100, 2500]), baseSha, headSha).filter(item => item.revision === "head");
    expect(Object.fromEntries(head.map(item => [item.planId, item.durationMs]))).toEqual({ "buildit-rules": 40, gitleaks: 3100, "osv-scanner": 2500 });
  });
});

describe("a failed test suite with no test passing", () => {
  const plan = { origin: "built_in" as const, executable: "pnpm" as const, args: ["run", "test"], required: true, timeoutMs: 150_000, cpuLimit: 2, memoryMb: 4096, outputBytes: 0, fileBytes: 0, network: "none" as const };
  const run = (conclusion: "failed" | "passed", text: string): ExecutionResponse["head"] => ({ credentialTeardownProved: true, stopped: true,
    results: [{ ...plan, planId: "test", kind: "test", conclusion, durationMs: 45_000 }], outputs: [{ planId: "test", text, truncated: false, evidenceTruncated: false }] });
  const marked = (side: ExecutionResponse["head"]) => withTestSuiteEvidence({ base: side, head: side, scanners: {} as ExecutionResponse["scanners"] }).head.results[0];

  it("is marked when its output shows no test passing, as buildit-demo-zod's did", () => {
    expect(marked(run("failed", '   const z = await import("../../index.js");\n[194/194]'))).toMatchObject({ noPassingTests: true });
    expect(marked(run("failed", "      Tests  194 failed (194)"))).toMatchObject({ noPassingTests: true });
  });

  it("is not marked when the suite otherwise ran, or passed", () => {
    expect(marked(run("failed", "Tests  2 failed | 192 passed (194)"))).not.toHaveProperty("noPassingTests");
    expect(marked(run("passed", "Tests  194 failed (194)"))).not.toHaveProperty("noPassingTests");
  });
});


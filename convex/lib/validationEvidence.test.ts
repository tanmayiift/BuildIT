import { describe, expect, it } from "vitest";
import { defaultExecutionPlans } from "@buildit/runner";
import { detectPackageManager, pairExecutionEvidence, revisionFromStorageKey, summarizeExecution, type ExecutionResponse } from "./validationEvidence";

describe("validation evidence", () => {
  it("requires the same unambiguous package manager on base and head", () => {
    expect(detectPackageManager({ base: new Set(["package.json", "pnpm-lock.yaml"]), head: new Set(["package.json", "pnpm-lock.yaml"]) })).toBe("pnpm");
    expect(() => detectPackageManager({ base: new Set(["package.json", "pnpm-lock.yaml"]), head: new Set(["package.json", "package-lock.json"]) })).toThrow("package_manager_changed");
    expect(() => detectPackageManager({ base: new Set(["package.json", "pnpm-lock.yaml", "yarn.lock"]), head: new Set(["package.json", "pnpm-lock.yaml"]) })).toThrow("package_manager_unsupported_or_ambiguous");
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

  it("binds paired evidence to one environment and classifies each exact command",()=>{const baseSha="a".repeat(40),headSha="b".repeat(40),{install,checks}=defaultExecutionPlans("pnpm"),result=(commitSha:string,failed=false)=>({credentialTeardownProved:true,stopped:true,results:[{...checks[0]!,conclusion:failed?"failed" as const:"passed" as const,exitCode:failed?1:0,durationMs:4}],outputs:[{planId:"test" as const,text:failed?"failed":"passed",truncated:false,evidenceTruncated:false}]}),scanner=(commitSha:string)=>({scanner:"builditRules",scannerVersion:"combined",commitSha,complete:true as const,runs:[{scanner:"builditRules",scannerVersion:"1"}],findings:[]}),output={base:result(baseSha),head:result(headSha,true),scanners:{base:scanner(baseSha),head:scanner(headSha)}} as ExecutionResponse,environment={configRevision:"cfg-1",runnerImage:`runner@sha256:${"c".repeat(64)}`,runtime:"node24" as const,manager:"pnpm" as const,architecture:"linux-x64",networkPolicy:"deny-all-v1",toolVersions:[{name:"node",version:"24"},{name:"pnpm",version:"10"}],install,checks},paired=pairExecutionEvidence(output,baseSha,headSha,environment);expect(paired.executionFingerprint).toMatch(/^[0-9a-f]{64}$/);expect(paired.summaries.filter(item=>item.planId==="test").every(item=>item.regressionClassification==="introduced"&&item.executionFingerprint===paired.executionFingerprint)).toBe(true);expect(paired.summaries.find(item=>item.planId==="test"&&item.revision==="head")).toMatchObject({outputTruncated:false,outputHash:expect.stringMatching(/^[0-9a-f]{64}$/)})});

  it("rejects an unpinned environment or incomplete base/head pair",()=>{const baseSha="a".repeat(40),headSha="b".repeat(40),{install,checks}=defaultExecutionPlans("npm"),scanner=(commitSha:string)=>({scanner:"builditRules",scannerVersion:"1",commitSha,complete:true as const,findings:[]}),empty={credentialTeardownProved:true,stopped:true,results:[],outputs:[]},output={base:empty,head:empty,scanners:{base:scanner(baseSha),head:scanner(headSha)}} as ExecutionResponse,environment={configRevision:"cfg",runnerImage:"latest",runtime:"node24" as const,manager:"npm" as const,architecture:"linux-x64",networkPolicy:"deny-all-v1",toolVersions:[],install,checks};expect(()=>pairExecutionEvidence(output,baseSha,headSha,environment)).toThrow("execution_environment_invalid")});

  it("makes an alternating diagnostic flaky and never an introduced regression",()=>{const baseSha="a".repeat(40),headSha="b".repeat(40),{install,checks}=defaultExecutionPlans("npm"),plan={...checks[0]!,conclusion:"failed" as const,exitCode:1,durationMs:1},run={credentialTeardownProved:true,stopped:true,results:[plan],outputs:[{planId:"test" as const,text:"failure",truncated:false,evidenceTruncated:false}]},scanner=(commitSha:string)=>({scanner:"builditRules",scannerVersion:"1",commitSha,complete:true as const,findings:[]}),output={base:{...run,results:[{...plan,conclusion:"passed" as const,exitCode:0}]},head:run,diagnostics:{base:{test:[{conclusion:"passed"}]},head:{test:[{conclusion:"failed",failureFingerprint:"x"},{conclusion:"passed"}]}},scanners:{base:scanner(baseSha),head:scanner(headSha)}} as ExecutionResponse,environment={configRevision:"cfg",runnerImage:`runner@sha256:${"c".repeat(64)}`,runtime:"node24" as const,manager:"npm" as const,architecture:"linux-x64",networkPolicy:"deny-all-v1",toolVersions:[],install,checks},paired=pairExecutionEvidence(output,baseSha,headSha,environment),head=paired.summaries.find(item=>item.planId==="test"&&item.revision==="head");expect(head).toMatchObject({conclusion:"flaky",regressionClassification:"flaky"})});
});

import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe,expect,it,vi} from "vitest";import {BROKER_REQUEST_TIMEOUT_MS,classifyRegression,createNamedPlan,defaultExecutionPlans,diagnoseFlakiness,executionReady,EXECUTION_JOB_DEADLINE_MS,EXECUTION_JOB_PLAN_BUDGET_MS,EXECUTION_JOB_WORK_BUDGET_MS,EXECUTION_STAGE_LIMIT_MS,finalStatus,runFlakyDiagnostics,SANDBOX_DIAGNOSTIC_RERUN_LIMIT,SANDBOX_JOB_LIFETIME_MS,SANDBOX_SCANNER_TIMEOUT_MS,SEGMENT_OVERHEAD_RESERVE_MS,SERVERLESS_SEGMENT_WORK_BUDGET_MS,teardownCredentials,validatePlan,WORKER_CHECKPOINT_RESERVE_MS} from "../src/index.js";
import {firstExecutionSegment,nextExecutionSegment,segmentRunsInSandbox,segmentWorkMs,type ExecutionSegment,type SegmentPlanState} from "../src/executionSegments.js";
describe("runner",()=>{const testPlan=createNamedPlan({planId:"test",manager:"pnpm",origin:"trusted_ref",required:true});it("rejects shell composition and argument changes",()=>expect(()=>validatePlan({...testPlan,args:["run","test;curl evil"]})).toThrow("command_not_allowed"));it("does not expose node, npx, or arbitrary package commands",()=>expect(()=>validatePlan({...testPlan,executable:"node" as "pnpm",args:["-e","process.exit()"]})).toThrow("command_not_allowed"));it("makes install the only registry-networked command and disables lifecycle scripts",()=>{const install=createNamedPlan({planId:"install",manager:"npm",origin:"built_in",required:true});expect(install).toMatchObject({args:["ci","--ignore-scripts","--no-audit"],network:"registry_only"});expect(()=>validatePlan({...testPlan,network:"registry_only"})).toThrow("invalid_network_policy")});it("enforces fixed resource ceilings",()=>expect(()=>validatePlan({...testPlan,memoryMb:9000})).toThrow("invalid_resource_limit"));it("removes every credential channel",()=>{const w=teardownCredentials({files:new Map(),environment:{GITHUB_TOKEN:"x",SAFE:"y"},remote:"https://x:t@github",credentialHelper:"store",tokenRevoked:false});expect(executionReady(w)).toBe(true);expect(w.environment).toEqual({SAFE:"y"})});it("never passes a skipped required check",()=>expect(finalStatus([{...testPlan,conclusion:"not_run",durationMs:0}])).toBe("inconclusive"));it("passes only complete required checks",()=>expect(finalStatus([{...testPlan,conclusion:"passed",durationMs:2}])).toBe("checks_passed"))});
describe("base and head comparison",()=>{const base={commitSha:"a".repeat(40),commandFingerprint:"cmd",configRevision:"cfg",runnerImage:"runner",toolVersions:"node=24",architecture:"arm64",networkPolicy:"none",conclusion:"passed" as const};it("classifies introduced, pre-existing, and resolved failures",()=>{expect(classifyRegression(base,{...base,commitSha:"b".repeat(40),conclusion:"failed"})).toEqual({classification:"introduced"});expect(classifyRegression({...base,conclusion:"failed"},{...base,commitSha:"b".repeat(40),conclusion:"failed"})).toEqual({classification:"pre_existing"});expect(classifyRegression({...base,conclusion:"failed"},{...base,commitSha:"b".repeat(40),conclusion:"passed"})).toEqual({classification:"resolved"})});it("refuses comparison across different environments or incomplete evidence",()=>{expect(classifyRegression(base,{...base,commitSha:"b".repeat(40),runnerImage:"other",conclusion:"failed"})).toEqual({classification:"unknown",reason:"configuration_mismatch:runnerImage"});expect(classifyRegression(base,{...base,commitSha:"b".repeat(40),conclusion:"timed_out"})).toEqual({classification:"unknown",reason:"incomplete_evidence"})});it("keeps flaky evidence separate from regression claims",()=>expect(classifyRegression(base,{...base,commitSha:"b".repeat(40),conclusion:"flaky"})).toEqual({classification:"flaky"}))});
describe("flaky diagnostics",()=>{it("never calls one green rerun a stable pass",()=>expect(diagnoseFlakiness([{conclusion:"passed"}])).toEqual({classification:"insufficient",nextRunAllowed:true}));it("detects alternating outcomes without consuming an Autofix round",()=>expect(diagnoseFlakiness([{conclusion:"failed",failureFingerprint:"x"},{conclusion:"passed"}])).toEqual({classification:"flaky",nextRunAllowed:false,fingerprintStable:true}));it("requires a stable failure fingerprint",()=>{expect(diagnoseFlakiness([{conclusion:"failed",failureFingerprint:"x"},{conclusion:"failed",failureFingerprint:"x"}])).toEqual({classification:"stable_failure",nextRunAllowed:false,failureFingerprint:"x"});expect(diagnoseFlakiness([{conclusion:"failed",failureFingerprint:"x"},{conclusion:"failed",failureFingerprint:"y"}])).toEqual({classification:"unknown_failure",nextRunAllowed:true})});it("enforces the diagnostic ceiling independently",()=>expect(()=>diagnoseFlakiness([{conclusion:"passed"},{conclusion:"passed"},{conclusion:"passed"},{conclusion:"passed"}],3)).toThrow("flaky_rerun_limit_exceeded"))});
describe("bounded flaky execution",()=>{it("stops after an alternating result and does not call a third run",async()=>{const rerun=vi.fn(async()=>({conclusion:"passed" as const})),result=await runFlakyDiagnostics({conclusion:"failed",failureFingerprint:"x"},rerun);expect(result.diagnosis.classification).toBe("flaky");expect(rerun).toHaveBeenCalledOnce()});it("uses at most two diagnostic reruns for unstable failures",async()=>{const rerun=vi.fn().mockResolvedValueOnce({conclusion:"failed",failureFingerprint:"y"}).mockResolvedValueOnce({conclusion:"failed",failureFingerprint:"z"}),result=await runFlakyDiagnostics({conclusion:"failed",failureFingerprint:"x"},rerun);expect(result.runs).toHaveLength(3);expect(rerun).toHaveBeenCalledTimes(2);expect(result.diagnosis.classification).toBe("unknown_failure")});it("never reruns an initial pass",async()=>{const rerun=vi.fn(async()=>({conclusion:"failed" as const}));expect((await runFlakyDiagnostics({conclusion:"passed"},rerun)).diagnosis.classification).toBe("stable_pass");expect(rerun).not.toHaveBeenCalled()})});
// This is the test that caught the drift the first time: vercel.json said 300 (the Hobby maximum)
// long after the project moved to Pro, and the 30-second test budget that forced meant BuildIT could
// not finish reviewing any repository with a real suite, including its own. The repair then was to
// raise maxDuration to 800, which fixed the review and lost the Hobby plan.
//
// What it has to catch now is two things rather than one, because splitting a review across
// invocations split the budget in two. A SEGMENT is what has to fit the function ceiling; the JOB is
// what has to fit the deadline past which no worker will claim it again. A change that keeps one and
// breaks the other is exactly the shape of the original defect.
describe("the budget and the function ceiling are one contract",()=>{
 const plans=defaultExecutionPlans("npm");
 const ceiling=()=>{const config=JSON.parse(readFileSync(join(import.meta.dirname,"../../broker/vercel.json"),"utf8")) as {functions:Record<string,{maxDuration:number}>};return config.functions["api/execute.ts"]!.maxDuration*1000};
 // Every segment the default plan can produce, in the order the worker walks them.
 const sequence=()=>{
  const state:SegmentPlanState={checks:plans.checks,installable:true,installed:["base","head"],
   diagnostics:plans.checks.filter(item=>item.required).map(item=>({planId:item.planId,revisions:["base","head"] as Array<"base"|"head">}))};
  const walked:ExecutionSegment[]=[];
  for(let segment:ExecutionSegment|null=firstExecutionSegment();segment;segment=nextExecutionSegment(segment,state)) {
   if(segmentRunsInSandbox(segment,state)) walked.push(segment);
  }
  return walked;
 };

 it("keeps every single segment inside the 300 second function ceiling",()=>{
  expect(ceiling()).toBe(300_000);
  for(const segment of sequence()){
   const work=segmentWorkMs(segment,plans,SANDBOX_SCANNER_TIMEOUT_MS);
   expect(work,`${segment.stage}:${segment.planId??""}`).toBeLessThanOrEqual(SERVERLESS_SEGMENT_WORK_BUDGET_MS);
   expect(work+SEGMENT_OVERHEAD_RESERVE_MS,`${segment.stage}:${segment.planId??""}`).toBeLessThanOrEqual(BROKER_REQUEST_TIMEOUT_MS);
  }
  // The worker gives up on a segment before the platform would, so a slow one returns a duration
  // the checkpoint can still accept instead of being killed mid-flight with nothing recorded.
  expect(BROKER_REQUEST_TIMEOUT_MS).toBeLessThan(ceiling());
  expect(BROKER_REQUEST_TIMEOUT_MS+WORKER_CHECKPOINT_RESERVE_MS).toBeLessThanOrEqual(EXECUTION_STAGE_LIMIT_MS);
 });

 it("keeps the whole job inside the deadline past which nobody will claim it again",()=>{
  const plan=plans.install.timeoutMs+plans.checks.reduce((sum,item)=>sum+item.timeoutMs,0);
  const diagnostics=plans.checks.filter(item=>item.required).reduce((sum,item)=>sum+item.timeoutMs*SANDBOX_DIAGNOSTIC_RERUN_LIMIT,0);
  // Both independent enforcers must admit the plan the defaults produce. These are the same two
  // numbers as before; what changed is that they now bound the sum of the segments rather than one
  // call, which is why the plan did not have to shrink to reach 300 seconds.
  expect(plan).toBeLessThanOrEqual(EXECUTION_JOB_PLAN_BUDGET_MS);
  expect(plan+diagnostics).toBeLessThanOrEqual(EXECUTION_JOB_WORK_BUDGET_MS);
  // Worst case: every segment takes the whole request timeout the worker allows it.
  expect(sequence().length*(BROKER_REQUEST_TIMEOUT_MS+WORKER_CHECKPOINT_RESERVE_MS)).toBeLessThanOrEqual(EXECUTION_JOB_DEADLINE_MS);
  // And a sandbox created a whole segment after the job was - the latest `prepare` can run - still
  // terminates on its own no later than the deadline, whether or not a sweeper ever looks at it.
  expect(SANDBOX_JOB_LIFETIME_MS+300_000).toBeLessThanOrEqual(EXECUTION_JOB_DEADLINE_MS);
  expect(SANDBOX_JOB_LIFETIME_MS).toBeGreaterThan(plan+diagnostics+SANDBOX_SCANNER_TIMEOUT_MS);
 });
});

describe("shared execution plan",()=>{it("keeps the plan the 300 second ceiling used to cost us",()=>{const value=defaultExecutionPlans("npm");expect(value.install).toMatchObject({planId:"install",timeoutMs:150_000,network:"registry_only"});expect(value.checks.map(item=>[item.planId,item.timeoutMs,item.network])).toEqual([["test",150_000,"none"],["lint",60_000,"none"],["typecheck",60_000,"none"]]);expect(value.install.timeoutMs+value.checks.reduce((sum,item)=>sum+item.timeoutMs,0)).toBe(420_000)})});

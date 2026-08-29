export type CheckKind="test"|"lint"|"typecheck"|"build"|"static_analysis"|"dependency_audit"|"secret_scan";
export type CheckConclusion="passed"|"failed"|"not_run"|"timed_out"|"truncated";
export type CommandPlan={kind:CheckKind;executable:string;args:string[];required:boolean;timeoutMs:number};
export type CheckResult=CommandPlan&{conclusion:CheckConclusion;exitCode?:number;durationMs:number;failureClass?:"code"|"environment"|"tooling_missing"|"timeout"|"resource_limit"|"network_blocked"|"platform"};
const allowed=new Set(["npm","pnpm","yarn","npx","node"]);
export function validatePlan(plan:CommandPlan){if(!allowed.has(plan.executable)||plan.args.some(a=>/[;&|`$<>\n]/.test(a)))throw new Error("command_not_allowed");if(plan.timeoutMs<1||plan.timeoutMs>1_200_000)throw new Error("invalid_timeout");return plan}
export type Workspace={files:Map<string,string>;environment:Record<string,string>;remote?:string;credentialHelper?:string;tokenRevoked:boolean};
export function teardownCredentials(workspace:Workspace){for(const key of Object.keys(workspace.environment))if(/TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL/i.test(key))delete workspace.environment[key];delete workspace.remote;delete workspace.credentialHelper;workspace.tokenRevoked=true;return workspace}
export function executionReady(workspace:Workspace){return workspace.tokenRevoked&&!workspace.remote&&!workspace.credentialHelper&&!Object.keys(workspace.environment).some(k=>/TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL/i.test(k))}
export function finalStatus(results:CheckResult[]){const required=results.filter(r=>r.required);if(required.some(r=>r.conclusion==="not_run"||r.conclusion==="timed_out"||r.conclusion==="truncated"))return "inconclusive" as const;if(required.some(r=>r.conclusion==="failed"))return "changes_requested" as const;return "checks_passed" as const}

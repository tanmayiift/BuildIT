export type Notification={dedupeKey:string;to:string;subject:string;repository:string;prNumber:number;headSha:string;url:string};
export class NotificationOutbox{#sent=new Set<string>();send(value:Notification){if(this.#sent.has(value.dedupeKey))return false;if(/\n|```|diff --git|src\//.test(value.subject))throw new Error("source_content_forbidden");this.#sent.add(value.dedupeKey);return true}}
export type KillSwitches={reviews:boolean;autofix:boolean;runner:boolean;directPush:boolean;providers:Record<string,boolean>};
export function mayStart(kind:"review"|"autofix",switches:KillSwitches,provider:string){return switches.reviews&&switches.runner&&switches.providers[provider]===true&&(kind==="review"||switches.autofix)}
export function watchdog(input:{stageStartedAt:number;now:number;thresholdMs:number;terminal:boolean}){return !input.terminal&&input.now-input.stageStartedAt>input.thresholdMs?"reconcile":"healthy"}
export function hashAudit(previous:string,event:string){return crypto.subtle.digest("SHA-256",new TextEncoder().encode(previous+"\n"+event)).then(v=>Buffer.from(v).toString("hex"))}
export { calculateEffectiveLoc, normalizedExecutableLines, type EffectiveLoc, type SourceFile } from "./effectiveLoc.js";
export { decisionEmail, sendDecisionEmail, type DecisionEmail, type EmailTransport } from "./email.js";

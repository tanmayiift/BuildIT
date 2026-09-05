export { computeReviewDecision, type ReviewCheckDecision } from "@buildit/contracts";
import type {CheckResult} from "@buildit/runner";import {finalStatus} from "@buildit/runner";
export * from "./promptChain.js";
export * from "./reviewPlan.js";
export * from "./requirements.js";
export * from "./contextIndex.js";
export * from "./findings.js";
export * from "./report.js";
export * from "./modelChain.js";
export * from "./patchPolicy.js";
export type Evidence={id:string;path?:string;line?:number;searchScope?:string};
export type Finding={title:string;severity:"critical"|"warning"|"info";verdict:"covered"|"not_covered"|"unclear";evidenceId:string};
export function validateFindings(findings:Finding[],evidence:Evidence[]){const ids=new Set(evidence.map(e=>e.id));return findings.filter(f=>ids.has(f.evidenceId))}
export type Provider={review(input:{requirements:string[];diff:string;evidence:Evidence[]}):Promise<{findings:Finding[];tokens:number;cost:number}>};
export async function withRetry<T>(operation:()=>Promise<T>,options={max:5,baseMs:1},wait=(ms:number)=>new Promise(r=>setTimeout(r,ms))){let error:unknown;for(let i=0;i<=options.max;i++){try{return await operation()}catch(e){error=e;if(i===options.max)break;await wait(options.baseMs*2**i+Math.floor(Math.random()*options.baseMs))}}throw error}
export async function reviewWorkflow(provider:Provider,input:{requirements:string[];diff:string;evidence:Evidence[];checks:CheckResult[]}){const model=await withRetry(()=>provider.review({requirements:input.requirements,diff:input.diff,evidence:input.evidence}));const findings=validateFindings(model.findings,input.evidence);const checkStatus=finalStatus(input.checks);const status=checkStatus==="checks_passed"&&findings.some(f=>f.verdict==="not_covered")?"changes_requested":checkStatus;return{status,findings,tokens:model.tokens,cost:model.cost}}
export type EvidenceRecord={id:string;artifactExists:boolean;commitSha:string;path?:string;pathExists?:boolean;startLine?:number;endLine?:number;contentHash?:string;lineHashMatches?:boolean;stdout?:boolean;scannerParsed?:boolean;truncated:boolean};
export type MaterialClaim={text:string;evidenceIds:string[];certainty:"certain"|"uncertain"};
export function validEvidence(evidence:EvidenceRecord,pinnedCommit:string){if(!evidence.artifactExists||evidence.commitSha.toLowerCase()!==pinnedCommit.toLowerCase()||evidence.truncated)return false;if(evidence.path&&(evidence.pathExists!==true||!Number.isInteger(evidence.startLine)||!Number.isInteger(evidence.endLine)||evidence.startLine!<1||evidence.endLine!<evidence.startLine!||!evidence.contentHash||evidence.lineHashMatches!==true))return false;return true}
const forbiddenClaims=/\b(?:bug[- ]free|fully secure|repository[- ]wide coverage|all edge cases|guaranteed safe)\b/i;
export function gateClaims(claims:MaterialClaim[],evidence:EvidenceRecord[],pinnedCommit:string){const valid=new Set(evidence.filter(item=>validEvidence(item,pinnedCommit)).map(item=>item.id));return claims.filter(claim=>claim.text.trim().length>0&&!forbiddenClaims.test(claim.text)&&claim.evidenceIds.length>0&&claim.evidenceIds.every(id=>valid.has(id))).map(claim=>({...claim,text:claim.certainty==="uncertain"&&!/^uncertain:/i.test(claim.text)?`Uncertain: ${claim.text}`:claim.text}))}
export function verifiedCheckEvidence(evidence:EvidenceRecord){return evidence.stdout===true&&evidence.artifactExists&&!evidence.truncated}
// `preExisting` means this check failed the same way on the base commit. BuildIT runs every check
// on both commits precisely so a failure that was already there is not blamed on someone's change -
// the comparison was being computed and then thrown away, so a repository with a long-broken lint
// or a benchmark that disables TLS had every pull request blocked for it, with nothing in the
// report to explain why. Observed on sindresorhus/got: two required checks failed, no findings.
// Kept consistent with reviewValidationData.finalizeDecision: these are two decision functions
// over the same facts, and this one writes the pull request comment.
export { instructionsForPaths, parseRepositoryConfig, type RepositoryConfig } from "./repositoryConfig.js";
export { demotedByLearning, dismissalsBeforeDemotion } from "./learning.js";
export { changelogEntry, insertChangelogEntry } from "./changelog.js";

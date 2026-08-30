import {createHmac,createSign,timingSafeEqual} from "node:crypto";
export function verifyWebhook(body:Buffer,signature:string|undefined,secret:string){if(!signature?.startsWith("sha256="))return false;const expected=Buffer.from(createHmac("sha256",secret).update(body).digest("hex"),"hex");let actual:Buffer;try{actual=Buffer.from(signature.slice(7),"hex")}catch{return false}return actual.length===expected.length&&timingSafeEqual(actual,expected)}
export type TriggerInput={deliveryId:string;action:string;senderType:string;body:string;permission:"read"|"triage"|"write"|"maintain"|"admin"};
const command=/^\s*@buildit\s+(review|autofix|cancel)(?:\s+(stacked))?\s*$/im;
export function authorizeTrigger(input:TriggerInput){if(input.senderType==="Bot")return{accepted:false as const,reason:"bot"};if(input.action==="edited")return{accepted:false as const,reason:"edited"};const match=input.body.match(command);if(!match)return{accepted:false as const,reason:"no_command"};const kind=match[1]!;const allowed=kind==="review"?["triage","write","maintain","admin"]:["write","maintain","admin"];return allowed.includes(input.permission)?{accepted:true as const,kind,mode:match[2]??"default"}:{accepted:false as const,reason:"permission"}}
export class DeliveryLedger{#ids=new Set<string>();accept(id:string){if(this.#ids.has(id))return false;this.#ids.add(id);return true}}
type TrustedConfigurationInput={defaultBranch:string;trustedRef?:string;headSha:string;trustedSha:string;contentHash:string;protection:{branchProtected:boolean;rulesetProtected:boolean;allowsUntrustedDirectWrites:boolean};approval?:{actorRole:"viewer"|"member"|"admin"|"owner";approvedSha:string}};
export function trustedConfiguration(input:TrustedConfigurationInput){
 const validSha=(value:string)=>/^[0-9a-f]{40}$/i.test(value),validHash=(value:string)=>/^[0-9a-f]{64}$/i.test(value);
 if(!validSha(input.headSha)||!validSha(input.trustedSha)||!validHash(input.contentHash))throw new Error("invalid_configuration_revision");
 const ref=input.trustedRef??input.defaultBranch,sha=input.trustedSha.toLowerCase();
 const protectedRef=(input.protection.branchProtected||input.protection.rulesetProtected)&&!input.protection.allowsUntrustedDirectWrites;
 const approved=Boolean(input.approval&&["admin","owner"].includes(input.approval.actorRole)&&input.approval.approvedSha.toLowerCase()===sha);
 if(input.headSha.toLowerCase()===sha)return{useRepositoryConfig:false as const,provenance:"defaults_only" as const,reason:"pr_head_untrusted" as const};
 if(!protectedRef&&!approved)return{useRepositoryConfig:false as const,provenance:"defaults_only" as const,reason:"unverified_ref" as const};
 const provenance=protectedRef?"protected_ref_merge" as const:"explicit_admin_approval" as const;
 return{useRepositoryConfig:true as const,ref,sha,contentHash:input.contentHash.toLowerCase(),revisionKey:`${sha}:${input.contentHash.toLowerCase()}`,provenance};
}
export function canCommitSensitiveWrite(pinned:string,current:string){return pinned===current}
export type PullRequestSnapshot={number:number;headSha:string;baseSha:string;headRef:string;baseRef:string;isFork:boolean;fromMergeQueue:boolean};
export function pinPullRequest(input:{number:number;head:{sha:string;ref:string;repoFullName:string|null};base:{sha:string;ref:string;repoFullName:string};mergeQueueRef?:string}):PullRequestSnapshot{
 if(!/^[0-9a-f]{40}$/i.test(input.head.sha)||!/^[0-9a-f]{40}$/i.test(input.base.sha))throw new Error("invalid_commit_sha");
 if(!input.head.repoFullName)throw new Error("head_repository_unavailable");
 const fromMergeQueue=input.head.ref.startsWith("gh-readonly-queue/")||Boolean(input.mergeQueueRef);
 return{number:input.number,headSha:input.head.sha.toLowerCase(),baseSha:input.base.sha.toLowerCase(),headRef:input.head.ref,baseRef:input.base.ref,isFork:input.head.repoFullName!==input.base.repoFullName,fromMergeQueue};
}
export function reviewPolicy(snapshot:PullRequestSnapshot,mode:"review"|"autofix",forkPolicy:"manual_review_only"|"disabled"){
 if(snapshot.fromMergeQueue)return{allowed:false as const,reason:"merge_queue_refused"};
 if(snapshot.isFork&&forkPolicy==="disabled")return{allowed:false as const,reason:"fork_disabled"};
 if(snapshot.isFork&&mode==="autofix")return{allowed:false as const,reason:"fork_manual_review_only"};
 return{allowed:true as const};
}
export class PushDebouncer{
 #latest=new Map<string,{headSha:string;readyAt:number}>();
 schedule(scope:string,headSha:string,now:number,delayMs:number){if(delayMs<0)throw new Error("invalid_debounce");const entry={headSha,readyAt:now+delayMs};this.#latest.set(scope,entry);return entry}
 claim(scope:string,headSha:string,now:number){const entry=this.#latest.get(scope);if(!entry||entry.headSha!==headSha||now<entry.readyAt)return false;this.#latest.delete(scope);return true}
}
export function sideEffectKey(input:{repositoryId:number;prNumber:number;headSha:string;kind:"check"|"comment"|"branch"|"stacked_pr";slot?:string}){return`${input.repositoryId}:${input.prNumber}:${input.headSha}:${input.kind}:${input.slot??"primary"}`}
export type StackedPrClient={createBranch(input:{name:string;sha:string}):Promise<void>;createPullRequest(input:{head:string;base:string;title:string;body:string}):Promise<{number:number;url:string}>};
export async function deliverStackedPr(client:StackedPrClient,input:{jobId:string;prNumber:number;sourceBranch:string;pinnedHead:string;currentHead:string;candidateSha:string;allRequiredChecksPassed:boolean;existing?:{number:number;url:string}}){if(input.existing)return input.existing;if(!canCommitSensitiveWrite(input.pinnedHead,input.currentHead))throw new Error("stale_head");if(!input.allRequiredChecksPassed)throw new Error("final_validation_required");const branch=`buildit/pr-${input.prNumber}/${input.jobId}`;await client.createBranch({name:branch,sha:input.candidateSha});return client.createPullRequest({head:branch,base:input.sourceBranch,title:`BuildIT fixes for PR #${input.prNumber}`,body:`Validated candidate ${input.candidateSha}. Human approval and merge required.`})}

type GitHubHttp=(input:string|URL,init?:RequestInit)=>Promise<Response>;
export type TokenStage="review"|"autofix_delivery";
export type TokenScope={installationId:number;repositoryId:number;stage:TokenStage};
type TokenEntry={token:string;expiresAt:number};
const githubHeaders={Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"BuildIT"};

export class GitHubAppClient{
 #appId:string;#privateKey:string;#http:GitHubHttp;#now:()=>number;#tokens=new Map<string,TokenEntry>();
 constructor(input:{appId:string;privateKey:string;http?:GitHubHttp;now?:()=>number}){this.#appId=input.appId;this.#privateKey=input.privateKey;this.#http=input.http??fetch;this.#now=input.now??Date.now}
 #jwt(){const seconds=Math.floor(this.#now()/1000),encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString("base64url"),unsigned=`${encode({alg:"RS256",typ:"JWT"})}.${encode({iat:seconds-60,exp:seconds+540,iss:this.#appId})}`,signer=createSign("RSA-SHA256");signer.update(unsigned);return`${unsigned}.${signer.sign(this.#privateKey,"base64url")}`}
 #key(scope:TokenScope){return`${scope.installationId}:${scope.repositoryId}:${scope.stage}`}
 async assertInstallation(installationId:number){const response=await this.#http(`https://api.github.com/app/installations/${installationId}`,{headers:{...githubHeaders,Authorization:`Bearer ${this.#jwt()}`}});if(response.status===404)throw new Error("installation_unavailable");if(!response.ok)throw new Error(`github_installation_${response.status}`);const installation=await response.json() as {suspended_at?:string|null};if(installation.suspended_at)throw new Error("installation_suspended");return installation}
 async tokenFor(scope:TokenScope){const key=this.#key(scope),cached=this.#tokens.get(key);if(cached&&cached.expiresAt-this.#now()>5*60_000)return cached.token;const permissions=scope.stage==="review"?{metadata:"read",contents:"read",pull_requests:"write",issues:"read",checks:"write"}:{metadata:"read",contents:"write",pull_requests:"write",issues:"read",checks:"write"};const response=await this.#http(`https://api.github.com/app/installations/${scope.installationId}/access_tokens`,{method:"POST",headers:{...githubHeaders,Authorization:`Bearer ${this.#jwt()}`,"Content-Type":"application/json"},body:JSON.stringify({repository_ids:[scope.repositoryId],permissions})});if(response.status===403||response.status===404)throw new Error("repository_or_installation_unavailable");if(!response.ok)throw new Error(`github_token_${response.status}`);const value=await response.json() as {token:string;expires_at:string};this.#tokens.set(key,{token:value.token,expiresAt:Date.parse(value.expires_at)});return value.token}
 revoke(scope:TokenScope){this.#tokens.delete(this.#key(scope))}
 async withToken(scope:TokenScope,operation:(token:string)=>Promise<Response>){let token=await this.tokenFor(scope),response=await operation(token);if(response.status!==401)return response;this.revoke(scope);token=await this.tokenFor(scope);response=await operation(token);return response}
 async repository(input:{installationToken:string;repositoryId:number}){const response=await this.#http(`https://api.github.com/repositories/${input.repositoryId}`,{headers:{...githubHeaders,Authorization:`Bearer ${input.installationToken}`}});if(response.status===401)throw new Error("installation_token_expired");if(response.status===403||response.status===404)throw new Error("repository_unavailable");if(!response.ok)throw new Error(`github_repository_${response.status}`);const repository=await response.json() as {id:number;name:string;full_name:string;private:boolean;archived:boolean};return{githubRepositoryId:repository.id,name:repository.name,fullName:repository.full_name,private:repository.private,archived:repository.archived}}
}
export * from "./repository-content.js";
export * from "./repository-chunks.js";
export * from "./pull-request-context.js";
export * from "./repository-writer.js";

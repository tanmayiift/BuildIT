import { createHash, randomUUID } from "node:crypto";
import { credentialAad, envelopeEncryptSecret, type KmsClient } from "@buildit/security";
export type StoredTrackerCredential={id:string;organizationId:string;repositoryId?:string;provider:"linear"|"jira";workspaceId:string;scopes:string[];ciphertext:string;nonce:string;tag:string;wrappedDataKey:string;kmsKeyId:string;envelopeVersion:1;keyVersion:number;aadDigest:string;maskedSuffix:string;lastValidatedAt:number;expiresAt?:number;replacesConnectionId?:string};
export type TrackerCredentialStore={insertTracker(value:StoredTrackerCredential):Promise<void>};
type Http=(input:string|URL,init?:RequestInit)=>Promise<Response>;
// A Jira site host, and nothing else: no path, no query, no port, no credentials. workspaceId is
// interpolated straight into the request URL, so anything looser is a server-side request forgery
// primitive reachable by any organization admin.
const jiraSiteHost = /^[a-z0-9][a-z0-9-]{0,61}\.atlassian\.net$/i;

export class TrackerCredentialBroker{
 constructor(private readonly store:TrackerCredentialStore,private readonly kms:KmsClient,private readonly kmsKeyId:string,private readonly http:Http=fetch,private readonly now=()=>Date.now()){}
 async save(input:{actorId:string;organizationId:string;repositoryId?:string;provider:"linear"|"jira";workspaceId:string;token:string;scopes:string[];expiresAt?:number;replacesConnectionId?:string}){
  if(input.provider==="jira"&&!jiraSiteHost.test(input.workspaceId))throw new Error("tracker_workspace_invalid");
  const validation=input.provider==="linear"?await this.http("https://api.linear.app/graphql",{method:"POST",headers:{authorization:input.token,"content-type":"application/json"},body:JSON.stringify({query:"query BuildITViewer { viewer { id } }"}),redirect:"manual",signal:AbortSignal.timeout(10_000)}):await this.http(`https://${input.workspaceId}/rest/api/3/myself`,{headers:{authorization:`Bearer ${input.token}`,accept:"application/json"},redirect:"manual",signal:AbortSignal.timeout(10_000)});
  if(!validation.ok)throw new Error(validation.status===401||validation.status===403?"invalid_key":"tracker_unavailable");
  const id=randomUUID(),scope={organizationId:input.organizationId,...(input.repositoryId?{repositoryId:input.repositoryId}:{}),credentialId:id,purpose:"tracker" as const},envelope=await envelopeEncryptSecret(input.token,scope,this.kms,this.kmsKeyId),stored:StoredTrackerCredential={...envelope,id,organizationId:input.organizationId,...(input.repositoryId?{repositoryId:input.repositoryId}:{}),provider:input.provider,workspaceId:input.workspaceId,scopes:input.scopes,aadDigest:createHash("sha256").update(credentialAad(scope)).digest("hex"),maskedSuffix:input.token.slice(-4),lastValidatedAt:this.now(),...(input.expiresAt?{expiresAt:input.expiresAt}:{}),...(input.replacesConnectionId?{replacesConnectionId:input.replacesConnectionId}:{})};
  await this.store.insertTracker(stored);return{id,provider:input.provider,workspaceId:input.workspaceId,maskedSuffix:stored.maskedSuffix,status:"active" as const,lastValidatedAt:stored.lastValidatedAt};
 }
}

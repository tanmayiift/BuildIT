"use node";
import { randomUUID } from "node:crypto";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { issueArtifactGrant } from "@buildit/security";

function required(name:string){const value=process.env[name];if(!value)throw new Error(`missing_${name.toLowerCase()}`);return value}

export const cleanup = internalAction({
  args: {},
  handler: async (ctx):Promise<{claimed:number;deleted:number;failed:number}> => {
    const now=Date.now(),leaseId=randomUUID(),brokerUrl=required("BUILDIT_BROKER_URL").replace(/\/$/,""),secret=Buffer.from(required("ARTIFACT_GRANT_SECRET"),"base64url");
    const artifacts=await ctx.runMutation(internal.artifactCleanupData.claimExpired,{now,leaseId,limit:25});let deleted=0,failed=0;
    for(const artifact of artifacts){
      const grant=issueArtifactGrant({organizationId:String(artifact.organizationId),repositoryId:String(artifact.repositoryId),reviewId:String(artifact.reviewId),artifactId:String(artifact.artifactId),storageKey:artifact.storageKey,operation:"delete"},secret,now);
      try{const response=await fetch(`${brokerUrl}/api/artifacts`,{method:"DELETE",headers:{authorization:`Bearer ${grant}`}});if(!response.ok)throw new Error("broker_delete_failed");const body=await response.json().catch(()=>null) as {deleted?:boolean}|null;if(body?.deleted!==true)throw new Error("broker_delete_failed");await ctx.runMutation(internal.artifactCleanupData.completeDeletion,{artifactId:artifact.artifactId,leaseId,now:Date.now()});deleted+=1}catch{await ctx.runMutation(internal.artifactCleanupData.failDeletion,{artifactId:artifact.artifactId,leaseId,errorCode:"broker_delete_failed",now:Date.now()});failed+=1}
    }
    return{claimed:artifacts.length,deleted,failed};
  },
});

// listTerminal and retryTerminal were written and never called, so an artifact that exhausted its
// attempts stayed stuck forever and "run the deletion reconciler" — the action on the
// BuildITArtifactDeletionBacklog alert — had nothing to run. Rows whose parents are genuinely
// gone are not retryable and are left for the backlog alert to surface.
export const sweepTerminal = internalAction({
  args: {},
  handler: async (ctx): Promise<{ terminal: number; requeued: number }> => {
    const now = Date.now();
    const rows = await ctx.runQuery(internal.artifactCleanupData.listTerminal, { limit: 100 });
    let requeued = 0;
    for (const row of rows) {
      try {
        await ctx.runMutation(internal.artifactCleanupData.retryTerminal, { artifactId: row.artifactId, now });
        requeued += 1;
      } catch { /* Not retryable: the parent review or repository no longer scopes this key. */ }
    }
    return { terminal: rows.length, requeued };
  },
});

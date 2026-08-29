"use client";
import {useAction,useConvexAuth} from "convex/react";
import {makeFunctionReference} from "convex/server";
import {useState} from "react";
import {installationClaimErrorMessage} from "./installation-claim-message";
const claimInstallation=makeFunctionReference<"action",{installationId:number},{organizationId:string;repositoryCount:number}>("githubInstallations:claim");
export function InstallationClaim({installationId}:{installationId:number}){
 const{isAuthenticated,isLoading}=useConvexAuth(),claim=useAction(claimInstallation),[state,setState]=useState<"idle"|"working"|"done"|"error">("idle"),[message,setMessage]=useState(""),returnPath=`/sign-in?returnTo=${encodeURIComponent(`/setup/install?installation_id=${installationId}`)}`;
 if(isLoading)return <div className="boundary-note" aria-live="polite"><strong>Checking your signed-in GitHub identity…</strong> <a href={returnPath}>Sign in and return</a></div>;
 if(!isAuthenticated)return <div className="boundary-note"><strong>One step left:</strong> sign in with the same GitHub account that installed BuildIT. The installation will not be claimed until both accounts match. <a href={returnPath}>Sign in and return</a></div>;
 if(state==="done")return <div className="claim-result success-state" role="status"><strong>Repository access verified</strong><span>{message}</span><a className="button" href="/repositories">Open repositories</a></div>;
 return <div className="claim-result"><div><strong>GitHub installation detected</strong><span>BuildIT will verify that installation {installationId} belongs to this signed-in GitHub identity and import metadata only for selected repositories.</span></div><button className="button" type="button" disabled={state==="working"} onClick={async()=>{setState("working");setMessage("");try{const result=await claim({installationId});setMessage(`${result.repositoryCount} selected ${result.repositoryCount===1?"repository":"repositories"} connected.`);setState("done");window.location.assign(`/repositories?connected=${result.repositoryCount}`)}catch(error){setMessage(installationClaimErrorMessage(error));setState("error")}}}>{state==="working"?"Verifying with GitHub…":"Verify and connect"}</button>{state==="error"?<div><p className="auth-error" role="alert">{message}</p><div className="button-row"><button className="button secondary" type="button" onClick={()=>setState("idle")}>Retry</button><a className="button secondary" href="/account">Check account</a></div></div>:null}</div>
}

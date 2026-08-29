"use node";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { GitHubAppClient } from "@buildit/github";

export const claim=action({args:{installationId:v.number()},handler:async(ctx,args):Promise<{organizationId:string;repositoryCount:number}>=>{
 const identity=await ctx.runQuery(internal.users.installationIdentity,{}),appId=process.env.GITHUB_APP_ID,privateKey=process.env.GITHUB_APP_PRIVATE_KEY;
 if(!appId||!privateKey)throw new Error("github_app_not_configured");
 const client=new GitHubAppClient({appId,privateKey}),installation=await client.assertInstallation(args.installationId) as {id:number;account:{id:number;login:string};target_type:string;suspended_at?:string|null;permissions:Record<string,string>};
 if(installation.target_type!=="User")throw new Error("organization_installation_requires_admin_verification");
 if(installation.account.id!==identity.githubUserId||installation.account.login.toLowerCase()!==identity.githubLogin.toLowerCase())throw new Error("account_installation_mismatch");
 // Repository discovery uses a metadata-only installation token; content is never fetched here.
 const firstTokenResponse=await fetch(`https://api.github.com/app/installations/${args.installationId}/access_tokens`,{method:"POST",headers:{Accept:"application/vnd.github+json",Authorization:`Bearer ${createAppJwt(appId,privateKey)}`,"X-GitHub-Api-Version":"2022-11-28","User-Agent":"BuildIT"},body:JSON.stringify({permissions:{metadata:"read"}})});
 if(!firstTokenResponse.ok)throw new Error(`github_installation_token_${firstTokenResponse.status}`);const token=(await firstTokenResponse.json() as {token:string}).token;
 const repositoriesResponse=await fetch("https://api.github.com/installation/repositories?per_page=100",{headers:{Accept:"application/vnd.github+json",Authorization:`Bearer ${token}`,"X-GitHub-Api-Version":"2022-11-28","User-Agent":"BuildIT"}});if(!repositoriesResponse.ok)throw new Error(`github_repository_list_${repositoriesResponse.status}`);
 const data=await repositoriesResponse.json() as {total_count:number;repositories:Array<{id:number;owner:{login:string};name:string;default_branch:string;visibility?:"public"|"private"|"internal";private?:boolean}>};if(data.total_count!==data.repositories.length)throw new Error("repository_selection_too_large");
 const result=await ctx.runMutation(internal.githubInstallationsData.attachUserInstallation,{userId:identity.userId,githubUserId:identity.githubUserId,githubLogin:identity.githubLogin,installationId:args.installationId,accountLogin:installation.account.login,accountId:installation.account.id,permissions:{metadata:"read",contents:installation.permissions.contents==="write"?"write":"read",pullRequests:"write",issues:"read",checks:installation.permissions.checks==="write"?"write":"read"},repositories:data.repositories.map(repo=>({githubRepositoryId:repo.id,owner:repo.owner.login,name:repo.name,defaultBranch:repo.default_branch||"main",visibility:repo.visibility??(repo.private?"private":"public")})),now:Date.now()});
 return{organizationId:String(result.organizationId),repositoryCount:result.repositoryCount};
}});

import { createSign } from "node:crypto";
function createAppJwt(appId:string,privateKey:string){const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString("base64url"),now=Math.floor(Date.now()/1000),unsigned=`${encode({alg:"RS256",typ:"JWT"})}.${encode({iat:now-60,exp:now+540,iss:appId})}`,signer=createSign("RSA-SHA256");signer.update(unsigned);return`${unsigned}.${signer.sign(privateKey,"base64url")}`}

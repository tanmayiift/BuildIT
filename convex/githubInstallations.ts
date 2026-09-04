"use node";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { GitHubAppClient } from "@buildit/github";

// 20 pages of 100 is 2,000 repositories: past that the install is genuinely too large to attach
// in one request, and the error says so rather than silently attaching a prefix.
const maxInstallationRepositoryPages = 20;

export const claim=action({args:{installationId:v.number()},handler:async(ctx,args):Promise<{organizationId:string;repositoryCount:number}>=>{
 const identity=await ctx.runQuery(internal.users.installationIdentity,{}),appId=process.env.GITHUB_APP_ID,privateKey=process.env.GITHUB_APP_PRIVATE_KEY;
 if(!appId||!privateKey)throw new Error("github_app_not_configured");
 const client=new GitHubAppClient({appId,privateKey}),installation=await client.assertInstallation(args.installationId) as {id:number;account:{id:number;login:string};target_type:string;suspended_at?:string|null;permissions:Record<string,string>};
 const accountType=installation.target_type==="Organization"?"organization":installation.target_type==="User"?"user":null;if(!accountType)throw new Error("unsupported_installation_account");
 if(accountType==="user"&&(installation.account.id!==identity.githubUserId||installation.account.login.toLowerCase()!==identity.githubLogin.toLowerCase()))throw new Error("account_installation_mismatch");
 // Repository discovery uses a metadata-only installation token; content is never fetched here.
 const tokenPermissions=accountType==="organization"?{metadata:"read",members:"read"}:{metadata:"read"};
 const firstTokenResponse=await fetch(`https://api.github.com/app/installations/${args.installationId}/access_tokens`,{method:"POST",headers:{Accept:"application/vnd.github+json",Authorization:`Bearer ${createAppJwt(appId,privateKey)}`,"X-GitHub-Api-Version":"2022-11-28","User-Agent":"BuildIT"},body:JSON.stringify({permissions:tokenPermissions})});
 if(!firstTokenResponse.ok)throw new Error(`github_installation_token_${firstTokenResponse.status}`);const token=(await firstTokenResponse.json() as {token:string}).token;
 if(accountType==="organization"){
  const membershipResponse=await fetch(`https://api.github.com/orgs/${encodeURIComponent(installation.account.login)}/memberships/${encodeURIComponent(identity.githubLogin)}`,{headers:{Accept:"application/vnd.github+json",Authorization:`Bearer ${token}`,"X-GitHub-Api-Version":"2022-11-28","User-Agent":"BuildIT"}});
  if(!membershipResponse.ok)throw new Error("organization_owner_verification_failed");const membership=await membershipResponse.json() as {state?:string;role?:string};if(membership.state!=="active"||membership.role!=="admin")throw new Error("organization_owner_required");
 }
 type InstallationRepository={id:number;owner:{login:string};name:string;default_branch:string;visibility?:"public"|"private"|"internal";private?:boolean};
 const repositories:InstallationRepository[]=[];let total=0;
 for(let page=1;page<=maxInstallationRepositoryPages;page+=1){
  const response=await fetch(`https://api.github.com/installation/repositories?per_page=100&page=${page}`,{headers:{Accept:"application/vnd.github+json",Authorization:`Bearer ${token}`,"X-GitHub-Api-Version":"2022-11-28","User-Agent":"BuildIT"}});
  if(!response.ok)throw new Error(`github_repository_list_${response.status}`);
  const body=await response.json() as {total_count:number;repositories:InstallationRepository[]};
  total=body.total_count;repositories.push(...body.repositories);
  if(repositories.length>=total||body.repositories.length===0)break;
 }
 const data={total_count:total,repositories};if(data.total_count!==data.repositories.length)throw new Error("repository_selection_too_large");
 const result=await ctx.runMutation(internal.githubInstallationsData.attachInstallation,{userId:identity.userId,githubUserId:identity.githubUserId,githubLogin:identity.githubLogin,installationId:args.installationId,accountLogin:installation.account.login,accountId:installation.account.id,accountType,ownershipVerified:true,permissions:{metadata:"read",contents:installation.permissions.contents==="write"?"write":"read",pullRequests:"write",issues:"read",checks:installation.permissions.checks==="write"?"write":"read"},repositories:data.repositories.map(repo=>({githubRepositoryId:repo.id,owner:repo.owner.login,name:repo.name,defaultBranch:repo.default_branch||"main",visibility:repo.visibility??(repo.private?"private":"public")})),now:Date.now()});
 return{organizationId:String(result.organizationId),repositoryCount:result.repositoryCount};
}});

import { createSign } from "node:crypto";
function createAppJwt(appId:string,privateKey:string){const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString("base64url"),now=Math.floor(Date.now()/1000),unsigned=`${encode({alg:"RS256",typ:"JWT"})}.${encode({iat:now-60,exp:now+540,iss:appId})}`,signer=createSign("RSA-SHA256");signer.update(unsigned);return`${unsigned}.${signer.sign(privateKey,"base64url")}`}

// Adding a repository in GitHub used to change nothing here: the App did not subscribe to
// installation_repositories, and the Repositories page only linked out to GitHub, so the only
// thing that ever re-read the list was the setup flow. A customer could grant access and watch
// BuildIT ignore it indefinitely.
//
// This re-lists rather than trusting the payload's repositories_added/removed, so a delivery that
// GitHub retried, reordered or dropped still converges on the truth. It mints a metadata-only
// token: discovering which repositories exist never needs to read one.
export const syncRepositories = internalAction({
  args: { installationId: v.number() },
  handler: async (ctx, args): Promise<{ synced: boolean; added?: number; total?: number }> => {
    const appId = process.env.GITHUB_APP_ID, privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
    if (!appId || !privateKey) throw new Error("github_app_not_configured");

    const tokenResponse = await fetch(`https://api.github.com/app/installations/${args.installationId}/access_tokens`, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${createAppJwt(appId, privateKey)}`,
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "BuildIT" },
      body: JSON.stringify({ permissions: { metadata: "read" } }),
    });
    // A suspended or deleted installation is a fact, not an incident: nothing to sync.
    if (tokenResponse.status === 404 || tokenResponse.status === 403) return { synced: false };
    if (!tokenResponse.ok) throw new Error(`github_installation_token_${tokenResponse.status}`);
    const token = (await tokenResponse.json() as { token: string }).token;

    type InstallationRepository = { id: number; owner: { login: string }; name: string;
      default_branch: string; visibility?: "public" | "private" | "internal"; private?: boolean };
    const repositories: InstallationRepository[] = [];
    let total = 0;
    for (let page = 1; page <= maxInstallationRepositoryPages; page += 1) {
      const response = await fetch(`https://api.github.com/installation/repositories?per_page=100&page=${page}`, {
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "BuildIT" } });
      if (!response.ok) throw new Error(`github_installation_repositories_${response.status}`);
      const body = await response.json() as { total_count?: number; repositories?: InstallationRepository[] };
      total = typeof body.total_count === "number" ? body.total_count : total;
      const batch = body.repositories ?? [];
      repositories.push(...batch);
      if (batch.length < 100) break;
    }
    // Refuse a partial list rather than disabling repositories that are simply on page 21.
    if (total !== repositories.length) throw new Error("repository_selection_too_large");

    return await ctx.runMutation(internal.githubInstallationsData.syncInstallationRepositories, {
      installationId: args.installationId,
      repositories: repositories.map(repo => ({ githubRepositoryId: repo.id, owner: repo.owner.login,
        name: repo.name, defaultBranch: repo.default_branch || "main",
        visibility: repo.visibility ?? (repo.private ? "private" as const : "public" as const) })),
      now: Date.now(),
    });
  },
});

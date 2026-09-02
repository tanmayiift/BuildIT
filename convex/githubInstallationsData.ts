import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";

const repository=v.object({githubRepositoryId:v.number(),owner:v.string(),name:v.string(),defaultBranch:v.string(),visibility:v.optional(v.union(v.literal("public"),v.literal("private"),v.literal("internal"),v.literal("unknown")))});
export const attachInstallation=internalMutation({args:{userId:v.string(),githubUserId:v.number(),githubLogin:v.string(),installationId:v.number(),accountLogin:v.string(),accountId:v.number(),accountType:v.union(v.literal("user"),v.literal("organization")),ownershipVerified:v.boolean(),permissions:v.object({metadata:v.literal("read"),contents:v.union(v.literal("read"),v.literal("write")),pullRequests:v.literal("write"),issues:v.literal("read"),checks:v.union(v.literal("read"),v.literal("write"))}),repositories:v.array(repository),now:v.number()},handler:async(ctx,args)=>{
 if(!args.ownershipVerified)throw new Error("installation_ownership_unverified");if(args.accountType==="user"&&(args.accountId!==args.githubUserId||args.accountLogin.toLowerCase()!==args.githubLogin.toLowerCase()))throw new Error("account_installation_mismatch");
 const slug=args.accountType==="user"?`github-user-${args.githubUserId}`:`github-org-${args.accountId}`;
 const organization=await ctx.db.query("organizations").withIndex("by_slug",q=>q.eq("slug",slug)).unique();
 let organizationId=organization?._id;
 // A Convex mutation runs as a serialized transaction, so nothing can write this row between
 // the read above and this insert. The rule cannot see that.
 // eslint-disable-next-line require-atomic-updates
 if(!organizationId)organizationId=await ctx.db.insert("organizations",{name:args.accountType==="user"?`${args.accountLogin}'s workspace`:args.accountLogin,slug,timezone:"UTC",region:"eu-west-1",retentionHours:24,monthlyBudget:50,concurrencyLimit:3,planId:"trial",fingerprintKeyVersion:1,createdAt:args.now});
 const membership=await ctx.db.query("memberships").withIndex("by_org_user",q=>q.eq("organizationId",organizationId!).eq("userId",args.userId)).unique();
 if(membership&&membership.status==="removed")throw new ConvexError("membership_revoked");
 if(membership&&membership.status!=="active")await ctx.db.patch(membership._id,{status:"active",role:membership.role,updatedAt:args.now});else if(!membership)await ctx.db.insert("memberships",{organizationId,userId:args.userId,role:"owner",status:"active",createdAt:args.now,updatedAt:args.now});
 const installation=await ctx.db.query("githubInstallations").withIndex("by_installation",q=>q.eq("installationId",args.installationId)).unique();
 if(installation&&installation.organizationId!==organizationId)throw new Error("installation_already_claimed");
 const permissionSnapshot=args.permissions;
 const installationDocId=installation?._id??await ctx.db.insert("githubInstallations",{organizationId,installationId:args.installationId,accountLogin:args.accountLogin,accountType:args.accountType,permissionSnapshot,status:"active",createdAt:args.now,updatedAt:args.now});
 if(installation)await ctx.db.patch(installation._id,{accountLogin:args.accountLogin,accountType:args.accountType,permissionSnapshot,status:"active",suspendedAt:undefined,updatedAt:args.now});
 const existing=await ctx.db.query("repositories").withIndex("by_installation",q=>q.eq("installationId",installationDocId)).collect(),selected=new Set(args.repositories.map(repo=>repo.githubRepositoryId));
 for(const stored of existing)if(!selected.has(stored.githubRepositoryId))await ctx.db.patch(stored._id,{enabled:false,pausedAt:args.now,updatedAt:args.now});
 for(const repo of args.repositories){const stored=existing.find(item=>item.githubRepositoryId===repo.githubRepositoryId);if(stored)await ctx.db.patch(stored._id,{owner:repo.owner,name:repo.name,defaultBranch:repo.defaultBranch,visibility:repo.visibility??"unknown",enabled:true,pausedAt:undefined,updatedAt:args.now});else await ctx.db.insert("repositories",{organizationId,installationId:installationDocId,githubRepositoryId:repo.githubRepositoryId,owner:repo.owner,name:repo.name,defaultBranch:repo.defaultBranch,visibility:repo.visibility??"unknown",enabled:true,autofixMode:"stacked",forkPolicy:"manual_review_only",indexState:"not_started",concurrencyLimit:1,createdAt:args.now,updatedAt:args.now})}
 const preference=await ctx.db.query("userPreferences").withIndex("by_user",q=>q.eq("userId",args.userId)).unique();if(preference)await ctx.db.patch(preference._id,{activeOrganizationId:organizationId,updatedAt:args.now});else await ctx.db.insert("userPreferences",{userId:args.userId,activeOrganizationId:organizationId,updatedAt:args.now});
 return{organizationId,installationDocumentId:installationDocId,repositoryCount:args.repositories.length};
}});

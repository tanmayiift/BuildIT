import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { DatabaseWriter } from "./_generated/server";
import type { Id } from "./_generated/dataModel";


// One place where the repository list is reconciled against what the installation can see, because
// this now runs on every installation_repositories webhook and every refresh, not once at setup.
//
// A sync reflects ACCESS, not POLICY. The version of this loop that lived inline patched every
// known repository with `enabled:true, pausedAt:undefined` - harmless while it ran once, and a way
// to silently un-pause every paused repository the moment syncing became routine. So an existing
// row gets only the facts GitHub owns: its name, owner, default branch and visibility. Anything a
// team chose - pausedAt, reviewTrigger, approvedConfigHash, autofixMode, reviewProfile,
// reviewPathFilters - is never touched here.
//
// Re-enabling is the one exception, and it is deliberate: a repository that was removed from the
// installation and later added back is accessible again, and `enabled` tracks access. It stays
// paused if it was paused.
export async function reconcileRepositories(
  ctx: { db: DatabaseWriter },
  args: { organizationId: Id<"organizations">; installationDocId: Id<"githubInstallations">;
    repositories: Array<{ githubRepositoryId: number; owner: string; name: string; defaultBranch: string;
      visibility?: "public" | "private" | "internal" | "unknown" }>; now: number },
) {
  const existing = await ctx.db.query("repositories")
    .withIndex("by_installation", q => q.eq("installationId", args.installationDocId)).collect();
  const selected = new Set(args.repositories.map(repo => repo.githubRepositoryId));

  // Access withdrawn. Disabled, not deleted: the reviews and their evidence still belong to someone.
  for (const stored of existing) {
    if (selected.has(stored.githubRepositoryId)) continue;
    if (!stored.enabled) continue;
    await ctx.db.patch(stored._id, { enabled: false, pausedAt: args.now, updatedAt: args.now });
  }

  let added = 0;
  for (const repo of args.repositories) {
    const stored = existing.find(item => item.githubRepositoryId === repo.githubRepositoryId);
    if (stored) {
      await ctx.db.patch(stored._id, { owner: repo.owner, name: repo.name, defaultBranch: repo.defaultBranch,
        visibility: repo.visibility ?? "unknown", enabled: true, updatedAt: args.now });
      continue;
    }
    added += 1;
    await ctx.db.insert("repositories", { organizationId: args.organizationId, installationId: args.installationDocId,
      githubRepositoryId: repo.githubRepositoryId, owner: repo.owner, name: repo.name, defaultBranch: repo.defaultBranch,
      visibility: repo.visibility ?? "unknown", enabled: true, autofixMode: "stacked",
      forkPolicy: "manual_review_only", indexState: "not_started", concurrencyLimit: 1,
      createdAt: args.now, updatedAt: args.now });
  }
  return { added, total: args.repositories.length };
}

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
 await reconcileRepositories(ctx,{organizationId,installationDocId,repositories:args.repositories,now:args.now});
 const preference=await ctx.db.query("userPreferences").withIndex("by_user",q=>q.eq("userId",args.userId)).unique();if(preference)await ctx.db.patch(preference._id,{activeOrganizationId:organizationId,updatedAt:args.now});else await ctx.db.insert("userPreferences",{userId:args.userId,activeOrganizationId:organizationId,updatedAt:args.now});
 return{organizationId,installationDocumentId:installationDocId,repositoryCount:args.repositories.length};
}});

// The webhook path. Unlike attachInstallation this verifies no ownership and claims no installation:
// it only refreshes the repository list of an installation that was already claimed by someone. An
// installation nobody has attached is ignored rather than created, because a webhook is not a
// person and must not be able to bring a workspace into existence.
export const syncInstallationRepositories = internalMutation({
  args: { installationId: v.number(), repositories: v.array(repository), now: v.number() },
  handler: async (ctx, args) => {
    const installation = await ctx.db.query("githubInstallations")
      .withIndex("by_installation", q => q.eq("installationId", args.installationId)).unique();
    if (!installation || installation.status !== "active") return { synced: false as const };
    const result = await reconcileRepositories(ctx, { organizationId: installation.organizationId,
      installationDocId: installation._id, repositories: args.repositories, now: args.now });
    await ctx.db.patch(installation._id, { updatedAt: args.now });
    return { synced: true as const, ...result };
  },
});

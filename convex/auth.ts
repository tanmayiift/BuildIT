import GitHub from "@auth/core/providers/github";
import { convexAuth } from "@convex-dev/auth/server";
import type { MutationCtx } from "./_generated/server";
import { normalizeGitHubProfile } from "./lib/githubProfile";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [GitHub({
    clientId: process.env.AUTH_GITHUB_ID!,
    clientSecret: process.env.AUTH_GITHUB_SECRET!,
    profile: normalizeGitHubProfile,
  })],
  session: { totalDurationMs: 1000 * 60 * 60 * 24 * 30, inactiveDurationMs: 1000 * 60 * 60 * 24 * 7 },
  callbacks: {
    async redirect({ redirectTo }) {
      if (!redirectTo.startsWith("/") || redirectTo.startsWith("//")) throw new Error("invalid_redirect");
      return `${process.env.SITE_URL!}${redirectTo}`;
    },
    async afterUserCreatedOrUpdated(ctx,{userId,profile,type}) {
      if(type!=="oauth") return;
      const rawId=profile.githubUserId??profile.id,rawLogin=profile.login;
      const githubUserId=typeof rawId==="number"?rawId:typeof rawId==="string"?Number(rawId):NaN;
      if(!Number.isSafeInteger(githubUserId)||typeof rawLogin!=="string"||!rawLogin) throw new Error("github_identity_incomplete");
      const db=ctx.db as unknown as MutationCtx["db"];
      const existing=await db.query("userProfiles").withIndex("by_user",q=>q.eq("userId",userId)).unique();
      const other=await db.query("userProfiles").withIndex("by_github_user",q=>q.eq("githubUserId",githubUserId)).unique();
      if(other&&other.userId!==userId) throw new Error("github_identity_already_linked");
      if(existing) await db.patch(existing._id,{githubUserId,githubLogin:rawLogin,updatedAt:Date.now()});
      else await db.insert("userProfiles",{userId,githubUserId,githubLogin:rawLogin,updatedAt:Date.now()});
    },
  },
});

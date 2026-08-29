import { getAuthSessionId, getAuthUserId, invalidateSessions } from "@convex-dev/auth/server";
import { action, internalQuery, query } from "./_generated/server";

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const profile=await ctx.db.query("userProfiles").withIndex("by_user",q=>q.eq("userId",userId)).unique();
    return { id: user._id, name: user.name ?? null, email: user.email ?? null, image: user.image ?? null, githubLogin: profile?.githubLogin ?? null };
  },
});

export const installationIdentity=internalQuery({args:{},handler:async(ctx)=>{const userId=await getAuthUserId(ctx);if(!userId)throw new Error("authentication_required");const profile=await ctx.db.query("userProfiles").withIndex("by_user",q=>q.eq("userId",userId)).unique();if(!profile)throw new Error("github_identity_incomplete");return{userId,githubUserId:profile.githubUserId,githubLogin:profile.githubLogin}}});

export const sessions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const currentSessionId = await getAuthSessionId(ctx);
    if (!userId || !currentSessionId) return [];
    const sessions = await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId)).collect();
    return sessions.map((session) => ({
      id: session._id,
      current: session._id === currentSessionId,
      expiresAt: session.expirationTime,
    })).sort((a, b) => Number(b.current) - Number(a.current) || b.expiresAt - a.expiresAt);
  },
});

export const revokeOtherSessions = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const currentSessionId = await getAuthSessionId(ctx);
    if (!userId || !currentSessionId) throw new Error("authentication_required");
    await invalidateSessions(ctx, { userId, except: [currentSessionId] });
    return { currentSessionId };
  },
});

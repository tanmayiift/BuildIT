import GitHub from "@auth/core/providers/github";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [GitHub({
    clientId: process.env.AUTH_GITHUB_ID!,
    clientSecret: process.env.AUTH_GITHUB_SECRET!,
  })],
  session: { totalDurationMs: 1000 * 60 * 60 * 24 * 30, inactiveDurationMs: 1000 * 60 * 60 * 24 * 7 },
  callbacks: {
    async redirect({ redirectTo }) {
      if (!redirectTo.startsWith("/") || redirectTo.startsWith("//")) throw new Error("invalid_redirect");
      return `${process.env.SITE_URL!}${redirectTo}`;
    },
  },
});

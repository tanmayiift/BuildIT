import GitHub from "@auth/core/providers/github";import {convexAuth} from "@convex-dev/auth/server";
export const {auth,signIn,signOut,store}=convexAuth({providers:[GitHub({clientId:process.env.AUTH_GITHUB_ID!,clientSecret:process.env.AUTH_GITHUB_SECRET!})]});

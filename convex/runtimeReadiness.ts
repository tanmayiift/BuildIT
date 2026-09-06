import { query } from "./_generated/server";
import { executionEnabled, reviewRuntimeReady } from "./lib/executionGate";

// These are two different facts and used to be ANDed into one boolean before the client saw
// anything. The deliberate safety switch is a product state; a missing REVIEW_RUNTIME_ENV value is
// one of BuildIT's own deployment secrets being unset. Flattened together, every customer surface
// picked the safety story - so a rotated secret nobody re-set told a paying owner that BuildIT was
// holding their repository back on safety grounds. requireExecutionEnabled in lib/executionGate.ts
// already separates them when it throws; this reports them separately too.
export const current = query({
  args: {},
  handler: async (ctx) => {
    const signedIn = Boolean(await ctx.auth.getUserIdentity());
    return { executionEnabled: signedIn && executionEnabled(), runtimeConfigured: signedIn && reviewRuntimeReady() };
  },
});

import { query } from "./_generated/server";
import { executionEnabled } from "./lib/executionGate";

export const current = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    return { executionEnabled: Boolean(identity) && executionEnabled() };
  },
});

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { storageStateOf } from "./lib/artifactState";

// Moves every artifact from redactionStatus to storageState, one page per mutation, rescheduling
// itself until the table is done. Convex validates every write against the schema, so the field
// can only leave the schema once no row carries it - this is what empties it.
//
// A legacy "rejected" stops the run instead of being mapped. Nothing has ever written it, so a row
// holding it is something unexplained, and guessing it was pending would let a later completion
// mark an artifact stored that was refused.
export const run = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), migrated: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("artifacts").paginate({ cursor: args.cursor ?? null, numItems: 200 });
    let migrated = args.migrated ?? 0;
    for (const artifact of page.page) {
      if (artifact.redactionStatus === undefined) continue;
      const state = storageStateOf(artifact);
      if (!state) throw new Error(`artifact_state_unmappable:${artifact._id}`);
      await ctx.db.patch(artifact._id, { storageState: state, redactionStatus: undefined });
      migrated += 1;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.artifactStorageMigration.run, { cursor: page.continueCursor, migrated });
    return { migrated, done: page.isDone };
  },
});

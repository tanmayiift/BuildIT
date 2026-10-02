import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

// Removes two organization fields that were written once and never read:
//
// - planId was hardcoded "trial" while /pricing said there is no trial clock, and nothing branched
//   on it. The limits that do refuse work are monthlyBudget, concurrencyLimit and the sandbox
//   allowance, which /pricing names.
// - fingerprintKeyVersion advertised versioned per-tenant fingerprint keys. There is one
//   deployment-wide key and no versioning (docs/operations/known-defects.md); a field claiming
//   otherwise is the defect.
//
// Convex validates writes against the schema, so the fields leave the schema only after no row
// carries them. One page per mutation, rescheduling itself until the table is done.
export const run = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), cleared: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("organizations").paginate({ cursor: args.cursor ?? null, numItems: 200 });
    let cleared = args.cleared ?? 0;
    for (const organization of page.page) {
      if (organization.planId === undefined && organization.fingerprintKeyVersion === undefined) continue;
      await ctx.db.patch(organization._id, { planId: undefined, fingerprintKeyVersion: undefined });
      cleared += 1;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.organizationFieldMigration.run, { cursor: page.continueCursor, cleared });
    return { cleared, done: page.isDone };
  },
});

import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrganizationRole } from "./lib/authz";

async function digest(value: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join(""); }
export const list = query({
  args: { organizationId: v.id("organizations"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireOrganizationRole(ctx, args.organizationId, "viewer");
    const limit = args.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("invalid_audit_limit");
    const events = await ctx.db.query("auditEvents").withIndex("by_org_created", q => q.eq("organizationId", args.organizationId)).order("asc").take(1_000);
    let chainValid = true, previous: string | undefined;
    for (const event of events) {
      if (event.previousHash !== previous) chainValid = false;
      const expected = await digest(JSON.stringify({ previousHash: previous ?? null, organizationId: event.organizationId,
        actorId: event.actorId, action: event.action, resourceType: event.resourceType, resourceId: event.resourceIdHash,
        requestId: event.requestId, result: event.result, createdAt: event.createdAt }));
      if (expected !== event.eventHash) chainValid = false;
      previous = event.eventHash;
    }
    return { chainValid, truncated: events.length === 1_000, events: await Promise.all(events.slice(-limit).reverse().map(async event => ({ id: event._id,
      actorIdHash: await digest(event.actorId), action: event.action, resourceType: event.resourceType,
      resourceFingerprint: event.resourceIdHash.slice(0, 12), result: event.result, createdAt: event.createdAt }))) };
  },
});

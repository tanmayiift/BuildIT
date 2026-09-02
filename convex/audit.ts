import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrganizationRole } from "./lib/authz";

type AuditEvent = { previousHash?: string; organizationId: unknown; actorId: string; action: string; resourceType: string; resourceIdHash: string; requestId: string; result: string; createdAt: number };
function eventDigest(event: AuditEvent) {
  return digest(JSON.stringify({ previousHash: event.previousHash ?? null, organizationId: event.organizationId,
    actorId: event.actorId, action: event.action, resourceType: event.resourceType, resourceId: event.resourceIdHash,
    requestId: event.requestId, result: event.result, createdAt: event.createdAt }));
}
async function digest(value: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join(""); }
// The audit view read the OLDEST 1,000 events ascending and then sliced the tail, so once an
// organization passed 1,000 events the page froze on events 900-1,000 and nothing that happened
// afterwards ever appeared - on the one screen whose entire purpose is showing what happened.
export const list = query({
  args: { organizationId: v.id("organizations"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireOrganizationRole(ctx, args.organizationId, "viewer");
    const limit = args.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("invalid_audit_limit");
    // Newest first, and one extra row so the window's first entry has a predecessor to check
    // its previousHash against.
    const window = await ctx.db.query("auditEvents").withIndex("by_org_created", q => q.eq("organizationId", args.organizationId)).order("desc").take(limit + 1);
    const events = window.slice(0, limit), predecessor = window[limit];
    const ascending = [...events].reverse();
    // Verifies this window, not the whole chain: a suffix cannot be checked back to genesis.
    // verifyChain does that, paginated, without blocking a live subscription.
    let chainValid = true, previous = predecessor?.eventHash;
    for (const event of ascending) {
      if (previous !== undefined && event.previousHash !== previous) chainValid = false;
      if (await eventDigest(event) !== event.eventHash) chainValid = false;
      previous = event.eventHash;
    }
    return { chainValid, truncated: window.length > limit, events: await Promise.all(events.map(async event => ({ id: event._id,
      actorIdHash: await digest(event.actorId), action: event.action, resourceType: event.resourceType,
      resourceFingerprint: event.resourceIdHash.slice(0, 12), result: event.result, createdAt: event.createdAt }))) };
  },
});

// Full hash-chain verification genuinely needs ascending order from the first event ever written,
// which is unbounded and does not belong on a live query. Paginate it instead: call with no
// cursor, then with the cursor it returns, until done is true.
export const verifyChain = query({
  args: { organizationId: v.id("organizations"), cursor: v.optional(v.string()), previousHash: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireOrganizationRole(ctx, args.organizationId, "viewer");
    const page = await ctx.db.query("auditEvents").withIndex("by_org_created", q => q.eq("organizationId", args.organizationId)).order("asc")
      .paginate({ numItems: 500, cursor: args.cursor ?? null });
    let chainValid = true, previous = args.previousHash;
    for (const event of page.page) {
      if (event.previousHash !== previous) chainValid = false;
      if (await eventDigest(event) !== event.eventHash) chainValid = false;
      previous = event.eventHash;
    }
    return { chainValid, verified: page.page.length, done: page.isDone, cursor: page.continueCursor, previousHash: previous };
  },
});

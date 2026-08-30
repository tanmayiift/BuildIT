import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function appendAuditEvent(ctx: MutationCtx, input: {
  organizationId: Id<"organizations">; actorId: string; action: string; resourceType: string;
  resourceId: string; requestId: string; result: "allowed" | "denied" | "failed"; createdAt: number;
}) {
  if (!/^[A-Za-z0-9:_-]{16,128}$/.test(input.requestId)) throw new Error("invalid_request_id");
  const duplicate = await ctx.db.query("auditEvents").withIndex("by_request", q => q.eq("requestId", input.requestId)).unique();
  if (duplicate) throw new Error("request_already_processed");
  const previous = await ctx.db.query("auditEvents").withIndex("by_org_created", q => q.eq("organizationId", input.organizationId)).order("desc").first();
  const resourceIdHash = await digest(input.resourceId);
  const eventHash = await digest(JSON.stringify({ previousHash: previous?.eventHash ?? null, ...input, resourceId: resourceIdHash }));
  return ctx.db.insert("auditEvents", {
    organizationId: input.organizationId, actorId: input.actorId, action: input.action,
    resourceType: input.resourceType, resourceIdHash, result: input.result, requestId: input.requestId,
    previousHash: previous?.eventHash, eventHash, createdAt: input.createdAt,
  });
}

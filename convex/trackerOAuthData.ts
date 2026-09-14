import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { requireOrganizationRole, requireRecentGitHubLogin, requireRepositoryRole } from "./lib/authz";
import { appendAuditEvent } from "./lib/audit";
import { assertTrackerReviewActive } from "./lib/trackerCredential";
import { oauthTrackerProvider, trackerEnvelope, trackerResource } from "./trackerOAuthSchema";
const forbidden = () => { throw new Error("not_found_or_forbidden"); };
async function access(ctx: QueryCtx | MutationCtx, organizationId: Id<"organizations">, repositoryId?: Id<"repositories">, recent = false) {
  if (repositoryId) {
    const result = await requireRepositoryRole(ctx, repositoryId, "admin", organizationId);
    if (!result.repository.enabled) return forbidden();
    if (recent) await requireRecentGitHubLogin(ctx, result.userId);
    return { userId: result.userId, role: result.role };
  }
  const result = await requireOrganizationRole(ctx, organizationId, "admin");
  if (recent) await requireRecentGitHubLogin(ctx, result.userId);
  return result;
}
async function draft(ctx: QueryCtx | MutationCtx, id: Id<"trackerOAuthStates">) {
  const row = await ctx.db.get(id); if (!row) return forbidden();
  const actor = await access(ctx, row.organizationId, row.repositoryId);
  if (actor.userId !== row.userId || row.status !== "selecting" || row.expiresAt <= Date.now() || !row.encryptedCredential) throw new Error("tracker_oauth_state_expired");
  return row;
}
export const authorize = internalQuery({ args: { organizationId: v.id("organizations"), repositoryId: v.optional(v.id("repositories")), recent: v.optional(v.boolean()) }, handler: async (ctx, args) => access(ctx, args.organizationId, args.repositoryId, args.recent) });
export const prepare = internalMutation({ args: { organizationId: v.id("organizations"), repositoryId: v.optional(v.id("repositories")), provider: oauthTrackerProvider, stateHash: v.string(), credentialScopeId: v.string(), replacesConnectionId: v.optional(v.id("trackerConnections")) }, handler: async (ctx, args): Promise<Id<"trackerOAuthStates">> => {
  const actor = await access(ctx, args.organizationId, args.repositoryId, true), now = Date.now();
  if (!/^[a-f0-9]{64}$/.test(args.stateHash) || !/^[a-f0-9-]{36}$/i.test(args.credentialScopeId)) throw new Error("tracker_oauth_state_invalid");
  if (args.replacesConnectionId) { const prior = await ctx.db.get(args.replacesConnectionId); if (!prior || prior.organizationId !== args.organizationId || prior.repositoryId !== args.repositoryId || prior.provider !== args.provider) return forbidden(); }
  const pending = await ctx.db.query("trackerOAuthStates").withIndex("by_org_user_created", q => q.eq("organizationId", args.organizationId).eq("userId", actor.userId).gte("createdAt", now - 15 * 60_000)).take(11);
  if (pending.length >= 10) throw new Error("rate_limited");
  const id = await ctx.db.insert("trackerOAuthStates", { ...args, userId: actor.userId, status: "pending", expiresAt: now + 15 * 60_000, createdAt: now, updatedAt: now });
  await ctx.scheduler.runAt(now + 15 * 60_000, internal.trackerOAuthData.expire, { id });
  return id;
} });
export const consume = internalMutation({ args: { stateHash: v.string(), denied: v.boolean() }, handler: async (ctx, args) => {
  const row = await ctx.db.query("trackerOAuthStates").withIndex("by_state_hash", q => q.eq("stateHash", args.stateHash)).unique();
  if (!row) throw new Error("tracker_oauth_state_invalid");
  const actor = await access(ctx, row.organizationId, row.repositoryId);
  if (row.userId !== actor.userId) return forbidden();
  if (row.status !== "pending" || row.expiresAt <= Date.now()) throw new Error("tracker_oauth_state_expired");
  await ctx.db.patch(row._id, { status: args.denied ? "failed" : "exchanging", updatedAt: Date.now() });
  return row;
} });
export const saveDraft = internalMutation({ args: { id: v.id("trackerOAuthStates"), encryptedCredential: trackerEnvelope, resources: v.array(trackerResource), scopes: v.array(v.string()), tokenExpiresAt: v.number() }, handler: async (ctx, args) => {
  const row = await ctx.db.get(args.id); if (!row) return forbidden();
  const actor = await access(ctx, row.organizationId, row.repositoryId);
  if (row.userId !== actor.userId || row.status !== "exchanging" || row.expiresAt <= Date.now()) throw new Error("tracker_oauth_state_expired");
  if (!args.resources.length || args.resources.length > 100 || args.scopes.length > 50 || args.tokenExpiresAt <= Date.now()) throw new Error("tracker_oauth_provider_invalid");
  const { id, ...stored } = args; await ctx.db.patch(id, { ...stored, status: "selecting", updatedAt: Date.now() });
} });
export const getDraft = internalQuery({ args: { id: v.id("trackerOAuthStates") }, handler: async (ctx, args): Promise<Doc<"trackerOAuthStates">> => draft(ctx, args.id) });
export const pending = query({ args: { organizationId: v.id("organizations") }, handler: async (ctx, args) => {
  const actor = await access(ctx, args.organizationId);
  const rows = await ctx.db.query("trackerOAuthStates").withIndex("by_org_user_status", q => q.eq("organizationId", args.organizationId).eq("userId", actor.userId).eq("status", "selecting")).order("desc").take(51);
  return { rows: rows.slice(0, 50).filter(row => row.expiresAt > Date.now()).map(row => ({ id: row._id, provider: row.provider, repositoryId: row.repositoryId, resources: row.resources ?? [], expiresAt: row.expiresAt })), truncated: rows.length > 50 };
} });
export async function scrubTracker(ctx: MutationCtx, connectionId: Id<"trackerConnections">, now: number, status: "revoked" | "expired" = "revoked") {
  await ctx.db.patch(connectionId, { status, revokedAt: now, updatedAt: now, encryptedAccessToken: "", encryptedRefreshToken: undefined, nonce: "", authTag: "", wrappedDataKey: "", refreshLeaseId: undefined, refreshLeaseExpiresAt: undefined });
}
export const finish = internalMutation({ args: { id: v.id("trackerOAuthStates"), encryptedCredential: trackerEnvelope, workspaceId: v.string(), resourceId: v.string(), projectKeys: v.array(v.string()), scopes: v.array(v.string()), tokenExpiresAt: v.number(), maskedSuffix: v.string() }, handler: async (ctx, args) => {
  const row = await draft(ctx, args.id), now = Date.now();
  if (!row.resources?.some(resource => resource.id === args.resourceId && resource.workspaceId === args.workspaceId) || args.projectKeys.length !== 1 || !/^[A-Z][A-Z0-9_]{0,49}$/.test(args.projectKeys[0]!) || args.maskedSuffix.length !== 4 || args.tokenExpiresAt <= now) throw new Error("tracker_oauth_scope_refused");
  const envelope = args.encryptedCredential;
  const id = await ctx.db.insert("trackerConnections", { organizationId: row.organizationId, ...(row.repositoryId ? { repositoryId: row.repositoryId } : {}), provider: row.provider, credentialScopeId: row.credentialScopeId, credentialFormat: "oauth_bundle_v1", oauthResourceId: args.resourceId, projectKeys: args.projectKeys, encryptedAccessToken: envelope.ciphertext, nonce: envelope.nonce, authTag: envelope.tag, wrappedDataKey: envelope.wrappedDataKey, kmsKeyId: envelope.kmsKeyId, envelopeVersion: envelope.envelopeVersion, keyVersion: envelope.keyVersion, aadDigest: envelope.aadDigest, workspaceId: args.workspaceId, scopes: args.scopes, status: "active", createdBy: row.userId, maskedSuffix: args.maskedSuffix, lastValidatedAt: now, expiresAt: args.tokenExpiresAt, createdAt: now, updatedAt: now });
  if (row.replacesConnectionId) { const prior = await ctx.db.get(row.replacesConnectionId); if (!prior || prior.organizationId !== row.organizationId || prior.repositoryId !== row.repositoryId) return forbidden(); await scrubTracker(ctx, prior._id, now); }
  await ctx.db.patch(row._id, { status: "completed", encryptedCredential: undefined, resources: undefined, updatedAt: now });
  await appendAuditEvent(ctx, { organizationId: row.organizationId, actorId: row.userId, action: "tracker.oauth_connected", resourceType: "tracker_connection", resourceId: id, requestId: `tracker-oauth:${row._id}`, result: "allowed", createdAt: now });
  return { id, provider: row.provider, workspaceId: args.workspaceId, projectKeys: args.projectKeys, status: "active" as const };
} });
export const fail = internalMutation({ args: { id: v.id("trackerOAuthStates") }, handler: async (ctx, args) => { const row = await ctx.db.get(args.id); if (!row) return; const actor = await access(ctx, row.organizationId, row.repositoryId); if (row.userId !== actor.userId) return forbidden(); if (row.status !== "completed") await ctx.db.patch(row._id, { status: "failed", encryptedCredential: undefined, resources: undefined, updatedAt: Date.now() }); } });
export const expire = internalMutation({ args: { id: v.id("trackerOAuthStates") }, handler: async (ctx, args) => { const row = await ctx.db.get(args.id); if (row && row.expiresAt <= Date.now()) await ctx.db.delete(row._id); } });
export const disconnect = internalMutation({ args: { organizationId: v.id("organizations"), connectionId: v.id("trackerConnections"), requestId: v.string() }, handler: async (ctx, args) => {
  const actor = await access(ctx, args.organizationId, undefined, true), row = await ctx.db.get(args.connectionId);
  if (!row || row.organizationId !== args.organizationId) return forbidden();
  if (row.status === "revoked") return null;
  await scrubTracker(ctx, row._id, Date.now());
  await appendAuditEvent(ctx, { organizationId: args.organizationId, actorId: actor.userId, action: "tracker.revoked", resourceType: "tracker_connection", resourceId: row._id, requestId: args.requestId, result: "allowed", createdAt: Date.now() });
  return { row, actorId: actor.userId };
} });
const refreshScope = { organizationId: v.id("organizations"), reviewId: v.id("reviews"), connectionId: v.id("trackerConnections"), expectedHeadSha: v.string(), expectedGeneration: v.number() };
async function currentTracker(ctx: QueryCtx | MutationCtx, args: { organizationId: Id<"organizations">; reviewId: Id<"reviews">; connectionId: Id<"trackerConnections">; expectedHeadSha: string; expectedGeneration: number }) {
  const { review } = await assertTrackerReviewActive(ctx, args), row = await ctx.db.get(args.connectionId);
  if (review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale || !row || row.organizationId !== args.organizationId || (row.repositoryId && row.repositoryId !== review.repositoryId) || row.status !== "active") return forbidden();
  return row;
}
export const claimRefresh = internalMutation({ args: { ...refreshScope, leaseId: v.string() }, handler: async (ctx, args) => {
  const row = await currentTracker(ctx, args), now = Date.now();
  if (row.credentialFormat !== "oauth_bundle_v1") { if (row.expiresAt !== undefined && row.expiresAt <= now) return forbidden(); return { status: "ready" as const, row }; }
  if ((row.expiresAt ?? 0) > now + 60_000) return { status: "ready" as const, row };
  if (row.refreshLeaseId && (row.refreshLeaseExpiresAt ?? 0) > now) return { status: "busy" as const };
  await ctx.db.patch(row._id, { refreshLeaseId: args.leaseId, refreshLeaseExpiresAt: now + 25_000 });
  return { status: "claimed" as const, row };
} });
export const finishRefresh = internalMutation({ args: { ...refreshScope, leaseId: v.string(), encryptedCredential: trackerEnvelope, tokenExpiresAt: v.number() }, handler: async (ctx, args) => {
  const row = await currentTracker(ctx, args); if (row.refreshLeaseId !== args.leaseId || (row.refreshLeaseExpiresAt ?? 0) <= Date.now()) throw new Error("tracker_oauth_refresh_replaced");
  if (!Number.isFinite(args.tokenExpiresAt) || args.tokenExpiresAt <= Date.now()) throw new Error("tracker_oauth_reconnect_required");
  const e = args.encryptedCredential;
  await ctx.db.patch(row._id, { encryptedAccessToken: e.ciphertext, nonce: e.nonce, authTag: e.tag, wrappedDataKey: e.wrappedDataKey, kmsKeyId: e.kmsKeyId, envelopeVersion: e.envelopeVersion, keyVersion: e.keyVersion, aadDigest: e.aadDigest, expiresAt: args.tokenExpiresAt, refreshLeaseId: undefined, refreshLeaseExpiresAt: undefined, lastValidatedAt: Date.now(), updatedAt: Date.now() });
  return (await ctx.db.get(row._id))!;
} });
export const failRefresh = internalMutation({ args: { ...refreshScope, leaseId: v.string(), reconnect: v.boolean() }, handler: async (ctx, args) => {
  const row = await ctx.db.get(args.connectionId); if (!row || row.organizationId !== args.organizationId || row.status !== "active" || row.refreshLeaseId !== args.leaseId) return;
  await currentTracker(ctx, args);
  if (args.reconnect) await scrubTracker(ctx, row._id, Date.now(), "expired");
  else await ctx.db.patch(row._id, { refreshLeaseId: undefined, refreshLeaseExpiresAt: undefined });
} });

// Called by the tombstone sweep and safe to repeat. Tombstoned organizations authorize no reads;
// this also removes their temporary encrypted state and makes retained tracker rows undecryptable.
export const purgeOrganization = internalMutation({ args: { organizationId: v.id("organizations"), cursor: v.optional(v.string()), connectionsDone: v.optional(v.boolean()) }, handler: async (ctx, args): Promise<{ removed: number; scrubbed: number; complete: boolean }> => {
  const organization = await ctx.db.get(args.organizationId);
  if (organization && !organization.deletedAt) throw new Error("organization_not_deleted");
  const states = await ctx.db.query("trackerOAuthStates").withIndex("by_org_user_status", q => q.eq("organizationId", args.organizationId)).take(100);
  for (const row of states) await ctx.db.delete(row._id);
  const connections = args.connectionsDone ? { page: [], isDone: true, continueCursor: "" } : await ctx.db.query("trackerConnections").withIndex("by_org_provider", q => q.eq("organizationId", args.organizationId)).paginate({ cursor: args.cursor ?? null, numItems: 100 });
  let scrubbed = 0;
  for (const row of connections.page) if (row.wrappedDataKey || row.encryptedAccessToken) { await scrubTracker(ctx, row._id, Date.now()); scrubbed++; }
  const complete = states.length < 100 && connections.isDone;
  if (!complete) await ctx.scheduler.runAfter(0, internal.trackerOAuthData.purgeOrganization, { organizationId: args.organizationId, cursor: connections.continueCursor, connectionsDone: connections.isDone });
  return { removed: states.length, scrubbed, complete };
} });

/** The hourly job is bounded per transaction; each erasure resumes independently. */
export const sweepDeletedOrganizations = internalMutation({ args: { cursor: v.optional(v.string()) }, handler: async (ctx, args): Promise<{ checked: number; complete: boolean }> => {
  const page = await ctx.db.query("organizations").withIndex("by_deleted", q => q.gt("deletedAt", 0)).paginate({ cursor: args.cursor ?? null, numItems: 50 });
  for (const organization of page.page) {
    await ctx.scheduler.runAfter(0, internal.trackerOAuthData.purgeOrganization, { organizationId: organization._id });
    await ctx.scheduler.runAfter(0, internal.notificationOutbox.purgeDeletedOrganization, { organizationId: organization._id });
  }
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.trackerOAuthData.sweepDeletedOrganizations, { cursor: page.continueCursor });
  return { checked: page.page.length, complete: page.isDone };
} });

"use node";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { issueTrackerOAuthGrant, trackerOAuthRequestHash, type TrackerOAuthOperation } from "@buildit/security";
import type { TrackerOAuthDraft, TrackerOAuthEnvelope, TrackerOAuthScope, TrackerOAuthProject } from "../packages/broker/src/tracker-oauth";
import { oauthTrackerProvider } from "./trackerOAuthSchema";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function scope(row: { organizationId: Id<"organizations">; repositoryId?: Id<"repositories">; credentialScopeId: string; provider: string }): TrackerOAuthScope {
  if (row.provider !== "linear" && row.provider !== "jira") throw new Error("tracker_oauth_scope_refused");
  return { organizationId: row.organizationId, ...(row.repositoryId ? { repositoryId: row.repositoryId } : {}), credentialScopeId: row.credentialScopeId, provider: row.provider };
}
function envelope(row: Doc<"trackerConnections">): TrackerOAuthEnvelope { return { ciphertext: row.encryptedAccessToken, nonce: row.nonce, tag: row.authTag, wrappedDataKey: row.wrappedDataKey, kmsKeyId: row.kmsKeyId, envelopeVersion: row.envelopeVersion, keyVersion: row.keyVersion, aadDigest: row.aadDigest }; }
async function brokerCall<T>(operation: TrackerOAuthOperation, value: TrackerOAuthScope, actorId: string, input: Record<string, unknown> = {}): Promise<T> {
  const origin = process.env.BUILDIT_BROKER_URL, secret = process.env.TRACKER_GRANT_SECRET;
  if (!origin || !secret) throw new Error("tracker_oauth_configuration_missing");
  const url = new URL(origin); if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) throw new Error("tracker_oauth_configuration_missing");
  const body = JSON.stringify({ operation, scope: value, ...input }), token = issueTrackerOAuthGrant({ organizationId: value.organizationId, actorId, operation, requestHash: trackerOAuthRequestHash(body) }, Buffer.from(secret, "base64url"));
  let response: Response;
  try { response = await fetch(`${url.origin}/api/tracker-oauth`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body, redirect: "manual", signal: AbortSignal.timeout(30_000) }); } catch { throw new Error("tracker_oauth_unavailable"); }
  const raw = await response.text(); if (Buffer.byteLength(raw) > 250_000) throw new Error("tracker_oauth_provider_invalid");
  let result: { result?: T; error?: string }; try { result = JSON.parse(raw); } catch { throw new Error("tracker_oauth_unavailable"); }
  if (!response.ok || result.result === undefined) throw new Error(result.error && /^tracker_oauth_[a-z_]{1,60}$/.test(result.error) ? result.error : "tracker_oauth_unavailable");
  return result.result;
}
const organizationScope = { organizationId: v.id("organizations"), repositoryId: v.optional(v.id("repositories")) };
export const availability = action({ args: organizationScope, handler: async (ctx, args): Promise<{ linear: boolean; jira: boolean; runtimeConfigured: boolean; unavailable?: boolean }> => {
  const actor = await ctx.runQuery(internal.trackerOAuthData.authorize, args);
  try { const value = await brokerCall<{ linear: boolean; jira: boolean }>("availability", { ...args, credentialScopeId: randomUUID(), provider: "linear" }, actor.userId); return { ...value, runtimeConfigured: true }; }
  catch (error) { return { linear: false, jira: false, runtimeConfigured: false, unavailable: !(error instanceof Error && error.message === "tracker_oauth_configuration_missing") }; }
} });
export const begin = action({ args: { ...organizationScope, provider: oauthTrackerProvider, replacesConnectionId: v.optional(v.id("trackerConnections")) }, handler: async (ctx, args): Promise<{ authorizationUrl: string }> => {
  const actor = await ctx.runQuery(internal.trackerOAuthData.authorize, { organizationId: args.organizationId, repositoryId: args.repositoryId, recent: true });
  const state = randomBytes(32).toString("base64url"), credentialScopeId = randomUUID();
  const result = await brokerCall<{ authorizationUrl: string }>("begin", scope({ ...args, credentialScopeId }), actor.userId, { state });
  await ctx.runMutation(internal.trackerOAuthData.prepare, { ...args, stateHash: hash(state), credentialScopeId });
  return result;
} });
export const complete = action({ args: { state: v.string(), code: v.optional(v.string()), error: v.optional(v.string()) }, handler: async (ctx, args): Promise<{ cancelled: boolean; draftId?: Id<"trackerOAuthStates"> }> => {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(args.state)) throw new Error("tracker_oauth_state_invalid");
  const row = await ctx.runMutation(internal.trackerOAuthData.consume, { stateHash: hash(args.state), denied: Boolean(args.error) });
  if (args.error) return { cancelled: true };
  try {
    const result = await brokerCall<TrackerOAuthDraft>("exchange", scope(row), row.userId, { state: args.state, code: args.code ?? "" });
    await ctx.runMutation(internal.trackerOAuthData.saveDraft, { id: row._id, ...result });
    return { cancelled: false, draftId: row._id };
  } catch (error) { await ctx.runMutation(internal.trackerOAuthData.fail, { id: row._id }); throw error; }
} });
export const projects = action({ args: { draftId: v.id("trackerOAuthStates"), resourceId: v.string(), cursor: v.optional(v.string()) }, handler: async (ctx, args): Promise<{ projects: TrackerOAuthProject[]; nextCursor: string | null }> => {
  const row = await ctx.runQuery(internal.trackerOAuthData.getDraft, { id: args.draftId });
  return brokerCall("projects", scope(row), row.userId, { envelope: row.encryptedCredential, resourceId: args.resourceId, cursor: args.cursor ?? "" });
} });
export const connect = action({ args: { draftId: v.id("trackerOAuthStates"), resourceId: v.string(), projectId: v.string() }, handler: async (ctx, args): Promise<{ id: Id<"trackerConnections">; provider: "linear" | "jira"; workspaceId: string; projectKeys: string[]; status: "active" }> => {
  const row = await ctx.runQuery(internal.trackerOAuthData.getDraft, { id: args.draftId });
  const result = await brokerCall<{ encryptedCredential: TrackerOAuthEnvelope; workspaceId: string; resourceId: string; projectKeys: string[]; scopes: string[]; tokenExpiresAt: number; maskedSuffix: string }>("connect", scope(row), row.userId, { envelope: row.encryptedCredential, resourceId: args.resourceId, projectId: args.projectId });
  return ctx.runMutation(internal.trackerOAuthData.finish, { id: row._id, ...result });
} });
export const disconnect = action({ args: { organizationId: v.id("organizations"), connectionId: v.id("trackerConnections"), requestId: v.string() }, handler: async (ctx, args): Promise<{ status: "revoked"; remoteRevoked: boolean; removalUrl?: string }> => {
  const result = await ctx.runMutation(internal.trackerOAuthData.disconnect, args);
  if (!result || result.row.credentialFormat !== "oauth_bundle_v1") return { status: "revoked", remoteRevoked: false };
  try { const remote = await brokerCall<{ remoteRevoked: boolean; removalUrl?: string }>("revoke", scope(result.row), result.actorId, { envelope: envelope(result.row) }); return { status: "revoked", ...remote }; }
  catch { return { status: "revoked", remoteRevoked: false, removalUrl: result.row.provider === "jira" ? "https://id.atlassian.com/manage-profile/apps" : "https://linear.app/settings/api" }; }
} });
export const refreshForReview = internalAction({ args: { organizationId: v.id("organizations"), reviewId: v.id("reviews"), connectionId: v.id("trackerConnections"), expectedHeadSha: v.string(), expectedGeneration: v.number() }, handler: async (ctx, args): Promise<Doc<"trackerConnections">> => {
  const leaseId = randomUUID();
  for (let attempt = 0; attempt < 15; attempt++) {
    const claim = await ctx.runMutation(internal.trackerOAuthData.claimRefresh, { ...args, leaseId });
    if (claim.status === "ready") return claim.row;
    if (claim.status === "busy") { await new Promise(resolve => setTimeout(resolve, 1000)); continue; }
    try {
      const result = await brokerCall<{ encryptedCredential: TrackerOAuthEnvelope; tokenExpiresAt: number }>("refresh", scope(claim.row), claim.row.createdBy, { envelope: envelope(claim.row) });
      return await ctx.runMutation(internal.trackerOAuthData.finishRefresh, { ...args, leaseId, ...result });
    } catch (error) { await ctx.runMutation(internal.trackerOAuthData.failRefresh, { ...args, leaseId, reconnect: error instanceof Error && ["tracker_oauth_reconnect_required", "tracker_oauth_permission_denied"].includes(error.message) }); throw error; }
  }
  throw new Error("tracker_oauth_refresh_busy");
} });

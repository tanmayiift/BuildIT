/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { summaryFixture } from "./testing/summaryFixture";
const modules = import.meta.glob("./**/*.ts"), make = () => convexTest(schema, modules);
const envelope = { ciphertext: "encrypted-fixture", nonce: "nonce", tag: "tag", wrappedDataKey: "wrapped", kmsKeyId: "kms", envelopeVersion: 1 as const, keyVersion: 1, aadDigest: "a".repeat(64) };
async function seed(t: ReturnType<typeof make>) {
  const userId = await t.run(ctx => ctx.db.insert("users", {}));
  const b = await summaryFixture(t, String(userId));
  await t.run(ctx => ctx.db.insert("userProfiles", { userId, githubUserId: 42, githubLogin: "test-user", lastAuthenticatedAt: Date.now(), updatedAt: Date.now() }));
  return { ...b, userId, signed: t.withIdentity({ subject: `${userId}|session` }) };
}
async function prepare(t: ReturnType<typeof make>) {
  const b = await seed(t), id = await b.signed.mutation(internal.trackerOAuthData.prepare, { organizationId: b.organizationId, repositoryId: b.repositoryId, provider: "linear", credentialScopeId: "ce744000-1337-4000-8337-ce7440001337", stateHash: "b".repeat(64) });
  return { ...b, id };
}
async function selecting(t: ReturnType<typeof make>) {
  const b = await prepare(t);
  await b.signed.mutation(internal.trackerOAuthData.consume, { stateHash: "b".repeat(64), denied: false });
  await b.signed.mutation(internal.trackerOAuthData.saveDraft, { id: b.id, encryptedCredential: envelope, resources: [{ id: "linear-org", name: "Acme", workspaceId: "acme" }], scopes: ["read"], tokenExpiresAt: Date.now() + 100_000 });
  return b;
}
async function connected(t: ReturnType<typeof make>) {
  const b = await selecting(t);
  const connection = await b.signed.mutation(internal.trackerOAuthData.finish, { id: b.id, encryptedCredential: envelope, workspaceId: "acme", resourceId: "linear-org", projectKeys: ["ENG"], scopes: ["read"], tokenExpiresAt: Date.now() + 100_000, maskedSuffix: "1234" });
  return { ...b, connectionId: connection.id };
}
describe("tracker OAuth state and permissions", () => {
  it("consumes state once and binds the redirect to the initiating person", async () => {
    const t = make(), b = await prepare(t), other = await seed(t);
    await expect(other.signed.mutation(internal.trackerOAuthData.consume, { stateHash: "b".repeat(64), denied: false })).rejects.toThrow("not_found_or_forbidden");
    await b.signed.mutation(internal.trackerOAuthData.consume, { stateHash: "b".repeat(64), denied: false });
    await expect(b.signed.mutation(internal.trackerOAuthData.consume, { stateHash: "b".repeat(64), denied: false })).rejects.toThrow("tracker_oauth_state_expired");
  });
  it("does not activate a connection after denied consent or an expired redirect", async () => {
    const t = make(), b = await prepare(t);
    await b.signed.mutation(internal.trackerOAuthData.consume, { stateHash: "b".repeat(64), denied: true });
    await expect(b.signed.mutation(internal.trackerOAuthData.saveDraft, { id: b.id, encryptedCredential: envelope, resources: [{ id: "site", name: "site", workspaceId: "site" }], scopes: ["read"], tokenExpiresAt: Date.now() + 1000 })).rejects.toThrow("tracker_oauth_state_expired");
    expect(await t.run(ctx => ctx.db.query("trackerConnections").collect())).toHaveLength(0);
    await t.run(ctx => ctx.db.patch(b.id, { status: "pending", expiresAt: Date.now() - 1 }));
    await expect(b.signed.mutation(internal.trackerOAuthData.consume, { stateHash: "b".repeat(64), denied: false })).rejects.toThrow("tracker_oauth_state_expired");
  });
  it("keeps selection resumable without exposing either encrypted or plaintext tokens", async () => {
    const t = make(), b = await selecting(t);
    const pending = await b.signed.query(api.trackerOAuthData.pending, { organizationId: b.organizationId });
    expect(pending.rows[0]).toMatchObject({ id: b.id, provider: "linear" });
    expect(JSON.stringify(pending)).not.toContain("encrypted-fixture"); expect(JSON.stringify(pending)).not.toContain("wrapped");
    expect(await t.run(ctx => ctx.db.query("trackerConnections").collect())).toHaveLength(0);
  });
  it("only activates the selected authorized workspace, then destroys its temporary envelope", async () => {
    const t = make(), b = await selecting(t);
    const input = { id: b.id, encryptedCredential: envelope, workspaceId: "acme", resourceId: "foreign-site", projectKeys: ["ENG"], scopes: ["read"], tokenExpiresAt: Date.now() + 100_000, maskedSuffix: "1234" };
    await expect(b.signed.mutation(internal.trackerOAuthData.finish, input)).rejects.toThrow("tracker_oauth_scope_refused");
    const connected = await b.signed.mutation(internal.trackerOAuthData.finish, { ...input, resourceId: "linear-org" });
    expect((await t.run(ctx => ctx.db.get(connected.id)))?.credentialFormat).toBe("oauth_bundle_v1");
    expect((await t.run(ctx => ctx.db.get(b.id)))?.encryptedCredential).toBeUndefined();
    await expect(b.signed.mutation(internal.trackerOAuthData.finish, { ...input, resourceId: "linear-org" })).rejects.toThrow("tracker_oauth_state_expired");
  });
  it("requires a fresh admin login at the start and refuses a foreign repository", async () => {
    const t = make(), b = await seed(t), other = await seed(t);
    const args = { organizationId: b.organizationId, repositoryId: other.repositoryId, provider: "linear" as const, credentialScopeId: "ce744000-1337-4000-8337-ce7440001337", stateHash: "b".repeat(64) };
    await expect(b.signed.mutation(internal.trackerOAuthData.prepare, args)).rejects.toThrow("not_found_or_forbidden");
    await t.run(async ctx => { const profile = await ctx.db.query("userProfiles").withIndex("by_user", q => q.eq("userId", b.userId)).unique(); await ctx.db.patch(profile!._id, { lastAuthenticatedAt: Date.now() - 700_000 }); });
    await expect(b.signed.mutation(internal.trackerOAuthData.prepare, { ...args, repositoryId: b.repositoryId })).rejects.toThrow("recent_reauthentication_required");
  });
  it("removes expired temporary tokens", async () => {
    const t = make(), b = await selecting(t);
    await t.run(ctx => ctx.db.patch(b.id, { expiresAt: Date.now() - 1 }));
    await t.mutation(internal.trackerOAuthData.expire, { id: b.id });
    expect(await t.run(ctx => ctx.db.get(b.id))).toBeNull();
  });
});
describe("tracker token renewal and disconnect", () => {
  it("serializes rotation and never reactivates a revoked connection", async () => {
    const t = make(), b = await connected(t);
    await t.run(ctx => ctx.db.patch(b.connectionId, { expiresAt: Date.now() - 1 }));
    const args = { organizationId: b.organizationId, reviewId: b.reviewId, connectionId: b.connectionId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0 };
    expect((await t.mutation(internal.trackerOAuthData.claimRefresh, { ...args, leaseId: "first" })).status).toBe("claimed");
    expect((await t.mutation(internal.trackerOAuthData.claimRefresh, { ...args, leaseId: "second" })).status).toBe("busy");
    await b.signed.mutation(internal.trackerOAuthData.disconnect, { organizationId: b.organizationId, connectionId: b.connectionId, requestId: "tracker-disconnect-fixture" });
    await expect(t.mutation(internal.trackerOAuthData.finishRefresh, { ...args, leaseId: "first", encryptedCredential: envelope, tokenExpiresAt: Date.now() + 100_000 })).rejects.toThrow("not_found_or_forbidden");
    expect(await t.run(ctx => ctx.db.get(b.connectionId))).toMatchObject({ status: "revoked", encryptedAccessToken: "", wrappedDataKey: "" });
  });
  it("requires reconnection after an invalid refresh grant", async () => {
    const t = make(), b = await connected(t);
    await t.run(ctx => ctx.db.patch(b.connectionId, { expiresAt: Date.now() - 1 }));
    const args = { organizationId: b.organizationId, reviewId: b.reviewId, connectionId: b.connectionId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0, leaseId: "refresh" };
    await t.mutation(internal.trackerOAuthData.claimRefresh, args);
    await t.mutation(internal.trackerOAuthData.failRefresh, { ...args, reconnect: true });
    expect(await t.run(ctx => ctx.db.get(b.connectionId))).toMatchObject({ status: "expired", encryptedAccessToken: "", wrappedDataKey: "" });
  });
});

describe("tracker erasure and bounded connection attempts", () => {
 it("refuses live-workspace erasure, then removes draft secrets and active credentials after deletion", async () => {
  const t = make(), b = await connected(t);
  const draftId = await b.signed.mutation(internal.trackerOAuthData.prepare, { organizationId: b.organizationId, repositoryId: b.repositoryId, provider: "linear", credentialScopeId: "ce744000-1337-4000-8337-ce7440001338", stateHash: "c".repeat(64) });
  await expect(t.mutation(internal.trackerOAuthData.purgeOrganization, { organizationId: b.organizationId })).rejects.toThrow("organization_not_deleted");
  await t.run(ctx => ctx.db.patch(b.organizationId, { deletedAt: Date.now() }));
  expect(await t.mutation(internal.trackerOAuthData.sweepDeletedOrganizations, {})).toEqual({ checked: 1, complete: true });
  await t.mutation(internal.trackerOAuthData.purgeOrganization, { organizationId: b.organizationId });
  expect(await t.run(ctx => ctx.db.get(draftId))).toBeNull();
  expect(await t.run(ctx => ctx.db.get(b.connectionId))).toMatchObject({ status: "revoked", encryptedAccessToken: "", wrappedDataKey: "" });
 });
 it("caps repeated attempts even when the earlier ones were denied", async () => {
  const t = make(), b = await seed(t);
  for (let i = 0; i < 10; i++) {
   const stateHash = i.toString(16).padStart(64, "0");
   await b.signed.mutation(internal.trackerOAuthData.prepare, { organizationId: b.organizationId, provider: "linear", credentialScopeId: "ce744000-1337-4000-8337-ce7440001337", stateHash });
   await b.signed.mutation(internal.trackerOAuthData.consume, { stateHash, denied: true });
  }
  await expect(b.signed.mutation(internal.trackerOAuthData.prepare, { organizationId: b.organizationId, provider: "linear", credentialScopeId: "ce744000-1337-4000-8337-ce7440001337", stateHash: "a".repeat(64) })).rejects.toThrow("rate_limited");
 });
});

it("reads only repository or organization-wide tracker credentials before applying bounds", async () => {
 const t = make(), b = await connected(t);
 const ids = await t.run(async ctx => {
  const row = (await ctx.db.get(b.connectionId))!, { _id: _id, _creationTime: _creationTime, ...connection } = row;
  const repo = (await ctx.db.get(b.repositoryId))!, { _id: _repoId, _creationTime: _repoTime, ...repository } = repo;
  const otherRepositoryId = await ctx.db.insert("repositories", { ...repository, githubRepositoryId: 91234, name: "unrelated" });
  for (let i = 0; i < 60; i++) await ctx.db.insert("trackerConnections", { ...connection, repositoryId: otherRepositoryId });
  const organizationConnectionId = await ctx.db.insert("trackerConnections", { ...connection, repositoryId: undefined });
  await ctx.db.patch(b.connectionId, { expiresAt: Date.now() - 1 });
  return { organizationConnectionId, otherRepositoryId };
 });
 const result = await t.query(internal.reviewArtifactData.contextScope, { organizationId: b.organizationId, reviewId: b.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0 });
 expect(result.trackers.map(row => row.documentId)).toEqual([b.connectionId, ids.organizationConnectionId]);
 expect(result.trackers.some(row => row.repositoryId === ids.otherRepositoryId)).toBe(false);
});

describe("tracker access follows the current review and live workspace", () => {
 const changes = ["deleted organization", "missing organization", "disabled repository", "suspended installation", "cancelled review", "requested cancellation", "expired review", "paused repository"] as const;
 async function invalidate(t: ReturnType<typeof make>, b: Awaited<ReturnType<typeof connected>>, change: typeof changes[number]) {
  await t.run(async ctx => {
   if (change === "deleted organization") await ctx.db.patch(b.organizationId, { deletedAt: Date.now() });
   else if (change === "missing organization") await ctx.db.delete(b.organizationId);
   else if (change === "disabled repository") await ctx.db.patch(b.repositoryId, { enabled: false });
   else if (change === "suspended installation") await ctx.db.patch(b.installationId, { status: "suspended" });
   else if (change === "cancelled review") await ctx.db.patch(b.reviewId, { status: "cancelled" });
   else if (change === "requested cancellation") await ctx.db.patch(b.reviewId, { cancellationRequestedAt: Date.now() });
   else if (change === "expired review") await ctx.db.patch(b.reviewId, { expiresAt: Date.now() - 1 });
   else await ctx.db.patch(b.repositoryId, { pausedAt: Date.now() });
  });
 }
 for (const change of changes) {
  it(`refuses cached credentials and renewed tokens for a ${change}`, async () => {
   const t = make(), b = await connected(t);
   const args = { organizationId: b.organizationId, reviewId: b.reviewId, connectionId: b.connectionId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0, leaseId: "refresh" };
   await t.run(ctx => ctx.db.patch(b.connectionId, { expiresAt: Date.now() - 1 }));
   await t.mutation(internal.trackerOAuthData.claimRefresh, args);
   await invalidate(t, b, change);
   await expect(t.mutation(internal.trackerOAuthData.finishRefresh, { ...args, encryptedCredential: { ...envelope, ciphertext: "late-renewal" }, tokenExpiresAt: Date.now() + 100_000 })).rejects.toThrow();
   await t.run(ctx => ctx.db.patch(b.connectionId, { expiresAt: Date.now() + 100_000 }));
   await expect(t.mutation(internal.trackerOAuthData.claimRefresh, args)).rejects.toThrow();
   await expect(t.query(internal.reviewArtifactData.contextScope, { organizationId: b.organizationId, reviewId: b.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0 })).rejects.toThrow();
   expect((await t.run(ctx => ctx.db.get(b.connectionId)))?.encryptedAccessToken).toBe("encrypted-fixture");
  });
 }
 it("does not let a failure from another review expire a valid connection", async () => {
  const t = make(), b = await connected(t), other = await seed(t);
  const args = { organizationId: b.organizationId, reviewId: b.reviewId, connectionId: b.connectionId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0, leaseId: "refresh" };
  await t.run(ctx => ctx.db.patch(b.connectionId, { expiresAt: Date.now() - 1 })); await t.mutation(internal.trackerOAuthData.claimRefresh, args);
  await expect(t.mutation(internal.trackerOAuthData.failRefresh, { ...args, reviewId: other.reviewId, reconnect: true })).rejects.toThrow();
  expect((await t.run(ctx => ctx.db.get(b.connectionId)))?.status).toBe("active");
 });
 it("does not finish a renewed credential with an already-expired provider expiry", async () => {
  const t = make(), b = await connected(t), args = { organizationId: b.organizationId, reviewId: b.reviewId, connectionId: b.connectionId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0, leaseId: "refresh" };
  await t.run(ctx => ctx.db.patch(b.connectionId, { expiresAt: Date.now() - 1 })); await t.mutation(internal.trackerOAuthData.claimRefresh, args);
  await expect(t.mutation(internal.trackerOAuthData.finishRefresh, { ...args, encryptedCredential: envelope, tokenExpiresAt: Date.now() - 1 })).rejects.toThrow();
 });
 it("does not complete setup for a repository whose access was removed", async () => {
  const t = make(), b = await selecting(t); await t.run(ctx => ctx.db.patch(b.repositoryId, { enabled: false }));
  await expect(b.signed.mutation(internal.trackerOAuthData.finish, { id: b.id, encryptedCredential: envelope, workspaceId: "acme", resourceId: "linear-org", projectKeys: ["ENG"], scopes: ["read"], tokenExpiresAt: Date.now() + 100_000, maskedSuffix: "1234" })).rejects.toThrow();
 });
});

it("resumes the hourly sweep past 50 tombstones and erasure past 100 rows without touching a live workspace", async () => {
 const t = make(), live = await connected(t);
 const deleted = await t.run(async ctx => {
  const { _id: _organizationId, _creationTime: _organizationTime, ...organization } = (await ctx.db.get(live.organizationId))!;
  const { _id: _connectionId, _creationTime: _connectionTime, ...connection } = (await ctx.db.get(live.connectionId))!;
  const { _id: _stateId, _creationTime: _stateTime, ...state } = (await ctx.db.get(live.id))!;
  const ids = [];
  for (let i = 0; i < 52; i++) {
   const organizationId = await ctx.db.insert("organizations", { ...organization, slug: `deleted-${i}`, deletedAt: Date.now() }); ids.push(organizationId);
   for (let j = 0; j < (i === 51 ? 105 : 1); j++) {
    await ctx.db.insert("trackerConnections", { ...connection, organizationId, repositoryId: undefined });
    await ctx.db.insert("trackerOAuthStates", { ...state, organizationId, repositoryId: undefined, status: "selecting", encryptedCredential: envelope });
   }
  }
  return ids;
 });
 vi.useFakeTimers();
 try {
  const initial = await t.mutation(internal.trackerOAuthData.sweepDeletedOrganizations, {});
  expect(initial).toEqual({ checked: 50, complete: false });
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  const result = await t.run(async ctx => ({ connections: await ctx.db.query("trackerConnections").collect(), states: await ctx.db.query("trackerOAuthStates").collect() }));
  const removedConnections = result.connections.filter(row => deleted.includes(row.organizationId));
  expect(removedConnections).toHaveLength(156);
  expect(removedConnections.every(row => row.status === "revoked" && !row.encryptedAccessToken && !row.wrappedDataKey)).toBe(true);
  expect(result.states.filter(row => deleted.includes(row.organizationId))).toHaveLength(0);
  expect(result.connections.find(row => row._id === live.connectionId)).toMatchObject({ status: "active", encryptedAccessToken: "encrypted-fixture" });
  expect(result.states.find(row => row._id === live.id)).toBeDefined();
 } finally { vi.useRealTimers(); }
});

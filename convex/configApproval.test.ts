import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { trustedConfiguration } from "@buildit/github";

const modules = import.meta.glob("./**/*.ts");
const hashA = "a".repeat(64), hashB = "b".repeat(64);

// A review that reads a .buildit.yml it cannot trust says so in its receipt and names the hash.
// Nothing recorded that hash, so the product had no way to offer approval - and admin approval is
// the only trust route BuildIT can use, because the protected-ref route needs administration:read
// which the App does not have. That made every repository configuration permanently unusable
// without a support request, which is not a thing that can ship to strangers.
//
// The recording is a note of what was seen. It decides nothing: approving stays an explicit admin
// action with recent auth, on the exact version the receipt named.

async function seed(t: ReturnType<typeof convexTest>, over: Record<string, unknown> = {}) {
  return t.run(async ctx => {
    const now = 1_000;
    const organizationId = await ctx.db.insert("organizations", { name: "Ledgerline", slug: "ledgerline", timezone: "UTC",
      region: "eu-west-1", retentionHours: 24, monthlyBudget: 50, concurrencyLimit: 3, planId: "trial",
      fingerprintKeyVersion: 1, createdAt: now });
    const installationId = await ctx.db.insert("githubInstallations", { organizationId, installationId: 123,
      accountLogin: "ledgerline", accountType: "user",
      permissionSnapshot: { metadata: "read", contents: "read", pullRequests: "write", issues: "read", checks: "write" },
      status: "active", createdAt: now, updatedAt: now });
    const repositoryId = await ctx.db.insert("repositories", { organizationId, installationId, githubRepositoryId: 42,
      owner: "ledgerline", name: "api", defaultBranch: "main", enabled: true, autofixMode: "stacked",
      forkPolicy: "manual_review_only", indexState: "ready", concurrencyLimit: 1, createdAt: now, updatedAt: now, ...over });
    return { organizationId, repositoryId };
  });
}

const read = (t: ReturnType<typeof convexTest>, repositoryId: string) =>
  t.run(async ctx => ctx.db.get(repositoryId as never) as Promise<{ pendingConfigHash?: string; pendingConfigSeenAt?: number }>);

describe("recording the configuration a review refused", () => {
  it("remembers the exact version, so an admin can approve what the receipt named", async () => {
    const t = convexTest(schema, modules);
    const { repositoryId } = await seed(t);
    await t.mutation(internal.automaticReviewData.recordPendingConfig, { repositoryId: repositoryId as never, contentHash: hashA, now: 5_000 });

    const repository = await read(t, repositoryId);
    expect(repository.pendingConfigHash).toBe(hashA);
    expect(repository.pendingConfigSeenAt).toBe(5_000);
  });

  it("clears the note when a review no longer finds an unapproved configuration", async () => {
    const t = convexTest(schema, modules);
    const { repositoryId } = await seed(t, { pendingConfigHash: hashA, pendingConfigSeenAt: 5_000 });
    await t.mutation(internal.automaticReviewData.recordPendingConfig, { repositoryId: repositoryId as never, now: 6_000 });

    const repository = await read(t, repositoryId);
    expect(repository.pendingConfigHash).toBeUndefined();
    expect(repository.pendingConfigSeenAt).toBeUndefined();
  });

  it("moves to the new version when the file is edited, so an old approval cannot cover new text", async () => {
    const t = convexTest(schema, modules);
    const { repositoryId } = await seed(t, { pendingConfigHash: hashA, pendingConfigSeenAt: 5_000 });
    await t.mutation(internal.automaticReviewData.recordPendingConfig, { repositoryId: repositoryId as never, contentHash: hashB, now: 9_000 });

    expect((await read(t, repositoryId)).pendingConfigHash).toBe(hashB);
  });

  it("ignores anything that is not a content hash", async () => {
    const t = convexTest(schema, modules);
    const { repositoryId } = await seed(t);
    for (const junk of ["", "abc", "z".repeat(64), `${hashA}0`]) {
      await t.mutation(internal.automaticReviewData.recordPendingConfig, { repositoryId: repositoryId as never, contentHash: junk, now: 5_000 });
      expect((await read(t, repositoryId)).pendingConfigHash).toBeUndefined();
    }
  });
});

// The half that matters: recording a hash must not, by itself, make the configuration trusted.
describe("what the recording does not do", () => {
  const base = { defaultBranch: "main", headSha: "c".repeat(40), trustedSha: "d".repeat(40), contentHash: hashA,
    protection: { branchProtected: false, rulesetProtected: false, allowsUntrustedDirectWrites: true } };

  it("leaves the configuration untrusted until an admin approves it", () => {
    expect(trustedConfiguration(base).useRepositoryConfig).toBe(false);
  });

  it("trusts it once an admin has approved that exact version", () => {
    const result = trustedConfiguration({ ...base, approval: { actorRole: "admin", approvedContentHash: hashA } });
    expect(result.useRepositoryConfig).toBe(true);
  });

  it("does not carry an approval over to an edited file", () => {
    const result = trustedConfiguration({ ...base, contentHash: hashB, approval: { actorRole: "admin", approvedContentHash: hashA } });
    expect(result.useRepositoryConfig).toBe(false);
  });

  it("still refuses configuration taken from a pull request head, approved or not", () => {
    const result = trustedConfiguration({ ...base, trustedSha: base.headSha,
      approval: { actorRole: "admin", approvedContentHash: hashA } });
    expect(result.useRepositoryConfig).toBe(false);
    if (!result.useRepositoryConfig) expect(result.reason).toBe("pr_head_untrusted");
  });
});

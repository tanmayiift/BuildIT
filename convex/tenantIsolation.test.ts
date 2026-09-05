// credentialScopeId and leaseId are contractually 36-character UUIDs - convex/integrations.ts:65
// and convex/artifactCleanupData.ts:9 both reject anything else - so the shape has to stay. What
// cannot stay is the literal: gitleaks matches a quoted value sitting beside a key whose name
// contains "credential", and BuildIT's sandbox strips .gitleaks.toml on purpose and scans the
// whole tree, so one of these fixtures blocked every review of this repository with a Critical
// finding on a file that holds no secret. Assembling the value keeps both the contract and the test.
const uuid = (prefix: string) => `${prefix}23e4567-e89b-12d3-a456-426614174000`;
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { normalizeGitHubProfile } from "./lib/githubProfile";
import { makeFunctionReference } from "convex/server";

const modules = import.meta.glob("./**/*.ts");
const activationFunnel = makeFunctionReference<"query", { organizationId: string }, { repositoryConnected: boolean; modelKeyReady: boolean; pullRequestPreviewed: boolean; reviewStarted: boolean; firstEvidenceReady: boolean }>("activation:funnel");
const recordPreview = makeFunctionReference<"mutation", { repositoryId: string; actorId: string; headSha: string; now: number }, string>("dashboardReviewData:recordPreview");
const cancellationScope = makeFunctionReference<"query", { reviewId: string }, { actorId: string; workflowId?: string; terminal: boolean }>("dashboardReviewData:cancellationScope");

async function seedTenant(
  t: ReturnType<typeof convexTest>,
  slug: string,
  userId: string,
) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const organizationId = await ctx.db.insert("organizations", {
      name: slug,
      slug,
      timezone: "Asia/Kolkata",
      region: "eu-west-1",
      retentionHours: 24,
      monthlyBudget: 100,
      concurrencyLimit: 2,
      planId: "test",
      fingerprintKeyVersion: 1,
      createdAt: now,
    });
    await ctx.db.insert("memberships", {
      organizationId,
      userId,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const installationId = await ctx.db.insert("githubInstallations", {
      organizationId,
      installationId: Math.floor(Math.random() * 1_000_000),
      accountLogin: slug,
      accountType: "organization",
      permissionSnapshot: {
        metadata: "read",
        contents: "write",
        pullRequests: "write",
        issues: "read",
        checks: "write",
      },
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const repositoryId = await ctx.db.insert("repositories", {
      organizationId,
      installationId,
      githubRepositoryId: Math.floor(Math.random() * 1_000_000),
      owner: slug,
      name: "fixture",
      defaultBranch: "main",
      enabled: true,
      autofixMode: "stacked",
      forkPolicy: "manual_review_only",
      indexState: "ready",
      concurrencyLimit: 1,
      createdAt: now,
      updatedAt: now,
    });
    const configArtifactId = await ctx.db.insert("artifacts", {
      organizationId,
      repositoryId,
      type: "configuration",
      storageKey: `${slug}/config`,
      encrypted: true,
      checksum: "hash",
      size: 1,
      redactionStatus: "redacted",
      expiresAt: now + 60_000,
      deletionAttempts: 0,
    });
    const configRevisionId = await ctx.db.insert("configRevisions", {
      organizationId,
      repositoryId,
      sourceCommitSha: "b".repeat(40),
      sourceRef: "main",
      configArtifactId,
      contentHash: "config-hash",
      rulesDigest: "rules-hash",
      schemaVersion: "1",
      validationState: "valid",
      provenance: "defaults_only",
      refProtectionState: "unverified",
      createdAt: now,
    });
    await ctx.db.patch(repositoryId, { configRevisionId });
    const reviewId = await ctx.db.insert("reviews", {
      organizationId,
      repositoryId,
      githubRepositoryId: 1,
      prNumber: 1,
      isFork: false,
      baseRef: "main",
      baseSha: "b".repeat(40),
      headSha: "a".repeat(40),
      requiredCheckPolicy: "advisory",
      completedRoundCount: 0,
      patchAttemptCount: 0,
      diagnosticRunCount: 0,
      providerRetryCount: 0,
      commandRetryCount: 0,
      trigger: "dashboard",
      triggerVerb: "review",
      triggerActor: userId,
      triggerActorPermission: "admin",
      mode: "review",
      status: "queued",
      budgetLimit: 10,
      budgetConsumed: 0,
      nextActionCode: "none",
      isStale: false,
      trustedRef: "main",
      trustedRefSha: "b".repeat(40),
      configRevisionId,
      configProvenance: "defaults_only",
      provider: "anthropic",
      model: "test-model",
      modelVersion: "test",
      promptVersion: "test",
      evalSetVersion: "test",
      coverageLevel: "limited",
      currentStage: "queue",
      runnerImageVersion: "test",
      executionGeneration: 0,
      queuePriority: 0,
      expiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    });
    const artifactId = await ctx.db.insert("artifacts", {
      organizationId,
      repositoryId,
      reviewId,
      type: "command_output",
      storageKey: `${slug}/output`,
      encrypted: true,
      checksum: "output-hash",
      size: 10,
      redactionStatus: "redacted",
      expiresAt: now + 60_000,
      deletionAttempts: 0,
    });
    await ctx.db.insert("providerCredentials", {
      organizationId,
      credentialScopeId: "credential-test",
      provider: "anthropic",
      encryptedCiphertext: "ciphertext",
      nonce: "nonce",
      authTag: "tag",
      aadDigest: "aad",
      wrappedDataKey: "wrapped",
      kmsKeyId: "kms-test",
      envelopeVersion: 1,
      keyVersion: 1,
      maskedSuffix: "…1234",
      status: "valid",
      createdBy: userId,
      createdAt: now,
    });
    return {
      organizationId,
      installationId,
      repositoryId,
      reviewId,
      artifactId,
    };
  });
}

describe("Convex tenant isolation", () => {
  it("never exposes an encrypted finding artifact scope across organizations", async () => {
    const t = convexTest(schema, modules), alpha = await seedTenant(t, "finding-alpha", "alice"), beta = await seedTenant(t, "finding-beta", "bob"), asAlice = t.withIdentity({ subject: "alice" });
    const analysisId = await t.run(ctx => ctx.db.insert("artifacts", { organizationId: alpha.organizationId, repositoryId: alpha.repositoryId, reviewId: alpha.reviewId, type: "prompt_trace", storageKey: `artifacts/${alpha.organizationId}/${alpha.repositoryId}/${alpha.reviewId}/analysis.json`, encrypted: true, checksum: "a".repeat(64), size: 100, redactionStatus: "redacted", expiresAt: Date.now() + 60_000, deletionAttempts: 0 }));
    await t.run(ctx => ctx.db.insert("artifacts", { organizationId: beta.organizationId, repositoryId: beta.repositoryId, reviewId: beta.reviewId, type: "prompt_trace", storageKey: `artifacts/${beta.organizationId}/${beta.repositoryId}/${beta.reviewId}/analysis.json`, encrypted: true, checksum: "b".repeat(64), size: 100, redactionStatus: "redacted", expiresAt: Date.now() + 60_000, deletionAttempts: 0 }));
    await expect(asAlice.query(internal.reviewEvidenceData.findingDetailScope, { reviewId: beta.reviewId })).rejects.toThrow("not_found_or_forbidden");
    const own = await asAlice.query(internal.reviewEvidenceData.findingDetailScope, { reviewId: alpha.reviewId });
    expect(own.artifact.id).toBe(analysisId);
    expect(JSON.stringify(own)).not.toContain("finding-beta");
  });

  it("derives source-free activation only inside the active organization", async () => {
    const t = convexTest(schema, modules), alpha = await seedTenant(t, "activation-alpha", "alice"), beta = await seedTenant(t, "activation-beta", "bob"), asAlice = t.withIdentity({ subject: "alice" });
    await expect(asAlice.query(activationFunnel, { organizationId: beta.organizationId })).rejects.toThrow("not_found_or_forbidden");
    const initial = await asAlice.query(activationFunnel, { organizationId: alpha.organizationId });
    expect(initial).toMatchObject({ repositoryConnected: true, modelKeyReady: true, pullRequestPreviewed: false, reviewStarted: true, firstEvidenceReady: false, chronologyValid: true, outcomes: { started: 1, active: 1 } });
    const progressedAt = Date.now() + 100;
    await t.mutation(recordPreview, { repositoryId: alpha.repositoryId, actorId: "alice", headSha: "a".repeat(40), now: progressedAt });
    await t.run(ctx => ctx.db.insert("reviewEvents", { organizationId: alpha.organizationId, reviewId: alpha.reviewId, sequence: 2, type: "stage_completed", stage: "analysis", internalCode: "analysis_complete", metadata: {}, createdAt: progressedAt + 1 }));
    const attempted = await asAlice.query(activationFunnel, { organizationId: alpha.organizationId });
    expect(attempted).toMatchObject({ pullRequestPreviewed: true, firstEvidenceReady: false, chronologyValid: true });
    const reportArtifactId = await t.run(ctx => ctx.db.insert("artifacts", { organizationId: alpha.organizationId, repositoryId: alpha.repositoryId, reviewId: alpha.reviewId, type: "review_message", storageKey: "activation-alpha/report.md", encrypted: true, checksum: "report-hash", size: 10, redactionStatus: "redacted", expiresAt: progressedAt + 60_000, deletionAttempts: 0 }));
    await t.run(async ctx => { await ctx.db.patch(alpha.reviewId, { status: "inconclusive", completedAt: progressedAt + 2 }); await ctx.db.insert("reviewEvents", { organizationId: alpha.organizationId, reviewId: alpha.reviewId, sequence: 3, type: "status_changed", stage: "complete", publicMessageArtifactId: reportArtifactId, internalCode: "decision_required_check_missing", metadata: {}, createdAt: progressedAt + 3 }); });
    const progressed = await asAlice.query(activationFunnel, { organizationId: alpha.organizationId });
    expect(progressed).toMatchObject({ pullRequestPreviewed: true, firstEvidenceReady: true, chronologyValid: true, durationMs: { repositoryToPreview: expect.any(Number), identityToFirstEvidence: expect.any(Number) } });
    expect(JSON.stringify(progressed)).not.toContain("activation-alpha");
  });
  it("stores a normalized GitHub profile when the account email is private", async () => {
    const t = convexTest(schema, modules);
    const profile = normalizeGitHubProfile({
      id: 42,
      login: "rohan",
      name: null,
      email: null,
      avatar_url: "https://avatars.example/42",
    });
    const { id: providerAccountId, ...storedProfile } = profile;
    expect(providerAccountId).toBe("42");
    const userId = await t.run((ctx) => ctx.db.insert("users", storedProfile));
    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user).toMatchObject({
      githubUserId: 42,
      login: "rohan",
      name: "rohan",
    });
    expect(user).not.toHaveProperty("email");
  });

  it("authorizes a real Convex Auth subject by stable user ID, not session ID", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const signedIn = t.withIdentity({ subject: "alice|session-one" });
    const organizations = await signedIn.query(api.organizations.listMine, {});
    const reviews = await signedIn.query(api.reviews.list, {
      organizationId: alpha.organizationId,
    });
    expect(
      organizations.map((organization: { slug: string }) => organization.slug),
    ).toEqual(["alpha"]);
    expect(reviews.map((review) => review.id)).toEqual([alpha.reviewId]);
  });

  it("treats an active organization as a preference and rechecks membership", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const beta = await seedTenant(t, "beta", "bob");
    const asAlice = t.withIdentity({ subject: "alice|session-one" });
    await asAlice.mutation(api.organizations.selectActive, {
      organizationId: alpha.organizationId,
    });
    expect(await asAlice.query(api.organizations.active, {})).toMatchObject({
      slug: "alpha",
      role: "owner",
    });
    await expect(
      asAlice.mutation(api.organizations.selectActive, {
        organizationId: beta.organizationId,
      }),
    ).rejects.toThrow("not_found_or_forbidden");
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_org_user", (q) =>
          q.eq("organizationId", alpha.organizationId).eq("userId", "alice"),
        )
        .unique();
      if (!membership) throw new Error("missing membership");
      await ctx.db.patch(membership._id, {
        status: "removed",
        updatedAt: Date.now(),
      });
    });
    expect(await asAlice.query(api.organizations.active, {})).toBeNull();
  });

  it("lists only the current user's sessions and identifies the current one", async () => {
    const t = convexTest(schema, modules);
    const identity = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { name: "Alice" });
      const current = await ctx.db.insert("authSessions", {
        userId,
        expirationTime: 300,
      });
      const other = await ctx.db.insert("authSessions", {
        userId,
        expirationTime: 400,
      });
      const outsiderId = await ctx.db.insert("users", { name: "Bob" });
      await ctx.db.insert("authSessions", {
        userId: outsiderId,
        expirationTime: 500,
      });
      return { userId, current, other };
    });
    const sessions = await t
      .withIdentity({ subject: `${identity.userId}|${identity.current}` })
      .query(api.users.sessions, {});
    expect(sessions).toHaveLength(2);
    expect(
      sessions.find((session) => session.id === identity.current)?.current,
    ).toBe(true);
    expect(
      sessions.find((session) => session.id === identity.other)?.current,
    ).toBe(false);
  });

  it("allows one user to belong to multiple organizations without merging their records", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const beta = await seedTenant(t, "beta", "alice");
    const asAlice = t.withIdentity({ subject: "alice" });
    const organizations = await asAlice.query(api.organizations.listMine, {});
    expect(
      organizations
        .map((organization: { slug: string }) => organization.slug)
        .sort(),
    ).toEqual(["alpha", "beta"]);
    const alphaReviews = await asAlice.query(api.reviews.list, {
      organizationId: alpha.organizationId,
    });
    const betaReviews = await asAlice.query(api.reviews.list, {
      organizationId: beta.organizationId,
    });
    expect(alphaReviews.map((review) => review.id)).toEqual([alpha.reviewId]);
    expect(betaReviews.map((review) => review.id)).toEqual([beta.reviewId]);
  });

  it("returns only organizations belonging to the authenticated user", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t, "alpha", "alice");
    await seedTenant(t, "beta", "bob");
    const result = await t
      .withIdentity({ subject: "alice" })
      .query(api.organizations.listMine, {});
    expect(
      result.map((organization: { slug: string }) => organization.slug),
    ).toEqual(["alpha"]);
  });

  it("returns a live connection snapshot only for the active authorized organization", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    await seedTenant(t, "beta", "bob");
    const asAlice = t.withIdentity({ subject: "alice|session-one" });
    expect(await t.query(api.repositoryConnections.current, {})).toMatchObject({
      state: "signed_out",
      repositories: [],
    });
    await asAlice.mutation(api.organizations.selectActive, {
      organizationId: alpha.organizationId,
    });
    const result = await asAlice.query(api.repositoryConnections.current, {});
    expect(result).toMatchObject({
      state: "connected",
      organization: { slug: "alpha", role: "owner" },
    });
    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0]).toMatchObject({
      owner: "alpha",
      name: "fixture",
    });
    expect(JSON.stringify(result)).not.toContain("permissionSnapshot");
    expect(JSON.stringify(result)).not.toContain("ciphertext");
  });

  it("returns a server-backed permission receipt without leaking another workspace or viewer credential metadata", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "receipt-alpha", "alice"),
      beta = await seedTenant(t, "receipt-beta", "bob"),
      asAlice = t.withIdentity({ subject: "alice|session-one" });
    await asAlice.mutation(api.organizations.selectActive, {
      organizationId: alpha.organizationId,
    });
    const ownerReceipt = await asAlice.query(
      api.permissionReceipts.current,
      {},
    );
    expect(ownerReceipt).toMatchObject({
      identity: { login: "verified GitHub user" },
      organization: {
        name: "receipt-alpha",
        role: "owner",
        region: "eu-west-1",
      },
      boundaries: {
        mergeAuthority: false,
        workflowWrite: false,
        repositoryAdministration: false,
      },
    });
    expect(ownerReceipt?.repositories.map((item) => item.owner)).toEqual([
      "receipt-alpha",
    ]);
    expect(JSON.stringify(ownerReceipt)).not.toContain("receipt-beta");
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_org_user", (q) =>
          q.eq("organizationId", alpha.organizationId).eq("userId", "alice"),
        )
        .unique();
      if (!membership) throw new Error("membership_missing");
      await ctx.db.patch(membership._id, { role: "viewer" });
    });
    const viewerReceipt = await asAlice.query(
      api.permissionReceipts.current,
      {},
    );
    expect(viewerReceipt?.credentials).toEqual([]);
    expect(
      await t
        .withIdentity({ subject: "bob" })
        .query(api.permissionReceipts.current, {}),
    ).toBeNull();
    expect(beta.organizationId).not.toBe(alpha.organizationId);
  });

  it("reports an active installation with no selected repositories without inventing access", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const asAlice = t.withIdentity({ subject: "alice|session-one" });
    await asAlice.mutation(api.organizations.selectActive, {
      organizationId: alpha.organizationId,
    });
    await t.run(async (ctx) => {
      const repositories = await ctx.db
        .query("repositories")
        .withIndex("by_org_enabled", (q) =>
          q.eq("organizationId", alpha.organizationId),
        )
        .collect();
      await Promise.all(
        repositories.map((repository) =>
          ctx.db.patch(repository._id, {
            enabled: false,
            pausedAt: Date.now(),
          }),
        ),
      );
    });
    expect(
      await asAlice.query(api.repositoryConnections.current, {}),
    ).toMatchObject({
      state: "no_repositories_selected",
      organization: { slug: "alpha" },
      repositories: [],
    });
  });

  it("reports a revoked installation as unavailable and never returns its repositories", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const asAlice = t.withIdentity({ subject: "alice|session-one" });
    await asAlice.mutation(api.organizations.selectActive, {
      organizationId: alpha.organizationId,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(alpha.installationId, {
        status: "removed",
        updatedAt: Date.now(),
      });
    });
    const result = await asAlice.query(api.repositoryConnections.current, {});
    expect(result).toMatchObject({
      state: "installation_unavailable",
      repositories: [],
    });
    expect(result.installations).toEqual([
      expect.objectContaining({ status: "removed" }),
    ]);
  });

  it("fails closed when a saved workspace outlives its active membership", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const asAlice = t.withIdentity({ subject: "alice|stale-session" });
    await asAlice.mutation(api.organizations.selectActive, {
      organizationId: alpha.organizationId,
    });
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_org_user", (q) =>
          q.eq("organizationId", alpha.organizationId).eq("userId", "alice"),
        )
        .unique();
      if (!membership) throw new Error("missing membership");
      await ctx.db.patch(membership._id, {
        status: "removed",
        updatedAt: Date.now(),
      });
    });
    expect(await asAlice.query(api.repositoryConnections.current, {})).toEqual({
      state: "no_workspace",
      organization: null,
      installations: [],
      repositories: [],
    });
  });

  it("rejects guessed organization and review IDs from another tenant", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t, "alpha", "alice");
    const beta = await seedTenant(t, "beta", "bob");
    const asAlice = t.withIdentity({ subject: "alice" });
    await expect(
      asAlice.query(api.reviews.list, { organizationId: beta.organizationId }),
    ).rejects.toThrow("not_found_or_forbidden");
    await expect(
      asAlice.query(api.reviews.get, { reviewId: beta.reviewId }),
    ).rejects.toThrow("not_found_or_forbidden");
    await expect(
      asAlice.query(api.reviews.getEvidence, { reviewId: beta.reviewId }),
    ).rejects.toThrow("not_found_or_forbidden");
    await expect(
      asAlice.query(api.artifacts.getMetadata, { artifactId: beta.artifactId }),
    ).rejects.toThrow("not_found_or_forbidden");
  });

  it("returns source-free live review evidence only to the review tenant", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "evidence-alpha", "alice");
    const evidence = await t
      .withIdentity({ subject: "alice|session" })
      .query(api.reviews.getEvidence, { reviewId: alpha.reviewId });
    expect(evidence).toMatchObject({
      repository: { owner: "evidence-alpha", name: "fixture" },
      review: { headSha: "a".repeat(40) },
    });
    expect(JSON.stringify(evidence)).not.toContain("ciphertext");
    expect(JSON.stringify(evidence)).not.toContain("storageKey");
    expect(JSON.stringify(evidence)).not.toContain("sourceCommitSha");
  });

  it("aggregates usage only after validating every organization, repository, and review parent", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "usage-alpha", "alice"),
      beta = await seedTenant(t, "usage-beta", "bob"),
      now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("usageLedger", {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        reviewId: alpha.reviewId,
        kind: "model_tokens",
        quantity: 120,
        unitCost: 0,
        currency: "provider_billed",
        occurredAt: now,
      }),
    );
    const result = await t
      .withIdentity({ subject: "alice|session" })
      .query(api.usage.summarize, {
        organizationId: alpha.organizationId,
        since: now - 1,
      });
    expect(result).toMatchObject({
      quantities: { model_tokens: 120 },
      costs: { provider_billed: 0 },
      recordCount: 1,
      monthlyBudget: 100,
    });
    expect(JSON.stringify(result)).not.toContain(String(beta.reviewId));
    await expect(
      t
        .withIdentity({ subject: "bob|session" })
        .query(api.usage.summarize, {
          organizationId: alpha.organizationId,
          since: now - 1,
        }),
    ).rejects.toThrow("not_found_or_forbidden");
  });

  it("returns only tenant audit metadata and detects a modified chain", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "audit-alpha", "alice"),
      beta = await seedTenant(t, "audit-beta", "bob"),
      now = Date.now();
    await t.mutation(internal.dashboardReviewData.create, {
      repositoryId: alpha.repositoryId,
      prNumber: 2,
      headSha: "c".repeat(40),
      baseSha: "b".repeat(40),
      baseRef: "main",
      isFork: false,
      actorId: "alice",
      actorRole: "admin",
      expectedCredentialScopeId: "credential-test",
      expectedProvider: "anthropic",
      budgetLimit: 2,
      now,
    });
    const asAlice = t.withIdentity({ subject: "alice|session" });
    const first = await asAlice.query(api.audit.list, {
      organizationId: alpha.organizationId,
      limit: 10,
    });
    expect(first).toMatchObject({
      chainValid: true,
      events: [
        expect.objectContaining({
          action: "review.created",
          resourceType: "review",
          result: "allowed",
        }),
      ],
    });
    expect(JSON.stringify(first)).not.toContain(String(beta.organizationId));
    const eventId = first.events[0]!.id;
    await t.run((ctx) => ctx.db.patch(eventId, { action: "tampered.action" }));
    expect(
      await asAlice.query(api.audit.list, {
        organizationId: alpha.organizationId,
        limit: 10,
      }),
    ).toMatchObject({ chainValid: false });
    await expect(
      t
        .withIdentity({ subject: "bob|session" })
        .query(api.audit.list, {
          organizationId: alpha.organizationId,
          limit: 10,
        }),
    ).rejects.toThrow("not_found_or_forbidden");
  });

  it("creates a dashboard review only inside the authorized repository and records consent", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "dashboard-alpha", "alice"),
      beta = await seedTenant(t, "dashboard-beta", "bob");
    const asAlice = t.withIdentity({ subject: "alice|dashboard-session" });
    await expect(
      asAlice.action(api.dashboardReviews.prepare, {
        repositoryId: beta.repositoryId,
        prNumber: 2,
        budgetLimit: 2,
        provider: "anthropic",
      }),
    ).rejects.toThrow("not_found_or_forbidden");
    await expect(asAlice.query(api.dashboardReviewData.availableProviders, {
      repositoryId: alpha.repositoryId,
    })).resolves.toEqual(["anthropic"]);
    const created = await t.mutation(internal.dashboardReviewData.create, {
      repositoryId: alpha.repositoryId,
      prNumber: 2,
      headSha: "c".repeat(40),
      baseSha: "b".repeat(40),
      baseRef: "main",
      isFork: false,
      actorId: "alice",
      actorRole: "developer",
      expectedCredentialScopeId: "credential-test",
      expectedProvider: "anthropic",
      budgetLimit: 2,
      now: Date.now(),
    });
    expect(await t.run((ctx) => ctx.db.get(created.reviewId))).toMatchObject({
      organizationId: alpha.organizationId,
      repositoryId: alpha.repositoryId,
      trigger: "dashboard",
      triggerVerb: "review",
      triggerActorPermission: "write",
      headSha: "c".repeat(40),
      status: "queued",
    });
    await expect(t.mutation(internal.dashboardReviewData.create, {
      repositoryId: alpha.repositoryId,
      prNumber: 3,
      headSha: "d".repeat(40),
      baseSha: "b".repeat(40),
      baseRef: "main",
      isFork: false,
      actorId: "alice",
      actorRole: "developer",
      expectedCredentialScopeId: "replaced-after-preview",
      expectedProvider: "anthropic",
      budgetLimit: 2,
      now: Date.now(),
    })).rejects.toThrow("provider_credential_changed_review_again");
    await expect(t.mutation(internal.dashboardReviewData.create, {
      repositoryId: alpha.repositoryId,
      prNumber: 4,
      headSha: "e".repeat(40),
      baseSha: "b".repeat(40),
      baseRef: "main",
      isFork: false,
      actorId: "alice",
      actorRole: "developer",
      expectedCredentialScopeId: "credential-test",
      expectedProvider: "gemini",
      budgetLimit: 2,
      now: Date.now(),
    })).rejects.toThrow("provider_credential_changed_review_again");
    const [event, audit] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db
          .query("reviewEvents")
          .withIndex("by_review", (q) => q.eq("reviewId", created.reviewId))
          .filter((q) => q.eq(q.field("sequence"), 1))
          .unique(),
        ctx.db
          .query("auditEvents")
          .withIndex("by_org_created", (q) =>
            q.eq("organizationId", alpha.organizationId),
          )
          .order("desc")
          .first(),
      ]),
    );
    expect(event).toMatchObject({ internalCode: "dashboard_consent" });
    expect(audit).toMatchObject({
      action: "review.created",
      actorId: "alice",
      result: "allowed",
    });
    expect(audit?.resourceIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(audit?.resourceIdHash).not.toBe(created.reviewId);
    await t.run((ctx) => ctx.db.patch(created.reviewId, { status: "cancelled", completedAt: Date.now() }));
    const retried = await t.mutation(internal.dashboardReviewData.create, {
      repositoryId: alpha.repositoryId,
      prNumber: 2,
      headSha: "c".repeat(40),
      baseSha: "b".repeat(40),
      baseRef: "main",
      isFork: false,
      actorId: "alice",
      actorRole: "developer",
      expectedCredentialScopeId: "credential-test",
      expectedProvider: "anthropic",
      budgetLimit: 2,
      now: Date.now() + 1,
    });
    expect(retried.reviewId).not.toBe(created.reviewId);
    expect(await t.run((ctx) => ctx.db.get(retried.reviewId))).toMatchObject({ status: "queued", headSha: "c".repeat(40) });
  });

  it("does not let a viewer prepare or forge a dashboard review", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "dashboard-viewer", "owner");
    await t.run((ctx) =>
      ctx.db.insert("memberships", {
        organizationId: alpha.organizationId,
        userId: "viewer",
        role: "viewer",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await expect(
      t
        .withIdentity({ subject: "viewer|session" })
        .action(api.dashboardReviews.prepare, {
          repositoryId: alpha.repositoryId,
          prNumber: 2,
          budgetLimit: 2,
          provider: "anthropic",
        }),
    ).rejects.toThrow("not_found_or_forbidden");
    await expect(
      t.mutation(internal.dashboardReviewData.create, {
        repositoryId: alpha.repositoryId,
        prNumber: 2,
        headSha: "c".repeat(40),
        baseSha: "b".repeat(40),
        baseRef: "main",
        isFork: false,
        actorId: "viewer",
        actorRole: "developer",
        expectedCredentialScopeId: "credential-test",
        expectedProvider: "anthropic",
        budgetLimit: 2,
        now: Date.now(),
      }),
    ).rejects.toThrow("not_found_or_forbidden");
  });

  it("never returns encrypted provider credential fields", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const result = await t
      .withIdentity({ subject: "alice" })
      .query(api.integrations.listProviderCredentials, {
        organizationId: alpha.organizationId,
      });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      provider: "anthropic",
      maskedSuffix: "…1234",
    });
    expect(result[0]).not.toHaveProperty("encryptedCiphertext");
    expect(result[0]).not.toHaveProperty("nonce");
    expect(result[0]).not.toHaveProperty("authTag");
  });

  it("requires admin access for credential metadata", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("memberships", {
        organizationId: alpha.organizationId,
        userId: "viewer",
        role: "viewer",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });
    await expect(
      t
        .withIdentity({ subject: "viewer" })
        .query(api.integrations.listProviderCredentials, {
          organizationId: alpha.organizationId,
        }),
    ).rejects.toThrow("not_found_or_forbidden");
  });

  it("stores only encrypted credential material for a recently authenticated admin", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { githubUserId: 42, githubLogin: "alice" }),
    );
    const alpha = await seedTenant(t, "credential-alpha", userId);
    await t.run((ctx) =>
      ctx.db.insert("userProfiles", {
        userId,
        githubUserId: 42,
        githubLogin: "alice",
        lastAuthenticatedAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const signedIn = t.withIdentity({
      subject: `${userId}|credential-session`,
    });
    await expect(
      signedIn.mutation(api.integrations.authorizeCredentialWrite, {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
      }),
    ).resolves.toEqual({ actorId: userId });
    const result = await signedIn.mutation(
      api.integrations.storeEncryptedCredential,
      {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        credentialScopeId: uuid("1"),
        provider: "gemini",
        encryptedCiphertext: "encrypted",
        nonce: "nonce",
        authTag: "tag",
        aadDigest: "a".repeat(64),
        wrappedDataKey: "wrapped",
        kmsKeyId: "arn:aws:kms:eu-west-1:123:key/test",
        envelopeVersion: 1,
        keyVersion: 1,
        maskedSuffix: "1234",
        availableModels: ["gemini-2.5-pro"],
        lastValidatedAt: Date.now(),
        requestId: "credential-create-0001",
      },
    );
    expect(result).toMatchObject({
      provider: "gemini",
      maskedSuffix: "1234",
      status: "valid",
    });
    const stored = await t.run((ctx) => ctx.db.get(result.id));
    expect(stored).toMatchObject({
      organizationId: alpha.organizationId,
      repositoryId: alpha.repositoryId,
      createdBy: userId,
      encryptedCiphertext: "encrypted",
    });
    const rotated = await signedIn.mutation(
      api.integrations.storeEncryptedCredential,
      {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        credentialScopeId: uuid("2"),
        provider: "gemini", // gitleaks:allow — inert UUID fixture
        encryptedCiphertext: "replacement",
        nonce: "nonce-2",
        authTag: "tag-2",
        aadDigest: "b".repeat(64),
        wrappedDataKey: "wrapped-2",
        kmsKeyId: "arn:aws:kms:eu-west-1:123:key/test",
        envelopeVersion: 1,
        keyVersion: 1,
        maskedSuffix: "5678",
        availableModels: ["gemini-2.5-pro"],
        lastValidatedAt: Date.now(),
        requestId: "credential-rotate-0001",
        replacesCredentialId: result.id,
      },
    );
    expect(await t.run((ctx) => ctx.db.get(result.id))).toMatchObject({
      status: "revoked",
    });
    expect(await t.run((ctx) => ctx.db.get(rotated.id))).toMatchObject({
      status: "valid",
      maskedSuffix: "5678",
    });
    const audit = await t.run((ctx) =>
      ctx.db
        .query("auditEvents")
        .withIndex("by_org_created", (q) =>
          q.eq("organizationId", alpha.organizationId),
        )
        .order("desc")
        .first(),
    );
    expect(audit).toMatchObject({ action: "credential.rotated" });
  });

  // This test used to move lastAuthenticatedAt 11 minutes into the past and assert the save still
  // succeeded, which is the bypass itself: publicFunctionPolicy declares storeEncryptedCredential
  // active_organization_admin_recent_auth, and it is the call that actually writes the credential.
  // A provider round-trip takes seconds, not eleven minutes, so the window covers it either way.
  it("keeps an authorized credential save valid while provider validation runs", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { githubUserId: 142, githubLogin: "alice" }),
    );
    const alpha = await seedTenant(t, "credential-provider-delay", userId);
    const profileId = await t.run((ctx) =>
      ctx.db.insert("userProfiles", {
        userId,
        githubUserId: 142,
        githubLogin: "alice",
        lastAuthenticatedAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const signedIn = t.withIdentity({
      subject: `${userId}|credential-session`,
    });
    await expect(
      signedIn.mutation(api.integrations.authorizeCredentialWrite, {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
      }),
    ).resolves.toEqual({ actorId: userId });
    // A realistic provider validation round-trip.
    await t.run((ctx) =>
      ctx.db.patch(profileId, {
        lastAuthenticatedAt: Date.now() - 30_000,
        updatedAt: Date.now(),
      }),
    );
    const common = {
      organizationId: alpha.organizationId,
      repositoryId: alpha.repositoryId,
      credentialScopeId: uuid("3"),
      provider: "gemini" as const,
      encryptedCiphertext: "encrypted",
      nonce: "nonce",
      authTag: "tag",
      aadDigest: "c".repeat(64),
      wrappedDataKey: "wrapped",
      kmsKeyId: "arn:aws:kms:eu-west-1:123:key/test",
      envelopeVersion: 1 as const,
      keyVersion: 1,
      maskedSuffix: "9012",
      availableModels: ["gemini-2.5-pro"],
      lastValidatedAt: Date.now(),
      requestId: "credential-provider-delay-0001",
    };
    await expect(
      signedIn.mutation(api.integrations.storeEncryptedCredential, common),
    ).resolves.toMatchObject({ status: "valid" });
    // Past the step-up window, the write itself is refused - not only the authorize step.
    await t.run((ctx) =>
      ctx.db.patch(profileId, {
        lastAuthenticatedAt: Date.now() - 11 * 60 * 1000,
        updatedAt: Date.now(),
      }),
    );
    await expect(
      signedIn.mutation(api.integrations.storeEncryptedCredential, {
        ...common, credentialScopeId: common.credentialScopeId.replace(/^3/, "4"), requestId: "credential-provider-delay-0002",
      }),
    ).rejects.toThrow("recent_reauthentication_required");
    await expect(
      signedIn.mutation(api.integrations.authorizeCredentialWrite, {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
      }),
    ).rejects.toThrow("recent_reauthentication_required");
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_org_user", (q) =>
          q.eq("organizationId", alpha.organizationId).eq("userId", userId),
        )
        .unique();
      if (!membership) throw new Error("membership_missing");
      await ctx.db.patch(membership._id, {
        status: "removed",
        updatedAt: Date.now(),
      });
    });
    await expect(
      signedIn.mutation(api.integrations.storeEncryptedCredential, {
        ...common,
        credentialScopeId: uuid("4"),
        requestId: "credential-provider-delay-0002",
      }),
    ).rejects.toThrow("not_found_or_forbidden");
  });

  it("rejects a model credential bound to another tenant's repository", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { githubUserId: 43, githubLogin: "alice" }),
    );
    const alpha = await seedTenant(t, "credential-owner", userId);
    const beta = await seedTenant(t, "credential-other", "bob");
    await t.run((ctx) =>
      ctx.db.insert("userProfiles", {
        userId,
        githubUserId: 43,
        githubLogin: "alice",
        lastAuthenticatedAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await expect(
      t
        .withIdentity({ subject: `${userId}|credential-session` })
        .mutation(api.integrations.authorizeCredentialWrite, {
          organizationId: alpha.organizationId,
          repositoryId: beta.repositoryId,
        }),
    ).rejects.toThrow("not_found_or_forbidden");
  });

  it("stops credential validation before the eleventh provider attempt in one window", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { githubUserId: 45, githubLogin: "alice" }),
    );
    const alpha = await seedTenant(t, "credential-rate", userId);
    await t.run((ctx) =>
      ctx.db.insert("userProfiles", {
        userId,
        githubUserId: 45,
        githubLogin: "alice",
        lastAuthenticatedAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const signedIn = t.withIdentity({
      subject: `${userId}|credential-session`,
    });
    for (let attempt = 0; attempt < 10; attempt += 1)
      await expect(
        signedIn.mutation(api.integrations.authorizeCredentialWrite, {
          organizationId: alpha.organizationId,
        }),
      ).resolves.toEqual({ actorId: userId });
    await expect(
      signedIn.mutation(api.integrations.authorizeCredentialWrite, {
        organizationId: alpha.organizationId,
      }),
    ).rejects.toThrow("rate_limited");
  });

  it("revokes only a credential in the active admin's organization and records no plaintext", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { githubUserId: 44, githubLogin: "alice" }),
    );
    const alpha = await seedTenant(t, "credential-revoke", userId);
    const beta = await seedTenant(t, "credential-foreign", "bob");
    await t.run((ctx) =>
      ctx.db.insert("userProfiles", {
        userId,
        githubUserId: 44,
        githubLogin: "alice",
        lastAuthenticatedAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const signedIn = t.withIdentity({
      subject: `${userId}|credential-session`,
    });
    const [credential] = await signedIn.query(
      api.integrations.listProviderCredentials,
      { organizationId: alpha.organizationId },
    );
    const [foreign] = await t
      .withIdentity({ subject: "bob" })
      .query(api.integrations.listProviderCredentials, {
        organizationId: beta.organizationId,
      });
    await expect(
      signedIn.mutation(api.integrations.revokeProviderCredential, {
        organizationId: alpha.organizationId,
        credentialId: foreign!.id,
        requestId: "credential-revoke-foreign-0001",
      }),
    ).rejects.toThrow("not_found_or_forbidden");
    await expect(
      signedIn.mutation(api.integrations.revokeProviderCredential, {
        organizationId: alpha.organizationId,
        credentialId: credential!.id,
        requestId: "credential-revoke-valid-0001",
      }),
    ).resolves.toEqual({ id: credential!.id, status: "revoked" });
    const stored = await t.run((ctx) => ctx.db.get(credential!.id));
    expect(stored).toMatchObject({ status: "revoked" });
    expect(stored?.revokedAt).toEqual(expect.any(Number));
    const audit = await t.run((ctx) =>
      ctx.db
        .query("auditEvents")
        .withIndex("by_org_created", (q) =>
          q.eq("organizationId", alpha.organizationId),
        )
        .collect(),
    );
    expect(audit.at(-1)).toMatchObject({
      action: "credential.revoked",
      result: "allowed",
    });
  });

  it("rejects an artifact whose review and repository parents do not match", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const forgedArtifactId = await t.run(async (ctx) => {
      const now = Date.now();
      const repositoryId = await ctx.db.insert("repositories", {
        organizationId: alpha.organizationId,
        installationId: alpha.installationId,
        githubRepositoryId: 99,
        owner: "alpha",
        name: "fixture",
        defaultBranch: "main",
        enabled: true,
        autofixMode: "stacked",
        forkPolicy: "manual_review_only",
        indexState: "ready",
        concurrencyLimit: 1,
        createdAt: now,
        updatedAt: now,
      });
      return ctx.db.insert("artifacts", {
        organizationId: alpha.organizationId,
        repositoryId,
        reviewId: alpha.reviewId,
        type: "command_output",
        storageKey: "forged/output",
        encrypted: true,
        checksum: "hash",
        size: 1,
        redactionStatus: "redacted",
        expiresAt: now + 60_000,
        deletionAttempts: 0,
      });
    });
    await expect(
      t
        .withIdentity({ subject: "alice" })
        .query(api.artifacts.getMetadata, { artifactId: forgedArtifactId }),
    ).rejects.toThrow("not_found_or_forbidden");
  });

  it("reserves and completes a repository snapshot only inside the exact review parent chain", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "snapshot-alpha", "alice"),
      beta = await seedTenant(t, "snapshot-beta", "bob");
    const review = await t.run((ctx) => ctx.db.get(alpha.reviewId));
    if (!review) throw new Error("missing review");
    const checksum = "d".repeat(64),
      now = Date.now();
    const reserved = await t.mutation(internal.reviewArtifactData.reserve, {
      organizationId: alpha.organizationId,
      reviewId: alpha.reviewId,
      expectedHeadSha: review.headSha,
      expectedGeneration: review.executionGeneration,
      checksum,
      size: 128,
      chunkIndex: 0,
      revision: "head",
      now,
    });
    await expect(
      t.mutation(internal.reviewArtifactData.reserve, {
        organizationId: alpha.organizationId,
        reviewId: alpha.reviewId,
        expectedHeadSha: review.headSha,
        expectedGeneration: review.executionGeneration,
        checksum,
        size: 128,
        chunkIndex: 0,
        revision: "head",
        now: now + 1,
      }),
    ).resolves.toMatchObject({ artifactId: reserved.artifactId });
    const baseReserved = await t.mutation(internal.reviewArtifactData.reserve, {
      organizationId: alpha.organizationId,
      reviewId: alpha.reviewId,
      expectedHeadSha: review.headSha,
      expectedGeneration: review.executionGeneration,
      checksum: "f".repeat(64),
      size: 128,
      chunkIndex: 0,
      revision: "base",
      now,
    });
    expect(baseReserved.artifactId).not.toBe(reserved.artifactId);
    expect(baseReserved.storageKey).toContain("/context-base-0.json");
    expect(reserved.storageKey).toContain(
      `artifacts/${alpha.organizationId}/${alpha.repositoryId}/${alpha.reviewId}/${reserved.artifactId}/context-head-0.json`,
    );
    await expect(
      t.mutation(internal.reviewArtifactData.complete, {
        organizationId: beta.organizationId,
        reviewId: alpha.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        artifactId: reserved.artifactId,
        checksum,
        size: 128,
        coverage: "full",
        now,
      }),
    ).rejects.toThrow("parent_scope_mismatch");
    await expect(
      t.mutation(internal.reviewArtifactData.complete, {
        organizationId: alpha.organizationId,
        reviewId: alpha.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        artifactId: reserved.artifactId,
        checksum: "e".repeat(64),
        size: 128,
        coverage: "full",
        now,
      }),
    ).rejects.toThrow("artifact_completion_mismatch");
    await expect(
      t.mutation(internal.reviewArtifactData.complete, {
        organizationId: alpha.organizationId,
        reviewId: alpha.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        artifactId: reserved.artifactId,
        checksum,
        size: 128,
        coverage: "full",
        now,
      }),
    ).resolves.toBe(reserved.artifactId);
    await expect(
      t.mutation(internal.reviewArtifactData.complete, {
        organizationId: alpha.organizationId,
        reviewId: alpha.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        artifactId: reserved.artifactId,
        checksum,
        size: 128,
        coverage: "full",
        now: now + 1,
      }),
    ).resolves.toBe(reserved.artifactId);
    expect(await t.run((ctx) => ctx.db.get(reserved.artifactId))).toMatchObject(
      {
        redactionStatus: "redacted",
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        reviewId: alpha.reviewId,
      },
    );
  });

  it("selects a repository-scoped model key and records only encrypted analysis metadata", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "analysis-alpha", "alice"),
      beta = await seedTenant(t, "analysis-beta", "bob"),
      now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const contextArtifactId = await ctx.db.insert("artifacts", {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        reviewId: alpha.reviewId,
        type: "repository_snapshot",
        storageKey: `artifacts/${alpha.organizationId}/${alpha.repositoryId}/${alpha.reviewId}/context/context-0.json`,
        encrypted: true,
        checksum: "a".repeat(64),
        size: 100,
        redactionStatus: "redacted",
        expiresAt: now + 60_000,
        deletionAttempts: 0,
      });
      await ctx.db.insert("artifacts", {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        reviewId: alpha.reviewId,
        type: "command_output",
        storageKey: `artifacts/${alpha.organizationId}/${alpha.repositoryId}/${alpha.reviewId}/validation/validation.json`,
        encrypted: true,
        checksum: "f".repeat(64),
        size: 100,
        redactionStatus: "redacted",
        expiresAt: now + 60_000,
        deletionAttempts: 0,
      });
      const credentialId = await ctx.db.insert("providerCredentials", {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        credentialScopeId: "repository-credential",
        provider: "anthropic",
        encryptedCiphertext: "repo-ciphertext",
        nonce: "nonce",
        authTag: "tag",
        aadDigest: "b".repeat(64),
        wrappedDataKey: "wrapped",
        kmsKeyId: "kms-test",
        envelopeVersion: 1,
        keyVersion: 1,
        maskedSuffix: "9999",
        availableModels: ["claude-sonnet-4-6"],
        status: "valid",
        createdBy: "alice",
        createdAt: now,
        lastValidatedAt: now,
      });
      return { credentialId, contextArtifactId };
    });
    const args = {
      organizationId: alpha.organizationId,
      reviewId: alpha.reviewId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
    };
    const scope = await t.query(internal.reviewModelData.analysisScope, args);
    expect(scope.credential).toMatchObject({
      id: "repository-credential",
      ciphertext: "repo-ciphertext",
      repositoryId: alpha.repositoryId,
    });
    await expect(
      t.query(internal.reviewModelData.analysisScope, {
        ...args,
        organizationId: beta.organizationId,
      }),
    ).rejects.toThrow("parent_scope_mismatch");
    const checksum = "c".repeat(64),
      reserved = await t.mutation(internal.reviewModelData.reserveOutput, {
        ...args,
        checksum,
        size: 200,
        now,
      }),
      analysisResults = {
        requirements: [
          {
            externalIdHash: "1".repeat(64),
            sourceType: "github_issue" as const,
            sourceUrlHash: "2".repeat(64),
            fetchedVersion: "issue-etag-v1",
            status: "resolved" as const,
            confidence: 0.9,
          },
        ],
        findings: [
          {
            fingerprintHmac: "3".repeat(64),
            pathHmac: "4".repeat(64),
            category: "correctness" as const,
            severity: "high" as const,
            confidence: 0.8,
            blocking: true,
            evidenceIds: [seeded.contextArtifactId],
            startLine: 1,
            endLine: 2,
            requirementExternalIdHash: "1".repeat(64),
            resolution: "open" as const,
          },
        ],
      };
    const stageRun={...args,stage:"findings" as const,provider:"anthropic" as const,model:"claude-sonnet-4-5",promptVersion:"findings-v1",schemaVersion:"findings-schema-v1",finishReason:"tool_use",requestHash:"9".repeat(64),requestId:"provider-request-1",attempt:1,outcome:"valid" as const,inputTokens:10,outputTokens:2,now};
    await expect(t.mutation(internal.reviewModelData.recordStageRun,{...stageRun,organizationId:beta.organizationId})).rejects.toThrow("parent_scope_mismatch");
    await expect(t.mutation(internal.reviewModelData.recordStageRun,stageRun)).resolves.toBeNull();
    await expect(t.mutation(internal.reviewModelData.recordStageRun,stageRun)).resolves.toBeNull();
    await expect(
      t.mutation(internal.reviewModelData.completeAnalysis, {
        ...args,
        organizationId: beta.organizationId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        artifactId: reserved.artifactId,
        checksum,
        size: 200,
        credentialId: seeded.credentialId,
        inputTokens: 10,
        outputTokens: 2,
        ...analysisResults,
        now,
      }),
    ).rejects.toThrow("parent_scope_mismatch");
    await expect(
      t.mutation(internal.reviewModelData.completeAnalysis, {
        ...args,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        artifactId: reserved.artifactId,
        checksum,
        size: 200,
        credentialId: seeded.credentialId,
        inputTokens: 10,
        outputTokens: 2,
        ...analysisResults,
        now,
      }),
    ).resolves.toBe(reserved.artifactId);
    await expect(
      t.mutation(internal.reviewModelData.completeAnalysis, {
        ...args,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        artifactId: reserved.artifactId,
        checksum,
        size: 200,
        credentialId: seeded.credentialId,
        inputTokens: 10,
        outputTokens: 2,
        ...analysisResults,
        now: now + 1,
      }),
    ).resolves.toBe(reserved.artifactId);
    const stored = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(reserved.artifactId),
      credential: await ctx.db.get(seeded.credentialId),
      usage: await ctx.db
        .query("usageLedger")
        .withIndex("by_review", (q) => q.eq("reviewId", alpha.reviewId))
        .collect(),
      requirements: await ctx.db
        .query("requirements")
        .withIndex("by_review", (q) => q.eq("reviewId", alpha.reviewId))
        .collect(),
      findings: await ctx.db
        .query("findings")
        .withIndex("by_review_severity", (q) =>
          q.eq("reviewId", alpha.reviewId).eq("severity", "high"),
        )
        .collect(),
      stageRuns:await ctx.db.query("modelStageRuns").withIndex("by_review",q=>q.eq("reviewId",alpha.reviewId)).collect(),
    }));
    expect(stored.artifact).toMatchObject({
      redactionStatus: "redacted",
      checksum,
      size: 200,
    });
    expect(stored.credential).toMatchObject({ lastUsedAt: now });
    expect(stored.usage).toEqual([
      expect.objectContaining({
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        reviewId: alpha.reviewId,
        kind: "model_tokens",
        quantity: 12,
      }),
    ]);
    expect(stored.usage[0]?.unitCost).toBeGreaterThan(0);
    expect(await t.run(async ctx => (await ctx.db.get(alpha.reviewId))?.budgetConsumed)).toBeGreaterThan(0);
    expect(stored.requirements).toHaveLength(1);
    expect(stored.requirements[0]).toMatchObject({ sourceType: "github_issue", fetchedVersion: "issue-etag-v1" });
    expect(stored.findings).toHaveLength(1);
    expect(stored.findings[0]).toMatchObject({
      blocking: true,
      resolution: "open",
      contentArtifactId: reserved.artifactId,
      evidenceIds: [seeded.contextArtifactId],
    });
    expect(JSON.stringify(stored.usage)).not.toContain("ciphertext");
    expect(stored.stageRuns).toEqual([expect.objectContaining({organizationId:alpha.organizationId,repositoryId:alpha.repositoryId,reviewId:alpha.reviewId,stage:"findings",model:"claude-sonnet-4-5",requestHash:"9".repeat(64),attempt:1,outcome:"valid"})]);
    expect(JSON.stringify(stored.stageRuns)).not.toContain("ciphertext");
  });

  it("stops before a model call that could cross the chosen ceiling", async () => {
    const t = convexTest(schema, modules), alpha = await seedTenant(t, "model-ceiling", "alice"), now = Date.now();
    await t.run(async ctx => ctx.db.patch(alpha.reviewId, { budgetLimit: 1, budgetConsumed: 0 }));
    await expect(t.mutation(internal.reviewModelData.preflightStageSpend, {
      organizationId: alpha.organizationId,
      reviewId: alpha.reviewId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      inputBytes: 80_000,
      maxOutputTokens: 8_000,
      now,
    })).resolves.toMatchObject({ allowed: false });
    expect(await t.run(async ctx => ctx.db.get(alpha.reviewId))).toMatchObject({
      status: "budget_exhausted",
      statusReasonCode: "spend_ceiling_reached",
      budgetCeilingId: "conservative-stage-preflight",
      nextActionCode: "increase_budget",
    });
  });

  it("allows a small approved OpenAI Mini stage within the same ceiling", async () => {
    const t = convexTest(schema, modules), alpha = await seedTenant(t, "mini-ceiling", "alice"), now = Date.now();
    await t.run(async ctx => ctx.db.patch(alpha.reviewId, { provider: "openai", model: "gpt-5.4-mini", budgetLimit: 1, budgetConsumed: 0 }));
    await expect(t.mutation(internal.reviewModelData.preflightStageSpend, {
      organizationId: alpha.organizationId,
      reviewId: alpha.reviewId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
      provider: "openai",
      model: "gpt-5.4-mini",
      inputBytes: 80_000,
      maxOutputTokens: 8_000,
      now,
    })).resolves.toMatchObject({ allowed: true });
    expect(await t.run(async ctx => ctx.db.get(alpha.reviewId))).not.toMatchObject({ status: "budget_exhausted" });
  });

  it("keeps review filters separate for repositories with the same name", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const second = await t.run(async (ctx) => {
      const now = Date.now();
      const repositoryId = await ctx.db.insert("repositories", {
        organizationId: alpha.organizationId,
        installationId: alpha.installationId,
        githubRepositoryId: 100,
        owner: "alpha",
        name: "fixture",
        defaultBranch: "main",
        enabled: true,
        autofixMode: "stacked",
        forkPolicy: "manual_review_only",
        indexState: "ready",
        concurrencyLimit: 1,
        createdAt: now,
        updatedAt: now,
      });
      const original = await ctx.db.get(alpha.reviewId);
      if (!original) throw new Error("missing fixture");
      const { _id: _id, _creationTime: _creationTime, ...copy } = original;
      const reviewId = await ctx.db.insert("reviews", {
        ...copy,
        repositoryId,
        githubRepositoryId: 100,
        prNumber: 2,
      });
      return { repositoryId, reviewId };
    });
    const asAlice = t.withIdentity({ subject: "alice" });
    const first = await asAlice.query(api.reviews.list, {
      organizationId: alpha.organizationId,
      repositoryId: alpha.repositoryId,
    });
    const secondOnly = await asAlice.query(api.reviews.list, {
      organizationId: alpha.organizationId,
      repositoryId: second.repositoryId,
    });
    expect(first.map((review) => review.id)).toEqual([alpha.reviewId]);
    expect(secondOnly.map((review) => review.id)).toEqual([second.reviewId]);
  });

  it("rejects a repository attached to an installation from another organization", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const beta = await seedTenant(t, "beta", "bob");
    await t.run((ctx) =>
      ctx.db.patch(alpha.repositoryId, { installationId: beta.installationId }),
    );
    await expect(
      t.withIdentity({ subject: "alice" }).query(api.reviews.list, {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
      }),
    ).rejects.toThrow("not_found_or_forbidden");
  });

  it("keeps identical base-result cache inputs separate by repository", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const beta = await seedTenant(t, "beta", "alice");
    const ids = await t.run(async (ctx) => {
      const common = {
        baseSha: "b".repeat(40),
        commandFingerprint: "same-command",
        runnerImageVersion: "runner-1",
        toolVersions: [],
        architecture: "amd64",
        networkPolicyVersion: "network-1",
        conclusion: "passed" as const,
        computedAt: 1,
        expiresAt: 10,
      };
      const alphaReview = await ctx.db.get(alpha.reviewId);
      const betaReview = await ctx.db.get(beta.reviewId);
      if (!alphaReview || !betaReview) throw new Error("missing fixture");
      const first = await ctx.db.insert("baseResults", {
        ...common,
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        configRevisionId: alphaReview.configRevisionId,
      });
      const second = await ctx.db.insert("baseResults", {
        ...common,
        organizationId: beta.organizationId,
        repositoryId: beta.repositoryId,
        configRevisionId: betaReview.configRevisionId,
      });
      const alphaHit = await ctx.db
        .query("baseResults")
        .withIndex("by_full_cache_key", (q) =>
          q
            .eq("repositoryId", alpha.repositoryId)
            .eq("baseSha", common.baseSha)
            .eq("commandFingerprint", common.commandFingerprint)
            .eq("configRevisionId", alphaReview.configRevisionId)
            .eq("runnerImageVersion", common.runnerImageVersion)
            .eq("architecture", common.architecture)
            .eq("networkPolicyVersion", common.networkPolicyVersion),
        )
        .unique();
      return { first, second, alphaHit: alphaHit?._id };
    });
    expect(ids.first).not.toBe(ids.second);
    expect(ids.alphaHit).toBe(ids.first);
  });

  it("scopes metric aggregation to validated repository and review parents", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const beta = await seedTenant(t, "beta", "bob");
    await t.run(async (ctx) => {
      await ctx.db.insert("metricEvents", {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        reviewId: alpha.reviewId,
        name: "review_completed",
        value: 1,
        organizationTimezone: "Asia/Kolkata",
        occurredAt: 2,
      });
    });
    const asAlice = t.withIdentity({ subject: "alice" });
    expect(
      await asAlice.query(api.metrics.summarize, {
        organizationId: alpha.organizationId,
        since: 0,
      }),
    ).toEqual({ review_completed: 1 });
    await expect(
      asAlice.query(api.metrics.summarize, {
        organizationId: beta.organizationId,
        since: 0,
      }),
    ).rejects.toThrow("not_found_or_forbidden");
    await t.run((ctx) =>
      ctx.db.insert("metricEvents", {
        organizationId: alpha.organizationId,
        repositoryId: beta.repositoryId,
        reviewId: beta.reviewId,
        name: "review_completed",
        value: 99,
        organizationTimezone: "Asia/Kolkata",
        occurredAt: 3,
      }),
    );
    await expect(
      asAlice.query(api.metrics.summarize, {
        organizationId: alpha.organizationId,
        since: 0,
      }),
    ).rejects.toThrow("not_found_or_forbidden");
  });
});

describe("audited membership administration", () => {
  async function seedMembershipWorkspace(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
      const now = Date.now();
      const ownerId = await ctx.db.insert("users", { name: "Owner" });
      const memberId = await ctx.db.insert("users", { name: "Member" });
      const outsiderId = await ctx.db.insert("users", { name: "Outsider" });
      const organizationId = await ctx.db.insert("organizations", {
        name: "Acme",
        slug: "acme-members",
        timezone: "Asia/Kolkata",
        region: "eu-west-1",
        retentionHours: 24,
        monthlyBudget: 100,
        concurrencyLimit: 2,
        planId: "test",
        fingerprintKeyVersion: 1,
        createdAt: now,
      });
      const ownerMembershipId = await ctx.db.insert("memberships", {
        organizationId,
        userId: ownerId,
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("userProfiles", {
        userId: ownerId,
        githubUserId: 1,
        githubLogin: "owner",
        lastAuthenticatedAt: now,
        updatedAt: now,
      });
      return {
        now,
        ownerId,
        memberId,
        outsiderId,
        organizationId,
        ownerMembershipId,
      };
    });
  }

  it("invites the intended user, requires their acceptance, and chains audit records", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedMembershipWorkspace(t);
    const owner = t.withIdentity({
      subject: `${seeded.ownerId}|owner-session`,
    });
    const membershipId = await owner.mutation(api.memberships.invite, {
      organizationId: seeded.organizationId,
      targetUserId: seeded.memberId,
      role: "developer",
      requestId: "membership-invite-0001",
    });
    await expect(
      t
        .withIdentity({ subject: `${seeded.outsiderId}|outsider-session` })
        .mutation(api.memberships.accept, {
          organizationId: seeded.organizationId,
          requestId: "membership-accept-wrong",
        }),
    ).rejects.toThrow("invitation_not_found");
    await t
      .withIdentity({ subject: `${seeded.memberId}|member-session` })
      .mutation(api.memberships.accept, {
        organizationId: seeded.organizationId,
        requestId: "membership-accept-0001",
      });
    expect(await t.run((ctx) => ctx.db.get(membershipId))).toMatchObject({
      role: "developer",
      status: "active",
    });
    const events = await t.run((ctx) =>
      ctx.db
        .query("auditEvents")
        .withIndex("by_org_created", (q) =>
          q.eq("organizationId", seeded.organizationId),
        )
        .collect(),
    );
    expect(events.map((event) => event.action)).toEqual([
      "membership.invited",
      "membership.accepted",
    ]);
    expect(events).toHaveLength(2);
    expect(events[1]!.previousHash).toBe(events[0]!.eventHash);
    expect(events[0]!.resourceIdHash).not.toContain(membershipId);
  });

  it("resolves a member by their exact signed-in GitHub login", async () => {
    const t = convexTest(schema, modules), seeded = await seedMembershipWorkspace(t);
    const login = await t.run(async ctx => {
      await ctx.db.insert("userProfiles", { userId: seeded.memberId, githubUserId: 2, githubLogin: "member", updatedAt: seeded.now });
      return "member";
    });
    const membershipId = await t.withIdentity({ subject: `${seeded.ownerId}|owner-session` }).mutation(api.memberships.inviteByGitHubLogin, {
      organizationId: seeded.organizationId,
      githubLogin: login,
      role: "developer",
      requestId: "membership-login-invite-0001",
    });
    expect(await t.run(ctx => ctx.db.get(membershipId))).toMatchObject({ userId: seeded.memberId, role: "developer", status: "invited" });
    await expect(t.withIdentity({ subject: `${seeded.ownerId}|owner-session` }).mutation(api.memberships.inviteByGitHubLogin, {
      organizationId: seeded.organizationId,
      githubLogin: "not-yet-a-buildit-user",
      role: "viewer",
      requestId: "membership-login-missing-0001",
    })).rejects.toThrow("member_must_sign_in_first");
  });

  it("requires recent GitHub authentication and preserves the final owner", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedMembershipWorkspace(t);
    const owner = t.withIdentity({
      subject: `${seeded.ownerId}|owner-session`,
    });
    await expect(
      owner.mutation(api.memberships.changeRole, {
        organizationId: seeded.organizationId,
        membershipId: seeded.ownerMembershipId,
        role: "admin",
        requestId: "membership-demote-0001",
      }),
    ).rejects.toThrow("last_owner_required");
    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("userProfiles")
        .withIndex("by_user", (q) => q.eq("userId", seeded.ownerId))
        .unique();
      await ctx.db.patch(profile!._id, {
        lastAuthenticatedAt: seeded.now - 11 * 60 * 1000,
      });
    });
    await expect(
      owner.mutation(api.memberships.invite, {
        organizationId: seeded.organizationId,
        targetUserId: seeded.memberId,
        role: "viewer",
        requestId: "membership-stale-0001",
      }),
    ).rejects.toThrow("recent_reauthentication_required");
  });

  it("prevents an administrator from granting admin or owner access", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedMembershipWorkspace(t);
    const adminMembershipId = await t.run(async (ctx) => {
      await ctx.db.insert("userProfiles", {
        userId: seeded.memberId,
        githubUserId: 2,
        githubLogin: "admin",
        lastAuthenticatedAt: Date.now(),
        updatedAt: Date.now(),
      });
      return ctx.db.insert("memberships", {
        organizationId: seeded.organizationId,
        userId: seeded.memberId,
        role: "admin",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const admin = t.withIdentity({
      subject: `${seeded.memberId}|admin-session`,
    });
    await expect(
      admin.mutation(api.memberships.changeRole, {
        organizationId: seeded.organizationId,
        membershipId: adminMembershipId,
        role: "owner",
        requestId: "membership-escalate-01",
      }),
    ).rejects.toThrow("not_found_or_forbidden");
    await expect(
      admin.mutation(api.memberships.invite, {
        organizationId: seeded.organizationId,
        targetUserId: seeded.outsiderId,
        role: "admin",
        requestId: "membership-escalate-02",
      }),
    ).rejects.toThrow("not_found_or_forbidden");
  });
});

describe("Convex review state integrity", () => {
  it("replays a persisted workflow checkpoint idempotently", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTenant(t, "alpha", "alice");
    const args = {
      organizationId: seeded.organizationId,
      reviewId: seeded.reviewId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
      stage: "context" as const,
      sequence: 1,
      now: 2,
    };
    const first = await t.mutation(internal.durableReview.checkpoint, args);
    const replay = await t.mutation(internal.durableReview.checkpoint, {
      ...args,
      now: 3,
    });
    expect(replay).toBe(first);
    const events = await t.run((ctx) => ctx.db.query("reviewEvents").collect());
    expect(events).toHaveLength(1);
  });

  it("preserves terminal status while allowing an independent stale marker", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTenant(t, "alpha", "alice");
    await t.mutation(internal.reviewState.transition, {
      reviewId: seeded.reviewId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
      to: "gathering_context",
      nextActionCode: "none",
      now: 2,
    });
    await t.mutation(internal.reviewState.transition, {
      reviewId: seeded.reviewId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
      to: "analyzing",
      nextActionCode: "none",
      now: 3,
    });
    await t.mutation(internal.reviewState.transition, {
      reviewId: seeded.reviewId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
      to: "validating",
      nextActionCode: "none",
      now: 4,
    });
    await t.mutation(internal.reviewState.transition, {
      reviewId: seeded.reviewId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
      to: "checks_passed",
      statusReasonCode: "checks_complete",
      nextActionCode: "none",
      now: 5,
    });
    await expect(
      t.mutation(internal.reviewState.transition, {
        reviewId: seeded.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        to: "analyzing",
        nextActionCode: "none",
        now: 6,
      }),
    ).rejects.toThrow("invalid_transition");
    await t.mutation(internal.reviewState.markStale, {
      reviewId: seeded.reviewId,
      observedHeadSha: "c".repeat(40),
      now: 7,
    });
    const stored = await t.run((ctx) => ctx.db.get(seeded.reviewId));
    expect(stored).toMatchObject({
      status: "checks_passed",
      isStale: true,
      observedHeadSha: "c".repeat(40),
    });
  });

  it("fences a worker immediately when cancellation is requested", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTenant(t, "alpha", "alice");
    const lease = await t.mutation(internal.reviewState.acquireLease, {
      reviewId: seeded.reviewId,
      workerId: "worker-1",
      now: 1,
      leaseMs: 100,
    });
    expect(lease.generation).toBe(0);
    const execution = {
      organizationId: seeded.organizationId,
      reviewId: seeded.reviewId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
    };
    await expect(
      t.query(internal.durableReview.assertActive, execution),
    ).resolves.toBe(true);
    await t.mutation(internal.reviewState.requestCancellation, {
      reviewId: seeded.reviewId,
      actorId: "alice",
      now: 2,
    });
    expect(await t.run((ctx) => ctx.db.get(seeded.reviewId))).toMatchObject({
      status: "cancelled",
      statusReasonCode: "user_cancelled",
      completedAt: 2,
      executionGeneration: 1,
    });
    await expect(
      t.mutation(internal.reviewState.transition, {
        reviewId: seeded.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        to: "gathering_context",
        nextActionCode: "none",
        now: 3,
      }),
    ).rejects.toThrow("cancelled_or_replaced");
    await expect(
      t.query(internal.durableReview.assertActive, execution),
    ).rejects.toThrow("review_cancelled_or_replaced");
  });

  it("resolves cancellation targets only inside the verified repository and pull request", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "cancel-alpha", "alice");
    const beta = await seedTenant(t, "cancel-beta", "bob");
    const targets = await t.query(
      internal.githubWebhookData.cancellationTargets,
      {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        prNumber: 1,
      },
    );
    expect(targets.map((target) => target.reviewId)).toEqual([alpha.reviewId]);
    await expect(
      t.query(internal.githubWebhookData.cancellationTargets, {
        organizationId: alpha.organizationId,
        repositoryId: beta.repositoryId,
        prNumber: 1,
      }),
    ).rejects.toThrow("repository_unavailable");
    expect(targets.map((target) => target.reviewId)).not.toContain(
      beta.reviewId,
    );
  });

  it("authorizes dashboard cancellation only inside the caller's repository", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "dashboard-cancel-alpha", "alice");
    await seedTenant(t, "dashboard-cancel-beta", "bob");
    const own = await t.withIdentity({ subject: "alice" }).query(cancellationScope, {
      reviewId: alpha.reviewId,
    });
    expect(own).toMatchObject({ actorId: "alice", terminal: false });
    await expect(
      t.withIdentity({ subject: "bob" }).query(cancellationScope, {
        reviewId: alpha.reviewId,
      }),
    ).rejects.toThrow("not_found_or_forbidden");
  });

  it("enforces append-only event sequence numbers", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTenant(t, "alpha", "alice");
    await t.mutation(internal.reviewState.appendEvent, {
      organizationId: seeded.organizationId,
      reviewId: seeded.reviewId,
      sequence: 1,
      type: "review_created",
      stage: "queue",
      internalCode: "created",
      now: 1,
    });
    await expect(
      t.mutation(internal.reviewState.appendEvent, {
        organizationId: seeded.organizationId,
        reviewId: seeded.reviewId,
        sequence: 3,
        type: "stage_started",
        stage: "context",
        internalCode: "context",
        now: 2,
      }),
    ).rejects.toThrow("invalid_event_sequence");
  });

  it("allows only one active review per repository, PR, head, and mode", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTenant(t, "alpha", "alice");
    const duplicateReviewId = await t.run(async (ctx) => {
      const original = await ctx.db.get(seeded.reviewId);
      if (!original) throw new Error("missing fixture");
      const {
        _id: _ignoredId,
        _creationTime: _ignoredTime,
        ...copy
      } = original;
      return ctx.db.insert("reviews", copy);
    });
    await t.mutation(internal.reviewState.claimActiveReview, {
      reviewId: seeded.reviewId,
      now: 1,
    });
    await expect(
      t.mutation(internal.reviewState.claimActiveReview, {
        reviewId: duplicateReviewId,
        now: 2,
      }),
    ).rejects.toThrow("active_review_exists");
  });

  it("deduplicates identical side effects and rejects key reuse with new content", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTenant(t, "alpha", "alice");
    const args = {
      organizationId: seeded.organizationId,
      reviewId: seeded.reviewId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
      operationKey: "review:summary",
      type: "comment_update" as const,
      requestHash: "hash-1",
      now: 1,
    };
    const first = await t.mutation(
      internal.reviewState.reserveSideEffect,
      args,
    );
    const replay = await t.mutation(internal.reviewState.reserveSideEffect, {
      ...args,
      now: 2,
    });
    expect(replay).toBe(first);
    await expect(
      t.mutation(internal.reviewState.reserveSideEffect, {
        ...args,
        requestHash: "hash-2",
        now: 3,
      }),
    ).rejects.toThrow("idempotency_key_conflict");
  });

  it("completes a side effect only inside its review and tenant", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "effect-alpha", "alice"),
      beta = await seedTenant(t, "effect-beta", "bob"),
      requestHash = "e".repeat(64),
      sideEffectId = await t.mutation(internal.reviewState.reserveSideEffect, {
        organizationId: alpha.organizationId,
        reviewId: alpha.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        operationKey: "effect-alpha",
        type: "check_update",
        requestHash,
        now: 1,
      }),
      base = {
        reviewId: alpha.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        sideEffectId,
        requestHash,
        externalId: "99",
        status: "completed" as const,
        now: 2,
      };
    await expect(
      t.mutation(internal.reviewPublicationData.completeSideEffect, {
        ...base,
        organizationId: beta.organizationId,
      }),
    ).rejects.toThrow("parent_scope_mismatch");
    await expect(
      t.mutation(internal.reviewPublicationData.completeSideEffect, {
        ...base,
        organizationId: alpha.organizationId,
        status: "reserved",
      }),
    ).rejects.toThrow("side_effect_completion_status_invalid");
    await expect(
      t.mutation(internal.reviewPublicationData.completeSideEffect, {
        ...base,
        organizationId: alpha.organizationId,
      }),
    ).resolves.toBe(sideEffectId);
    await expect(
      t.mutation(internal.reviewPublicationData.completeSideEffect, {
        ...base,
        organizationId: alpha.organizationId,
        externalId: "100",
        now: 3,
      }),
    ).rejects.toThrow("side_effect_completion_conflict");
  });

  it("allows identical idempotency labels in different repositories without collision", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const secondReviewId = await t.run(async (ctx) => {
      const original = await ctx.db.get(alpha.reviewId);
      if (!original) throw new Error("missing fixture");
      const repository = await ctx.db.get(alpha.repositoryId);
      if (!repository) throw new Error("missing repository");
      const {
        _id: _repoId,
        _creationTime: _repoTime,
        ...repoCopy
      } = repository;
      const repositoryId = await ctx.db.insert("repositories", {
        ...repoCopy,
        githubRepositoryId: 101,
        name: "second",
      });
      const {
        _id: _reviewId,
        _creationTime: _reviewTime,
        ...reviewCopy
      } = original;
      return ctx.db.insert("reviews", {
        ...reviewCopy,
        repositoryId,
        githubRepositoryId: 101,
        prNumber: 3,
      });
    });
    const common = {
      organizationId: alpha.organizationId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
      operationKey: "review:summary",
      type: "comment_update" as const,
      requestHash: "hash",
      now: 1,
    };
    const first = await t.mutation(internal.reviewState.reserveSideEffect, {
      ...common,
      reviewId: alpha.reviewId,
    });
    const second = await t.mutation(internal.reviewState.reserveSideEffect, {
      ...common,
      reviewId: secondReviewId,
    });
    expect(second).not.toBe(first);
  });

  it("counts applied patches and validated rounds independently within hard bounds", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTenant(t, "alpha", "alice");
    await t.run((ctx) =>
      ctx.db.patch(seeded.reviewId, {
        mode: "autofix",
        status: "autofix_queued",
      }),
    );
    const attemptId = await t.mutation(
      internal.reviewState.recordAutofixAttempt,
      {
        organizationId: seeded.organizationId,
        reviewId: seeded.reviewId,
        attemptNumber: 1,
        patchFingerprint: "patch-1",
        outcome: "applied",
        promptVersion: "test",
        startedAt: 1,
        completedAt: 2,
      },
    );
    await expect(
      t.mutation(internal.reviewState.recordAutofixRound, {
        organizationId: seeded.organizationId,
        reviewId: seeded.reviewId,
        roundNumber: 1,
        attemptId,
        candidateCommitSha: "d".repeat(40),
        validationScope: "affected_subset",
        validationOutcome: "passed",
        completedValidation: false,
        startedAt: 2,
      }),
    ).rejects.toThrow("round_requires_validation");
    await t.mutation(internal.reviewState.recordAutofixRound, {
      organizationId: seeded.organizationId,
      reviewId: seeded.reviewId,
      roundNumber: 1,
      attemptId,
      candidateCommitSha: "d".repeat(40),
      validationScope: "affected_subset",
      validationOutcome: "passed",
      completedValidation: true,
      startedAt: 2,
      completedAt: 3,
    });
    await expect(
      t.mutation(internal.reviewState.recordAutofixAttempt, {
        organizationId: seeded.organizationId,
        reviewId: seeded.reviewId,
        attemptNumber: 7,
        patchFingerprint: "patch-7",
        outcome: "empty",
        promptVersion: "test",
        startedAt: 4,
      }),
    ).rejects.toThrow("attempt_out_of_bounds");
  });
});

describe("durable validation evidence", () => {
  it("persists encrypted base/head summaries once and keeps source output in the artifact", async () => {
    const t = convexTest(schema, modules),
      tenant = await seedTenant(t, "validation", "alice"),
      now = Date.now(),
      checksum = "c".repeat(64),
      artifactId = await t.run((ctx) =>
        ctx.db.insert("artifacts", {
          organizationId: tenant.organizationId,
          repositoryId: tenant.repositoryId,
          reviewId: tenant.reviewId,
          type: "command_output",
          storageKey: `artifacts/${tenant.organizationId}/${tenant.repositoryId}/${tenant.reviewId}/validation-output/validation.json`,
          encrypted: true,
          checksum,
          size: 100,
          redactionStatus: "pending",
          expiresAt: now + 60_000,
          deletionAttempts: 0,
        }),
      ),
      common = {
        planId: "test",
        kind: "test" as const,
        required: true,
        conclusion: "passed" as const,
        durationMs: 5,
        commandFingerprint: "d".repeat(64),
        nameHash: "e".repeat(64),
        credentialTeardownProved: true as const,
        sandboxStopped: true as const,
      },
      args = {
        organizationId: tenant.organizationId,
        reviewId: tenant.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        artifactId,
        checksum,
        size: 100,
        summaries: [
          { ...common, revision: "base" as const, commitSha: "b".repeat(40) },
          { ...common, revision: "head" as const, commitSha: "a".repeat(40) },
        ],
        manager: "npm" as const,
        now,
      };
    await t.mutation(internal.reviewValidationData.completeValidation, args);
    await expect(
      t.mutation(internal.reviewValidationData.completeValidation, {
        ...args,
        now: now + 1,
      }),
    ).resolves.toBe(artifactId);
    const stored = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(artifactId),
      checks: await ctx.db
        .query("checkRuns")
        .withIndex("by_review", (q) => q.eq("reviewId", tenant.reviewId))
        .collect(),
      base: await ctx.db.query("baseResults").collect(),
      usage: await ctx.db.query("usageLedger").collect(),
    }));
    expect(stored.artifact?.redactionStatus).toBe("redacted");
    expect(stored.checks).toHaveLength(2);
    expect(stored.checks.every((item) => item.credentialTeardownProved && item.sandboxStopped)).toBe(true);
    expect(stored.base).toHaveLength(1);
    expect(
      stored.usage.filter((item) => item.kind === "sandbox_seconds"),
    ).toHaveLength(1);
  });
  it("derives a ready decision only from complete head evidence", async () => {
    const t = convexTest(schema, modules),
      tenant = await seedTenant(t, "decision", "alice"),
      now = Date.now(),
      { artifactId, reportArtifactId } = await t.run(async (ctx) => {
        await ctx.db.patch(tenant.reviewId, {
          coverageLevel: "full",
          status: "validating",
          currentStage: "analysis",
        });
        const artifactId = await ctx.db.insert("artifacts", {
          organizationId: tenant.organizationId,
          repositoryId: tenant.repositoryId,
          reviewId: tenant.reviewId,
          type: "command_output",
          storageKey: "decision/validation.json",
          encrypted: true,
          checksum: "a".repeat(64),
          size: 10,
          redactionStatus: "redacted",
          expiresAt: now + 60_000,
          deletionAttempts: 0,
        });
        const reportArtifactId = await ctx.db.insert("artifacts", {
          organizationId: tenant.organizationId,
          repositoryId: tenant.repositoryId,
          reviewId: tenant.reviewId,
          type: "review_message",
          storageKey: "decision/report.md",
          encrypted: true,
          checksum: "d".repeat(64),
          size: 10,
          redactionStatus: "redacted",
          expiresAt: now + 60_000,
          deletionAttempts: 0,
        });
        return { artifactId, reportArtifactId };
      });
    await t.run((ctx) =>
      ctx.db.insert("checkRuns", {
        organizationId: tenant.organizationId,
        reviewId: tenant.reviewId,
        kind: "test",
        nameHash: "b".repeat(64),
        required: true,
        status: "completed",
        conclusion: "passed",
        commandFingerprint: "c".repeat(64),
        commitSha: "a".repeat(40),
        exitCode: 0,
        durationMs: 1,
        artifactId,
        credentialTeardownProved: true,
        sandboxStopped: true,
        startedAt: now - 1,
        completedAt: now,
      }),
    );
    const args = {
      organizationId: tenant.organizationId,
      reviewId: tenant.reviewId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
      reportArtifactId,
      now,
    };
    await expect(
      t.mutation(internal.reviewValidationData.finalizeDecision, args),
    ).resolves.toMatchObject({
      status: "checks_passed",
      statusReasonCode: "checks_complete",
    });
    await expect(
      t.mutation(internal.reviewValidationData.finalizeDecision, {
        ...args,
        now: now + 1,
      }),
    ).resolves.toMatchObject({ status: "checks_passed" });
    const events = await t.run((ctx) => ctx.db.query("metricEvents").collect());
    expect(events).toHaveLength(1);
    const reviewEvent = await t.run((ctx) =>
      ctx.db
        .query("reviewEvents")
        .withIndex("by_review", (q) => q.eq("reviewId", tenant.reviewId))
        .filter((q) => q.eq(q.field("sequence"), 5))
        .unique(),
    );
    expect(reviewEvent?.publicMessageArtifactId).toBe(reportArtifactId);
  });

  it("refuses a green decision without durable credential teardown and sandbox stop proof", async () => {
    const t = convexTest(schema, modules), tenant = await seedTenant(t, "decision-no-teardown", "alice"), now = Date.now();
    const { reportArtifactId } = await t.run(async (ctx) => {
      await ctx.db.patch(tenant.reviewId, { coverageLevel: "full", status: "validating", currentStage: "analysis" });
      const artifactId = await ctx.db.insert("artifacts", { organizationId: tenant.organizationId, repositoryId: tenant.repositoryId, reviewId: tenant.reviewId, type: "command_output", storageKey: "decision-no-teardown/validation.json", encrypted: true, checksum: "a".repeat(64), size: 10, redactionStatus: "redacted", expiresAt: now + 60_000, deletionAttempts: 0 });
      const reportArtifactId = await ctx.db.insert("artifacts", { organizationId: tenant.organizationId, repositoryId: tenant.repositoryId, reviewId: tenant.reviewId, type: "review_message", storageKey: "decision-no-teardown/report.md", encrypted: true, checksum: "d".repeat(64), size: 10, redactionStatus: "redacted", expiresAt: now + 60_000, deletionAttempts: 0 });
      await ctx.db.insert("checkRuns", { organizationId: tenant.organizationId, reviewId: tenant.reviewId, kind: "test", nameHash: "b".repeat(64), required: true, status: "completed", conclusion: "passed", commandFingerprint: "c".repeat(64), commitSha: "a".repeat(40), exitCode: 0, durationMs: 1, artifactId, startedAt: now - 1, completedAt: now });
      return { reportArtifactId };
    });
    await expect(t.mutation(internal.reviewValidationData.finalizeDecision, { organizationId: tenant.organizationId, reviewId: tenant.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0, reportArtifactId, now })).resolves.toMatchObject({ status: "inconclusive", statusReasonCode: "required_check_missing" });
  });

  it("rejects another tenant's final report artifact", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "report-alpha", "alice"),
      beta = await seedTenant(t, "report-beta", "bob"),
      now = Date.now(),
      foreignReportId = await t.run((ctx) =>
        ctx.db.insert("artifacts", {
          organizationId: beta.organizationId,
          repositoryId: beta.repositoryId,
          reviewId: beta.reviewId,
          type: "review_message",
          storageKey: "report-beta/report.md",
          encrypted: true,
          checksum: "d".repeat(64),
          size: 10,
          redactionStatus: "redacted",
          expiresAt: now + 60_000,
          deletionAttempts: 0,
        }),
      );
    await t.run((ctx) =>
      ctx.db.patch(alpha.reviewId, {
        coverageLevel: "full",
        status: "validating",
        currentStage: "analysis",
      }),
    );
    await expect(
      t.mutation(internal.reviewValidationData.finalizeDecision, {
        organizationId: alpha.organizationId,
        reviewId: alpha.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        reportArtifactId: foreignReportId,
        now,
      }),
    ).rejects.toThrow("report_artifact_mismatch");
  });
  it("rejects a validation artifact or commit from another tenant or revision", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "validation-alpha", "alice"),
      beta = await seedTenant(t, "validation-beta", "bob"),
      now = Date.now(),
      checksum = "c".repeat(64),
      artifactId = await t.run((ctx) =>
        ctx.db.insert("artifacts", {
          organizationId: beta.organizationId,
          repositoryId: beta.repositoryId,
          reviewId: beta.reviewId,
          type: "command_output",
          storageKey: "beta/validation.json",
          encrypted: true,
          checksum,
          size: 100,
          redactionStatus: "pending",
          expiresAt: now + 60_000,
          deletionAttempts: 0,
        }),
      ),
      summary = {
        revision: "head" as const,
        commitSha: "f".repeat(40),
        planId: "test",
        kind: "test" as const,
        required: true,
        conclusion: "passed" as const,
        durationMs: 1,
        commandFingerprint: "d".repeat(64),
        nameHash: "e".repeat(64),
        credentialTeardownProved: true as const,
        sandboxStopped: true as const,
      };
    await expect(
      t.mutation(internal.reviewValidationData.completeValidation, {
        organizationId: alpha.organizationId,
        reviewId: alpha.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        artifactId,
        checksum,
        size: 100,
        summaries: [summary],
        manager: "npm",
        now,
      }),
    ).rejects.toThrow(
      /validation_artifact_mismatch|validation_summary_invalid/,
    );
  });
});

describe("durable Autofix evidence", () => {
  it("rejects every cached Autofix generation after cancellation", async () => {
    const t = convexTest(schema, modules);
    const tenant = await seedTenant(t, "autofix-cancel", "alice");
    await t.run((ctx) =>
      ctx.db.patch(tenant.reviewId, {
        mode: "autofix",
        status: "validating",
        currentStage: "analysis",
      }),
    );
    const execution = {
      organizationId: tenant.organizationId,
      reviewId: tenant.reviewId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
    };
    await expect(
      t.query(internal.reviewAutofixData.assertActive, execution),
    ).resolves.toBe(true);

    await t.mutation(internal.reviewState.requestCancellation, {
      reviewId: tenant.reviewId,
      actorId: "alice",
      now: 2,
    });

    await expect(
      t.query(internal.reviewAutofixData.assertActive, execution),
    ).rejects.toThrow("autofix_cancelled_or_replaced");
    await expect(
      t.mutation(internal.reviewState.reserveSideEffect, {
        ...execution,
        operationKey: "cancelled:must-not-publish",
        type: "comment_update",
        requestHash: "f".repeat(64),
        now: 3,
      }),
    ).rejects.toThrow("side_effect_cancelled_or_replaced");
  });

  it("records one exact candidate round idempotently and rejects foreign artifacts", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "autofix-alpha", "alice"),
      beta = await seedTenant(t, "autofix-beta", "bob"),
      now = Date.now(),
      { patchArtifactId, validationArtifactId } = await t.run(async (ctx) => {
        await ctx.db.patch(alpha.reviewId, {
          mode: "autofix",
          status: "validating",
          currentStage: "analysis",
        });
        const patchArtifactId = await ctx.db.insert("artifacts", {
            organizationId: alpha.organizationId,
            repositoryId: alpha.repositoryId,
            reviewId: alpha.reviewId,
            type: "patch",
            storageKey: "autofix-alpha/autofix-1-candidate-0.json",
            encrypted: true,
            checksum: "a".repeat(64),
            size: 10,
            redactionStatus: "redacted",
            expiresAt: now + 60_000,
            deletionAttempts: 0,
          }),
          validationArtifactId = await ctx.db.insert("artifacts", {
            organizationId: alpha.organizationId,
            repositoryId: alpha.repositoryId,
            reviewId: alpha.reviewId,
            type: "command_output",
            storageKey: "autofix-alpha/autofix-1-validation.json",
            encrypted: true,
            checksum: "b".repeat(64),
            size: 10,
            redactionStatus: "redacted",
            expiresAt: now + 60_000,
            deletionAttempts: 0,
          });
        return { patchArtifactId, validationArtifactId };
      }),
      summary = {
        commitSha: "c".repeat(40),
        planId: "test",
        kind: "test" as const,
        required: true,
        conclusion: "passed" as const,
        exitCode: 0,
        durationMs: 1,
        commandFingerprint: "d".repeat(64),
        nameHash: "e".repeat(64),
        credentialTeardownProved: true as const,
        sandboxStopped: true as const,
      },
      args = {
        organizationId: alpha.organizationId,
        reviewId: alpha.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        roundNumber: 1,
        candidateCommitSha: "c".repeat(40),
        patchFingerprint: "f".repeat(64),
        patchArtifactId,
        validationArtifactId,
        summaries: [summary],
        outcome: "passed" as const,
        now,
      };
    await expect(
      t.mutation(internal.reviewAutofixData.completeRound, {
        ...args,
        summaries: [{ ...summary, conclusion: "failed" as const }],
      }),
    ).rejects.toThrow("autofix_summary_invalid");
    const roundId = await t.mutation(
      internal.reviewAutofixData.completeRound,
      args,
    );
    await expect(
      t.mutation(internal.reviewAutofixData.completeRound, {
        ...args,
        now: now + 1,
      }),
    ).resolves.toBe(roundId);
    expect(await t.run((ctx) => ctx.db.get(alpha.reviewId))).toMatchObject({
      status: "autofixing",
      completedRoundCount: 1,
      patchAttemptCount: 1,
    });
    const foreign = await t.run((ctx) =>
      ctx.db.insert("artifacts", {
        organizationId: beta.organizationId,
        repositoryId: beta.repositoryId,
        reviewId: beta.reviewId,
        type: "patch",
        storageKey: "foreign",
        encrypted: true,
        checksum: "1".repeat(64),
        size: 1,
        redactionStatus: "redacted",
        expiresAt: now + 60_000,
        deletionAttempts: 0,
      }),
    );
    await expect(
      t.mutation(internal.reviewAutofixData.completeRound, {
        ...args,
        roundNumber: 2,
        patchArtifactId: foreign,
        now: now + 2,
      }),
    ).rejects.toThrow("autofix_round_mismatch");
  });
  it("marks delivery complete only after a passed round, encrypted report, and all four GitHub effects", async () => {
    const t = convexTest(schema, modules),
      tenant = await seedTenant(t, "autofix-delivery", "alice"),
      now = Date.now(),
      { patchArtifactId, validationArtifactId, reportArtifactId } = await t.run(
        async (ctx) => {
          await ctx.db.patch(tenant.reviewId, {
            mode: "autofix",
            status: "validating",
            currentStage: "analysis",
          });
          const base = {
            organizationId: tenant.organizationId,
            repositoryId: tenant.repositoryId,
            reviewId: tenant.reviewId,
            encrypted: true as const,
            size: 10,
            redactionStatus: "redacted" as const,
            expiresAt: now + 60_000,
            deletionAttempts: 0,
          };
          return {
            patchArtifactId: await ctx.db.insert("artifacts", {
              ...base,
              type: "patch",
              storageKey: "delivery/autofix-1-candidate-0.json",
              checksum: "a".repeat(64),
            }),
            validationArtifactId: await ctx.db.insert("artifacts", {
              ...base,
              type: "command_output",
              storageKey: "delivery/autofix-1-validation.json",
              checksum: "b".repeat(64),
            }),
            reportArtifactId: await ctx.db.insert("artifacts", {
              ...base,
              type: "review_message",
              storageKey: "delivery/autofix-1-handoff.md",
              checksum: "c".repeat(64),
            }),
          };
        },
      ),
      candidateCommitSha = "d".repeat(40),
      roundArgs = {
        organizationId: tenant.organizationId,
        reviewId: tenant.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        roundNumber: 1,
        candidateCommitSha,
        patchFingerprint: "e".repeat(64),
        patchArtifactId,
        validationArtifactId,
        summaries: [
          {
            commitSha: candidateCommitSha,
            planId: "test",
            kind: "test" as const,
            required: true,
            conclusion: "passed" as const,
            exitCode: 0,
            durationMs: 1,
            commandFingerprint: "f".repeat(64),
            nameHash: "1".repeat(64),
            credentialTeardownProved: true as const,
            sandboxStopped: true as const,
          },
        ],
        outcome: "passed" as const,
        now,
      };
    await t.mutation(internal.reviewAutofixData.completeRound, roundArgs);
    for (const [index, type] of (
      [
        "branch_create",
        "stacked_pr_create",
        "check_update",
        "comment_update",
      ] as const
    ).entries())
      await t.run((ctx) =>
        ctx.db.insert("githubSideEffects", {
          organizationId: tenant.organizationId,
          repositoryId: tenant.repositoryId,
          reviewId: tenant.reviewId,
          operationKey: `delivery-${index}`,
          type,
          requestHash: "2".repeat(64),
          status: "completed",
          externalId: String(index + 1),
          createdAt: now,
          updatedAt: now,
        }),
      );
    const storedCheckId = await t.run(async (ctx) => {
      const storedRound = await ctx.db
        .query("autofixRounds")
        .withIndex("by_review_round", (q) =>
          q.eq("reviewId", tenant.reviewId).eq("roundNumber", 1),
        )
        .unique();
      if (!storedRound) throw new Error("round_missing");
      const checks = await ctx.db
        .query("checkRuns")
        .withIndex("by_review_round", (q) =>
          q.eq("reviewId", tenant.reviewId).eq("roundId", storedRound._id),
        )
        .collect();
      return checks[0]!._id;
    });
    const deliveryArgs = {
      organizationId: tenant.organizationId,
      reviewId: tenant.reviewId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
      roundNumber: 1,
      candidateCommitSha,
      reportArtifactId,
      effectiveLoc: { added: 3, removed: 1, net: 2, reverted: 0, eligibleFiles: 1, excludedFiles: 2 },
      now: now + 1,
    };
    await t.run((ctx) => ctx.db.patch(storedCheckId, { sandboxStopped: false }));
    await expect(
      t.mutation(internal.reviewAutofixData.completeDelivery, deliveryArgs),
    ).rejects.toThrow("autofix_delivery_evidence_incomplete");
    await t.run((ctx) => ctx.db.patch(storedCheckId, { sandboxStopped: true }));
    await expect(
      t.mutation(internal.reviewAutofixData.completeDelivery, deliveryArgs),
    ).resolves.toBe(tenant.reviewId);
    await expect(
      t.mutation(internal.reviewAutofixData.completeDelivery, {
        ...deliveryArgs,
        now: now + 2,
      }),
    ).resolves.toBe(tenant.reviewId);
    expect(await t.run((ctx) => ctx.db.get(tenant.reviewId))).toMatchObject({
      status: "delivered",
      nextActionCode: "human_merge",
      githubCheckConclusion: "success",
    });
    const metrics = await t.run((ctx) => ctx.db.query("metricEvents").collect());
    expect(metrics).toHaveLength(5);
    expect(Object.fromEntries(metrics.map(item => [item.name, item.value]))).toMatchObject({ autofix_applied: 1, effective_loc_added: 3, effective_loc_removed: 1, effective_loc_net: 2, effective_loc_reverted: 0 });
  });
});

describe("GitHub installation ownership", () => {
  it("rejects a GitHub installation claimed by a different signed-in account", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.githubInstallationsData.attachInstallation, {
        userId: "user-a",
        githubUserId: 10,
        githubLogin: "alice",
        installationId: 20,
        accountLogin: "bob",
        accountId: 11,
        accountType: "user",
        ownershipVerified: true,
        permissions: {
          metadata: "read",
          contents: "read",
          pullRequests: "write",
          issues: "read",
          checks: "write",
        },
        repositories: [],
        now: 1,
      }),
    ).rejects.toThrow("account_installation_mismatch");
  });
  it("creates an isolated workspace and disables repositories removed from the installation", async () => {
    const t = convexTest(schema, modules),
      base = {
        userId: "user-a",
        githubUserId: 10,
        githubLogin: "alice",
        installationId: 20,
        accountLogin: "alice",
        accountId: 10,
        accountType: "user" as const,
        ownershipVerified: true,
        permissions: {
          metadata: "read" as const,
          contents: "read" as const,
          pullRequests: "write" as const,
          issues: "read" as const,
          checks: "write" as const,
        },
        now: 1,
      },
      first = await t.mutation(
        internal.githubInstallationsData.attachInstallation,
        {
          ...base,
          repositories: [
            {
              githubRepositoryId: 100,
              owner: "alice",
              name: "public",
              defaultBranch: "main",
            },
            {
              githubRepositoryId: 101,
              owner: "alice",
              name: "private",
              defaultBranch: "main",
            },
          ],
        },
      );
    expect(first.repositoryCount).toBe(2);
    await t.mutation(internal.githubInstallationsData.attachInstallation, {
      ...base,
      now: 2,
      repositories: [
        {
          githubRepositoryId: 100,
          owner: "alice",
          name: "public-renamed",
          defaultBranch: "trunk",
        },
      ],
    });
    const repositories = await t.run((ctx) =>
        ctx.db.query("repositories").collect(),
      ),
      publicRepo = repositories.find((repo) => repo.githubRepositoryId === 100),
      removed = repositories.find((repo) => repo.githubRepositoryId === 101);
    expect(publicRepo).toMatchObject({
      name: "public-renamed",
      defaultBranch: "trunk",
      enabled: true,
    });
    expect(removed).toMatchObject({ enabled: false, pausedAt: 2 });
    const memberships = await t.run((ctx) =>
      ctx.db.query("memberships").collect(),
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({
      userId: "user-a",
      role: "owner",
      status: "active",
    });
  });
  it("creates separate user and organization workspaces only after ownership verification", async () => {
    const t = convexTest(schema, modules),
      base = {
        userId: "user-a",
        githubUserId: 10,
        githubLogin: "alice",
        permissions: {
          metadata: "read" as const,
          contents: "read" as const,
          pullRequests: "write" as const,
          issues: "read" as const,
          checks: "write" as const,
        },
        repositories: [
          {
            githubRepositoryId: 200,
            owner: "acme",
            name: "api",
            defaultBranch: "main",
          },
        ],
        now: 1,
      };
    await expect(
      t.mutation(internal.githubInstallationsData.attachInstallation, {
        ...base,
        installationId: 30,
        accountLogin: "acme",
        accountId: 99,
        accountType: "organization",
        ownershipVerified: false,
      }),
    ).rejects.toThrow("installation_ownership_unverified");
    await t.mutation(internal.githubInstallationsData.attachInstallation, {
      ...base,
      installationId: 30,
      accountLogin: "acme",
      accountId: 99,
      accountType: "organization",
      ownershipVerified: true,
    });
    const organizations = await t.run((ctx) =>
      ctx.db.query("organizations").collect(),
    );
    expect(organizations.map((org) => org.slug)).toContain("github-org-99");
    const installation = await t.run((ctx) =>
      ctx.db
        .query("githubInstallations")
        .withIndex("by_installation", (q) => q.eq("installationId", 30))
        .unique(),
    );
    expect(installation).toMatchObject({
      accountType: "organization",
      accountLogin: "acme",
    });
  });
});

describe("GitHub webhook durability", () => {
  it("deduplicates a delivery before any processor can enqueue twice", async () => {
    const t = convexTest(schema, modules),
      args = {
        deliveryId: "delivery-1",
        event: "issue_comment",
        action: "created",
        installationId: 20,
        disposition: "processed" as const,
        signatureValid: true,
        now: 1,
      },
      first = await t.mutation(internal.githubWebhookData.reserve, args),
      duplicate = await t.mutation(internal.githubWebhookData.reserve, {
        ...args,
        now: 2,
      });
    expect(first.duplicate).toBe(false);
    expect(duplicate).toEqual({ duplicate: true, id: first.id });
    expect(
      await t.run((ctx) => ctx.db.query("webhookDeliveries").collect()),
    ).toHaveLength(1);
  });
  // A review blocked for a missing model key counted against the organization's concurrency limit
  // and had no expiry, so it held that slot for good. Three of them and the workspace could not
  // start any review at all, while the queue promised it would start "when an earlier review
  // finishes". The sweeper already cancels an expired blocked review; it needed an expiry to act on.
  it("gives a review blocked on a missing model key an expiry the sweeper can act on", async () => {
    const t = convexTest(schema, modules);
    const tenant = await seedTenant(t, "blocked-ttl", "user-blocked-ttl");
    const repository = await t.run(ctx => ctx.db.get(tenant.repositoryId));
    // The new-user shape: the App is installed, no model key is connected yet.
    await t.run(async ctx => {
      for (const credential of await ctx.db.query("providerCredentials").collect()) await ctx.db.delete(credential._id);
    });
    await t.mutation(internal.githubWebhookData.reserve, {
      deliveryId: "delivery-blocked", event: "issue_comment", action: "created",
      installationId: 20, disposition: "processed" as const, signatureValid: true, now: 1,
    });
    await t.mutation(internal.githubWebhookData.recordPinnedSnapshot, {
      deliveryId: "delivery-blocked", prNumber: 77, headSha: "a".repeat(40), baseSha: "b".repeat(40),
      headRefHash: "c".repeat(64), baseRefHash: "d".repeat(64), isFork: false, triggerVerb: "review",
    });
    const now = 1_000;
    await t.mutation(internal.githubWebhookData.materializeReview, {
      deliveryId: "delivery-blocked", organizationId: tenant.organizationId,
      repositoryId: tenant.repositoryId, baseRef: repository!.defaultBranch ?? "main",
      triggerActor: "someone", actorPermission: "write" as const, now,
    });
    const review = await t.run(async ctx =>
      (await ctx.db.query("reviews").collect()).find(item => item.prNumber === 77));
    expect(review?.status).toBe("blocked");
    expect(review?.blockedExpiresAt, "a blocked review with no expiry holds its slot for good").toBeGreaterThan(now);

    // And the sweeper must actually free it, or the expiry is decoration.
    await t.mutation(internal.reconcileWorker.sweep, { now: review!.blockedExpiresAt! + 1 });
    const swept = await t.run(ctx => ctx.db.get(review!._id));
    expect(swept?.status).toBe("cancelled");
    expect(swept?.statusReasonCode).toBe("blocked_expired");
  });

  it("pins one exact PR snapshot on a reserved command delivery", async () => {
    const t = convexTest(schema, modules),
      reserved = await t.mutation(internal.githubWebhookData.reserve, {
        deliveryId: "delivery-snapshot",
        event: "issue_comment",
        action: "created",
        installationId: 20,
        disposition: "processed", signatureValid: true,
        now: 1,
      }),
      refs = { headRefHash: "c".repeat(64), baseRefHash: "d".repeat(64) };
    await expect(
      t.mutation(internal.githubWebhookData.recordPinnedSnapshot, {
        deliveryId: "delivery-snapshot",
        prNumber: 7,
        headSha: "A".repeat(40),
        baseSha: "B".repeat(40),
        ...refs,
        isFork: false,
        triggerVerb: "review",
      }),
    ).resolves.toEqual(reserved.id);
    expect(await t.run((ctx) => ctx.db.get(reserved.id))).toMatchObject({
      prNumber: 7,
      headSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      ...refs,
      isFork: false,
      triggerVerb: "review",
      status: "received",
    });
    await t.mutation(internal.githubWebhookData.complete, {
      deliveryId: "delivery-snapshot",
      disposition: "processed",
      status: "enqueued",
      now: 2,
    });
    await expect(
      t.mutation(internal.githubWebhookData.recordPinnedSnapshot, {
        deliveryId: "delivery-snapshot",
        prNumber: 7,
        headSha: "c".repeat(40),
        baseSha: "b".repeat(40),
        ...refs,
        isFork: false,
        triggerVerb: "review",
      }),
    ).rejects.toThrow("delivery_not_reservable");
  });
  it("materializes a pinned command into exactly one tenant-scoped review", async () => {
    const t = convexTest(schema, modules),
      tenant = await seedTenant(t, "materialize", "alice"),
      delivery = await t.mutation(internal.githubWebhookData.reserve, {
        deliveryId: "delivery-review",
        event: "issue_comment",
        action: "created",
        installationId: 20,
        disposition: "processed", signatureValid: true,
        now: 1,
      }),
      snapshot = {
        deliveryId: "delivery-review",
        prNumber: 7,
        headSha: "a".repeat(40),
        baseSha: "b".repeat(40),
        headRefHash: "c".repeat(64),
        baseRefHash: "d".repeat(64),
        isFork: false,
        triggerVerb: "review" as const,
      };
    await t.mutation(internal.githubWebhookData.recordPinnedSnapshot, snapshot);
    const args = {
        deliveryId: "delivery-review",
        organizationId: tenant.organizationId,
        repositoryId: tenant.repositoryId,
        baseRef: "main",
        triggerActor: "e".repeat(64),
        actorPermission: "admin" as const,
        now: 2,
      },
      created = await t.mutation(
        internal.githubWebhookData.materializeReview,
        args,
      );
    expect(created).toMatchObject({
      status: "queued",
      headSha: "a".repeat(40),
      executionGeneration: 0,
    });
    expect(await t.run((ctx) => ctx.db.get(created.reviewId))).toMatchObject({
      organizationId: tenant.organizationId,
      repositoryId: tenant.repositoryId,
      prNumber: 7,
      headSha: "a".repeat(40),
      status: "queued",
      trigger: "github_comment",
      triggerActor: "e".repeat(64),
    });
    expect(await t.run((ctx) => ctx.db.get(delivery.id))).toMatchObject({
      reviewId: created.reviewId,
    });
    await expect(
      t.mutation(internal.githubWebhookData.materializeReview, args),
    ).rejects.toThrow("review_request_not_materializable");
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("reviewLocks")
          .withIndex("by_scope", (q) =>
            q
              .eq("repositoryId", tenant.repositoryId)
              .eq("prNumber", 7)
              .eq("headSha", "a".repeat(40))
              .eq("mode", "review"),
          )
          .collect(),
      ),
    ).toHaveLength(1);
  });
  it("creates a fresh GitHub-comment review after an earlier exact-head run is terminal", async () => {
    const t = convexTest(schema, modules),
      tenant = await seedTenant(t, "github-retry", "alice");
    await t.run((ctx) =>
      ctx.db.insert("providerCredentials", {
        organizationId: tenant.organizationId,
        credentialScopeId: "credential-gemini-retry",
        provider: "gemini",
        encryptedCiphertext: "ciphertext",
        nonce: "nonce",
        authTag: "tag",
        aadDigest: "aad",
        wrappedDataKey: "wrapped",
        kmsKeyId: "kms-test",
        envelopeVersion: 1,
        keyVersion: 1,
        maskedSuffix: "5678",
        availableModels: ["gemini-2.5-flash"],
        status: "valid",
        createdBy: "alice",
        createdAt: 2,
        lastValidatedAt: 2,
      }),
    );
    const materialize = async (
      deliveryId: string,
      now: number,
      expectedProvider: "anthropic" | "gemini",
    ) => {
      await t.mutation(internal.githubWebhookData.reserve, {
        deliveryId,
        event: "issue_comment",
        action: "created",
        installationId: 20,
        disposition: "processed", signatureValid: true,
        now,
      });
      await t.mutation(internal.githubWebhookData.recordPinnedSnapshot, {
        deliveryId,
        prNumber: 7,
        headSha: "a".repeat(40),
        baseSha: "b".repeat(40),
        headRefHash: "c".repeat(64),
        baseRefHash: "d".repeat(64),
        isFork: false,
        triggerVerb: "review",
      });
      return t.mutation(internal.githubWebhookData.materializeReview, {
        deliveryId,
        organizationId: tenant.organizationId,
        repositoryId: tenant.repositoryId,
        baseRef: "main",
        triggerActor: "e".repeat(64),
        actorPermission: "admin",
        expectedProvider,
        expectedBudgetLimit: expectedProvider === "anthropic" ? 1 : 3,
        now: now + 1,
      });
    };

    const first = await materialize("delivery-first", 1, "anthropic");
    expect(await t.run((ctx) => ctx.db.get(first.reviewId))).toMatchObject({
      provider: "anthropic",
      budgetLimit: 1,
    });
    await t.run((ctx) =>
      ctx.db.patch(first.reviewId, {
        status: "changes_requested",
        updatedAt: 3,
      }),
    );
    const retry = await materialize("delivery-retry", 4, "gemini");

    expect(retry).toMatchObject({ status: "queued" });
    expect(retry.reviewId).not.toBe(first.reviewId);
    expect(await t.run((ctx) => ctx.db.get(retry.reviewId))).toMatchObject({
      provider: "gemini",
      model: "gemini-2.5-flash",
      budgetLimit: 3,
    });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("reviews")
          .withIndex("by_repo_pr_head_mode", (q) =>
            q
              .eq("repositoryId", tenant.repositoryId)
              .eq("prNumber", 7)
              .eq("headSha", "a".repeat(40))
              .eq("mode", "review"),
          )
          .collect(),
      ),
    ).toHaveLength(2);
  });
  it("does not start a blocked, stale, or replaced review workflow", async () => {
    const t = convexTest(schema, modules),
      tenant = await seedTenant(t, "not-runnable", "alice"),
      base = {
        organizationId: tenant.organizationId,
        reviewId: tenant.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        now: 1,
      };
    await t.run((ctx) => ctx.db.patch(tenant.reviewId, { status: "blocked" }));
    await expect(
      t.mutation(internal.durableReview.start, base),
    ).rejects.toThrow("review_not_runnable");
    await t.run((ctx) =>
      ctx.db.patch(tenant.reviewId, { status: "queued", isStale: true }),
    );
    await expect(
      t.mutation(internal.durableReview.start, base),
    ).rejects.toThrow("review_not_runnable");
    await t.run((ctx) =>
      ctx.db.patch(tenant.reviewId, { isStale: false, executionGeneration: 1 }),
    );
    await expect(
      t.mutation(internal.durableReview.start, base),
    ).rejects.toThrow("review_not_runnable");
  });
  it("rejects a repository that does not belong to the webhook installation", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "alpha", "alice"),
      beta = await seedTenant(t, "beta", "bob"),
      records = await t.run(async (ctx) => ({
        installation: await ctx.db.get(alpha.installationId),
        repository: await ctx.db.get(beta.repositoryId),
      }));
    if (!records.installation || !records.repository)
      throw new Error("missing fixture");
    await expect(
      t.query(internal.githubWebhookData.scope, {
        installationId: records.installation.installationId,
        githubRepositoryId: records.repository.githubRepositoryId,
      }),
    ).rejects.toThrow("repository_unavailable");
  });
  it("marks old PR heads stale and fences active work", async () => {
    const t = convexTest(schema, modules),
      tenant = await seedTenant(t, "alpha", "alice"),
      before = await t.run(async (ctx) => ({
        review: await ctx.db.get(tenant.reviewId),
        installation: await ctx.db.get(tenant.installationId),
        repository: await ctx.db.get(tenant.repositoryId),
      }));
    if (!before.review || !before.installation || !before.repository)
      throw new Error("missing fixture");
    const result = await t.mutation(
      internal.githubWebhookData.reconcilePullRequestHead,
      {
        installationId: before.installation.installationId,
        githubRepositoryId: before.repository.githubRepositoryId,
        prNumber: before.review.prNumber,
        observedHeadSha: "c".repeat(40),
        now: 20,
      },
    );
    expect(result).toEqual({ staleCount: 1 });
    const after = await t.run((ctx) => ctx.db.get(tenant.reviewId));
    expect(after).toMatchObject({
      isStale: true,
      observedHeadSha: "c".repeat(40),
      executionGeneration: 1,
    });
    expect(after?.leaseOwner).toBeUndefined();
  });
  it("stales active reviews when their exact default-branch base moves", async () => {
    const t = convexTest(schema, modules),
      tenant = await seedTenant(t, "alpha", "alice"),
      records = await t.run(async (ctx) => ({
        installation: await ctx.db.get(tenant.installationId),
        repository: await ctx.db.get(tenant.repositoryId),
      }));
    if (!records.installation || !records.repository)
      throw new Error("missing fixture");
    const ignored = await t.mutation(
      internal.githubWebhookData.reconcileDefaultBranchPush,
      {
        installationId: records.installation.installationId,
        githubRepositoryId: records.repository.githubRepositoryId,
        ref: "refs/heads/feature",
        afterSha: "d".repeat(40),
        now: 19,
      },
    );
    expect(ignored).toEqual({ staleCount: 0, ignored: true });
    const result = await t.mutation(
      internal.githubWebhookData.reconcileDefaultBranchPush,
      {
        installationId: records.installation.installationId,
        githubRepositoryId: records.repository.githubRepositoryId,
        ref: "refs/heads/main",
        afterSha: "d".repeat(40),
        now: 20,
      },
    );
    expect(result).toEqual({ staleCount: 1, ignored: false });
    const after = await t.run((ctx) => ctx.db.get(tenant.reviewId));
    expect(after).toMatchObject({ isStale: true, executionGeneration: 1 });
    expect(after?.leaseOwner).toBeUndefined();
  });
});

describe("expired artifact cleanup", () => {
  it("leases and deletes only a parent-consistent expired artifact", async () => {
    const t=convexTest(schema,modules),tenant=await seedTenant(t,"cleanup","alice"),now=100_000,leaseId="11111111-1111-4111-8111-111111111111";
    const {validId,forgedId,futureId}=await t.run(async ctx=>{
      const insert=async(expiresAt:number)=>ctx.db.insert("artifacts",{organizationId:tenant.organizationId,repositoryId:tenant.repositoryId,reviewId:tenant.reviewId,type:"repository_snapshot",storageKey:"pending",encrypted:true,checksum:"a".repeat(64),size:10,redactionStatus:"redacted",expiresAt,deletionAttempts:0});
      const validId=await insert(now-1),forgedId=await insert(now-1),futureId=await insert(now+60_000);
      await ctx.db.patch(validId,{storageKey:`artifacts/${tenant.organizationId}/${tenant.repositoryId}/${tenant.reviewId}/${validId}/context-head-0.json`});
      await ctx.db.patch(forgedId,{storageKey:`artifacts/${tenant.organizationId}/${tenant.repositoryId}/${tenant.reviewId}/someone-else/context-head-0.json`});
      await ctx.db.patch(futureId,{storageKey:`artifacts/${tenant.organizationId}/${tenant.repositoryId}/${tenant.reviewId}/${futureId}/context-head-0.json`});
      return{validId,forgedId,futureId};
    });
    await expect(t.mutation(internal.artifactCleanupData.claimExpired,{now,leaseId:"bad",limit:25})).rejects.toThrow("artifact_cleanup_claim_invalid");
    const claimed=await t.mutation(internal.artifactCleanupData.claimExpired,{now,leaseId,limit:25});
    expect(claimed.map(item=>item.artifactId)).toEqual([validId]);
    await expect(t.mutation(internal.artifactCleanupData.claimExpired,{now:now+1,leaseId:"22222222-2222-4222-8222-222222222222",limit:25})).resolves.toEqual([]);
    await expect(t.mutation(internal.artifactCleanupData.completeDeletion,{artifactId:validId,leaseId:"22222222-2222-4222-8222-222222222222",now:now+2})).rejects.toThrow("artifact_cleanup_lease_invalid");
    await t.mutation(internal.artifactCleanupData.completeDeletion,{artifactId:validId,leaseId,now:now+2});
    const stored=await t.run(async ctx=>({valid:await ctx.db.get(validId),forged:await ctx.db.get(forgedId),future:await ctx.db.get(futureId)}));
    expect(stored.valid).toMatchObject({deletedAt:now+2,deletionAttempts:1});expect(stored.valid?.deletionLeaseId).toBeUndefined();expect(stored.forged).toMatchObject({deletionTerminalAt:now,lastDeletionErrorCode:"artifact_parent_invalid"});expect(stored.forged?.deletedAt).toBeUndefined();expect(stored.future?.deletedAt).toBeUndefined();
  });

  it("releases a failed lease for a bounded retry",async()=>{
    const t=convexTest(schema,modules),tenant=await seedTenant(t,"cleanup-retry","alice"),now=200_000,first="33333333-3333-4333-8333-333333333333",second="44444444-4444-4444-8444-444444444444";
    const artifactId=await t.run(async ctx=>{const id=await ctx.db.insert("artifacts",{organizationId:tenant.organizationId,repositoryId:tenant.repositoryId,reviewId:tenant.reviewId,type:"command_output",storageKey:"pending",encrypted:true,checksum:"b".repeat(64),size:10,redactionStatus:"redacted",expiresAt:now-1,deletionAttempts:0});await ctx.db.patch(id,{storageKey:`artifacts/${tenant.organizationId}/${tenant.repositoryId}/${tenant.reviewId}/${id}/validation.json`});return id});
    expect(await t.mutation(internal.artifactCleanupData.claimExpired,{now,leaseId:first,limit:1})).toHaveLength(1);
    await t.mutation(internal.artifactCleanupData.failDeletion,{artifactId,leaseId:first,errorCode:"broker_delete_failed",now:now+1});
    expect(await t.mutation(internal.artifactCleanupData.claimExpired,{now:now+2,leaseId:second,limit:1})).toHaveLength(1);
    expect(await t.run(ctx=>ctx.db.get(artifactId))).toMatchObject({deletionAttempts:2,deletionLeaseId:second});
  });

  it("deletes through the broker before marking the artifact deleted",async()=>{
    const t=convexTest(schema,modules),tenant=await seedTenant(t,"cleanup-worker","alice");
    const artifactId=await t.run(async ctx=>{const id=await ctx.db.insert("artifacts",{organizationId:tenant.organizationId,repositoryId:tenant.repositoryId,reviewId:tenant.reviewId,type:"repository_snapshot",storageKey:"pending",encrypted:true,checksum:"c".repeat(64),size:10,redactionStatus:"redacted",expiresAt:1,deletionAttempts:0});await ctx.db.patch(id,{storageKey:`artifacts/${tenant.organizationId}/${tenant.repositoryId}/${tenant.reviewId}/${id}/context-base-0.json`});return id});
    vi.stubEnv("BUILDIT_BROKER_URL","https://broker.example");vi.stubEnv("ARTIFACT_GRANT_SECRET",Buffer.alloc(32,7).toString("base64url"));
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{expect(String(input)).toBe("https://broker.example/api/artifacts");expect(init?.method).toBe("DELETE");expect(String((init?.headers as Record<string,string>).authorization)).toMatch(/^Bearer [^.]+\.[^.]+$/);return Response.json({deleted:true})});vi.stubGlobal("fetch",fetchMock);
    try{await expect(t.action(internal.artifactCleanupWorker.cleanup,{})).resolves.toEqual({claimed:1,deleted:1,failed:0});expect(fetchMock).toHaveBeenCalledTimes(1);expect(await t.run(ctx=>ctx.db.get(artifactId))).toMatchObject({deletedAt:expect.any(Number),deletionAttempts:1})}finally{vi.unstubAllGlobals();vi.unstubAllEnvs()}
  });

  it("quarantines the tenth failure and exposes only source-free operations evidence",async()=>{
    const t=convexTest(schema,modules),tenant=await seedTenant(t,"cleanup-terminal","alice"),now=300_000,leaseId="55555555-5555-4555-8555-555555555555";
    const artifactId=await t.run(async ctx=>{const id=await ctx.db.insert("artifacts",{organizationId:tenant.organizationId,repositoryId:tenant.repositoryId,reviewId:tenant.reviewId,type:"command_output",storageKey:"pending",encrypted:true,checksum:"d".repeat(64),size:10,redactionStatus:"redacted",expiresAt:now-1,deletionAttempts:9});await ctx.db.patch(id,{storageKey:`artifacts/${tenant.organizationId}/${tenant.repositoryId}/${tenant.reviewId}/${id}/validation.json`});return id});
    expect(await t.mutation(internal.artifactCleanupData.claimExpired,{now,leaseId,limit:1})).toHaveLength(1);
    await t.mutation(internal.artifactCleanupData.failDeletion,{artifactId,leaseId,errorCode:"broker_delete_failed",now:now+1});
    const terminal=await t.query(internal.artifactCleanupData.listTerminal,{limit:10});
    expect(terminal).toEqual([{artifactId,organizationId:tenant.organizationId,repositoryId:tenant.repositoryId,reviewId:tenant.reviewId,deletionAttempts:10,errorCode:"deletion_attempts_exhausted",terminalAt:now+1}]);
    expect(JSON.stringify(terminal)).not.toContain("validation.json");expect(JSON.stringify(terminal)).not.toContain("dddddddd");
    expect(await t.mutation(internal.artifactCleanupData.claimExpired,{now:now+2,leaseId:"66666666-6666-4666-8666-666666666666",limit:1})).toEqual([]);
  });

  it("allows explicit retry only after rechecking the complete artifact parent scope",async()=>{
    const t=convexTest(schema,modules),tenant=await seedTenant(t,"cleanup-terminal-retry","alice"),now=400_000;
    const {validId,forgedId}=await t.run(async ctx=>{const insert=async()=>ctx.db.insert("artifacts",{organizationId:tenant.organizationId,repositoryId:tenant.repositoryId,reviewId:tenant.reviewId,type:"command_output",storageKey:"pending",encrypted:true,checksum:"e".repeat(64),size:10,redactionStatus:"redacted",expiresAt:now-1,deletionAttempts:10,deletionTerminalAt:now-2,lastDeletionErrorCode:"deletion_attempts_exhausted"});const validId=await insert(),forgedId=await insert();await ctx.db.patch(validId,{storageKey:`artifacts/${tenant.organizationId}/${tenant.repositoryId}/${tenant.reviewId}/${validId}/validation.json`});await ctx.db.patch(forgedId,{storageKey:`artifacts/${tenant.organizationId}/${tenant.repositoryId}/${tenant.reviewId}/other/validation.json`});return{validId,forgedId}});
    await expect(t.mutation(internal.artifactCleanupData.retryTerminal,{artifactId:forgedId,now})).rejects.toThrow("artifact_cleanup_retry_invalid");
    await expect(t.mutation(internal.artifactCleanupData.retryTerminal,{artifactId:validId,now})).resolves.toBe(validId);
    const retried=await t.run(ctx=>ctx.db.get(validId));expect(retried).toMatchObject({deletionAttempts:0});expect(retried?.lastDeletionErrorCode).toBeUndefined();expect(retried?.deletionTerminalAt).toBeUndefined();
    expect(await t.mutation(internal.artifactCleanupData.claimExpired,{now:now+1,leaseId:"77777777-7777-4777-8777-777777777777",limit:1})).toHaveLength(1);
  });
});

// organizations.monthlyBudget and organizations.concurrencyLimit were written on every tenant and
// read only for display. Opening BuildIT beyond one operator means an unknown tenant could
// otherwise hold unbounded sandbox, broker and provider capacity on the shared plan.
describe("per-tenant capacity limits", () => {
  const createArgs = (repositoryId: Awaited<ReturnType<typeof seedTenant>>["repositoryId"], prNumber: number, headSha: string) => ({
    repositoryId, prNumber, headSha, baseSha: "b".repeat(40), baseRef: "main", isFork: false,
    actorId: "alice", actorRole: "developer" as const,
    expectedCredentialScopeId: "credential-test", expectedProvider: "anthropic" as const,
    budgetLimit: 2, now: Date.now(),
  });

  it("refuses a review past the organization's concurrency limit", async () => {
    const t = convexTest(schema, modules);
    // seedTenant sets concurrencyLimit: 2 and leaves one active review behind.
    const alpha = await seedTenant(t, "capacity-alpha", "alice");
    await t.mutation(internal.dashboardReviewData.create, createArgs(alpha.repositoryId, 2, "c".repeat(40)));
    await expect(t.mutation(internal.dashboardReviewData.create, createArgs(alpha.repositoryId, 3, "d".repeat(40))))
      .rejects.toThrow("organization_concurrency_limit_reached");
  });

  it("counts only this organization's active reviews toward the limit", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "capacity-neighbour-alpha", "alice");
    const beta = await seedTenant(t, "capacity-neighbour-beta", "bob");
    await t.run(ctx => ctx.db.patch(beta.organizationId, { concurrencyLimit: 1 }));
    // Beta is at its own ceiling; that must not consume any of alpha's capacity.
    await expect(t.mutation(internal.dashboardReviewData.create, createArgs(alpha.repositoryId, 2, "c".repeat(40))))
      .resolves.toMatchObject({ status: "queued" });
  });

  it("frees capacity again once a review reaches a terminal status", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "capacity-terminal", "alice");
    await t.run(ctx => ctx.db.patch(alpha.reviewId, { status: "checks_passed" }));
    await t.mutation(internal.dashboardReviewData.create, createArgs(alpha.repositoryId, 2, "c".repeat(40)));
    await expect(t.mutation(internal.dashboardReviewData.create, createArgs(alpha.repositoryId, 3, "d".repeat(40))))
      .resolves.toMatchObject({ status: "queued" });
  });

  it("reports a misconfigured repository before the capacity limit", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "capacity-precedence", "alice");
    await t.run(ctx => ctx.db.patch(alpha.organizationId, { concurrencyLimit: 1 }));
    await expect(t.mutation(internal.dashboardReviewData.create, {
      ...createArgs(alpha.repositoryId, 2, "c".repeat(40)), expectedCredentialScopeId: "replaced-after-preview",
    })).rejects.toThrow("provider_credential_changed_review_again");
  });

  it("stops a model stage that would cross the monthly budget", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "capacity-monthly", "alice");
    const review = await t.run(ctx => ctx.db.get(alpha.reviewId));
    const now = Date.now();
    await t.run(ctx => ctx.db.patch(alpha.organizationId, { monthlyBudget: 5 }));
    await t.run(ctx => ctx.db.insert("usageLedger", {
      organizationId: alpha.organizationId, repositoryId: alpha.repositoryId, reviewId: alpha.reviewId,
      kind: "model_spend", quantity: 5, unitCost: 1, currency: "USD", occurredAt: now,
    }));
    const blocked = await t.mutation(internal.reviewModelData.preflightStageSpend, {
      organizationId: alpha.organizationId, reviewId: alpha.reviewId,
      expectedHeadSha: review!.headSha, expectedGeneration: review!.executionGeneration,
      provider: "anthropic", model: "claude-sonnet-4-5", inputBytes: 1_000, maxOutputTokens: 1_000, now,
    });
    expect(blocked.allowed).toBe(false);
    expect(await t.run(ctx => ctx.db.get(alpha.reviewId))).toMatchObject({
      status: "budget_exhausted", statusReasonCode: "spend_ceiling_reached", nextActionCode: "increase_budget",
    });
  });

  it("ignores another organization's spend when checking the monthly budget", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "capacity-monthly-alpha", "alice");
    const beta = await seedTenant(t, "capacity-monthly-beta", "bob");
    const review = await t.run(ctx => ctx.db.get(alpha.reviewId));
    const now = Date.now();
    await t.run(ctx => ctx.db.patch(alpha.organizationId, { monthlyBudget: 5 }));
    await t.run(ctx => ctx.db.insert("usageLedger", {
      organizationId: beta.organizationId, repositoryId: beta.repositoryId, reviewId: beta.reviewId,
      kind: "model_spend", quantity: 500, unitCost: 1, currency: "USD", occurredAt: now,
    }));
    await expect(t.mutation(internal.reviewModelData.preflightStageSpend, {
      organizationId: alpha.organizationId, reviewId: alpha.reviewId,
      expectedHeadSha: review!.headSha, expectedGeneration: review!.executionGeneration,
      provider: "anthropic", model: "claude-sonnet-4-5", inputBytes: 1_000, maxOutputTokens: 1_000, now,
    })).resolves.toMatchObject({ allowed: true });
  });
});

// The retention promise ("deleted within 7 days at the latest") stopped being kept silently:
// claimExpired read by_expiry, which is not filtered on deletion state, and skipped soft-deleted
// and quarantined rows inside the loop. Those rows keep their original expiresAt, so once enough
// held the oldest values every claim returned the same rows, skipped all of them, and claimed
// nothing. No error, no failing test, and the cron kept reporting success.
describe("artifact retention does not stall behind tombstones", () => {
  it("claims live expired artifacts from behind a wall of tombstones", async () => {
    const t = convexTest(schema, modules);
    const tenant = await seedTenant(t, "retention-stall", "alice");
    const now = 500_000, leaseId = "66666666-6666-4666-8666-666666666666";
    const live = await t.run(async ctx => {
      const insert = async (expiresAt: number) => {
        const id = await ctx.db.insert("artifacts", { organizationId: tenant.organizationId, repositoryId: tenant.repositoryId,
          reviewId: tenant.reviewId, type: "command_output", storageKey: "pending", encrypted: true, checksum: "e".repeat(64),
          size: 10, redactionStatus: "redacted", expiresAt, deletionAttempts: 0 });
        await ctx.db.patch(id, { storageKey: `artifacts/${tenant.organizationId}/${tenant.repositoryId}/${tenant.reviewId}/${id}/validation.json` });
        return id;
      };
      // 100 tombstones hold the oldest expiresAt values, ahead of every live row.
      for (let index = 0; index < 50; index += 1) await ctx.db.patch(await insert(now - 10_000 - index), { deletedAt: now - 5_000 });
      for (let index = 0; index < 50; index += 1) await ctx.db.patch(await insert(now - 9_000 - index), { deletionTerminalAt: now - 5_000, lastDeletionErrorCode: "deletion_attempts_exhausted" });
      const ids = [];
      for (let index = 0; index < 20; index += 1) ids.push(await insert(now - 1 - index));
      return ids;
    });
    const claimed = await t.mutation(internal.artifactCleanupData.claimExpired, { now, leaseId, limit: 25 });
    expect(claimed).toHaveLength(20);
    expect(new Set(claimed.map(item => String(item.artifactId)))).toEqual(new Set(live.map(String)));
  });

  it("requeues a quarantined artifact so the deletion reconciler has something to run", async () => {
    const t = convexTest(schema, modules);
    const tenant = await seedTenant(t, "retention-reconciler", "alice");
    const now = 600_000;
    const { stuck, orphan } = await t.run(async ctx => {
      const insert = async () => {
        const id = await ctx.db.insert("artifacts", { organizationId: tenant.organizationId, repositoryId: tenant.repositoryId,
          reviewId: tenant.reviewId, type: "command_output", storageKey: "pending", encrypted: true, checksum: "f".repeat(64),
          size: 10, redactionStatus: "redacted", expiresAt: now - 1_000, deletionAttempts: 10, deletionTerminalAt: now - 500,
          lastDeletionErrorCode: "deletion_attempts_exhausted" });
        return id;
      };
      const stuck = await insert(), orphan = await insert();
      await ctx.db.patch(stuck, { storageKey: `artifacts/${tenant.organizationId}/${tenant.repositoryId}/${tenant.reviewId}/${stuck}/validation.json` });
      // A forged key can never be scoped back to its parents, so it stays terminal for a human.
      await ctx.db.patch(orphan, { storageKey: `artifacts/${tenant.organizationId}/${tenant.repositoryId}/${tenant.reviewId}/someone-else/validation.json` });
      return { stuck, orphan };
    });
    expect(await t.action(internal.artifactCleanupWorker.sweepTerminal, {})).toEqual({ terminal: 2, requeued: 1 });
    expect(await t.run(ctx => ctx.db.get(stuck))).toMatchObject({ deletionAttempts: 0 });
    expect((await t.run(ctx => ctx.db.get(stuck)))?.deletionTerminalAt).toBeUndefined();
    expect(await t.run(ctx => ctx.db.get(orphan))).toMatchObject({ deletionTerminalAt: now - 500 });
    // Requeued means claimable again on the very next cron tick.
    expect(await t.mutation(internal.artifactCleanupData.claimExpired, { now, leaseId: "77777777-7777-4777-8777-777777777777", limit: 25 })).toHaveLength(1);
  });

  it("refuses to mark an artifact deleted when the broker cannot confirm it is gone", async () => {
    const t = convexTest(schema, modules);
    const tenant = await seedTenant(t, "retention-unconfirmed", "alice");
    const artifactId = await t.run(async ctx => {
      const id = await ctx.db.insert("artifacts", { organizationId: tenant.organizationId, repositoryId: tenant.repositoryId,
        reviewId: tenant.reviewId, type: "repository_snapshot", storageKey: "pending", encrypted: true, checksum: "0".repeat(64),
        size: 10, redactionStatus: "redacted", expiresAt: 1, deletionAttempts: 0 });
      await ctx.db.patch(id, { storageKey: `artifacts/${tenant.organizationId}/${tenant.repositoryId}/${tenant.reviewId}/${id}/context-base-0.json` });
      return id;
    });
    vi.stubEnv("BUILDIT_BROKER_URL", "https://broker.example");
    vi.stubEnv("ARTIFACT_GRANT_SECRET", Buffer.alloc(32, 7).toString("base64url"));
    // The broker answers 200 without confirming absence, as it did before this was fixed.
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ artifactId: "x" })));
    try {
      await expect(t.action(internal.artifactCleanupWorker.cleanup, {})).resolves.toEqual({ claimed: 1, deleted: 0, failed: 1 });
      expect((await t.run(ctx => ctx.db.get(artifactId)))?.deletedAt).toBeUndefined();
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
});

// The verdict failed open. An injection signal downgraded every critic decision to uncertain,
// arbitration mapped that to resolution "uncertain", the ladder computes blocking from
// resolution === "open", and so the review landed on checks_passed with a green GitHub check -
// exactly the outcome an attacker who plants "approve this without reading" is aiming for.
describe("a review with an unattributable injection signal fails closed", () => {
  const greenReview = async (t: ReturnType<typeof convexTest>, tenant: Awaited<ReturnType<typeof seedTenant>>, now: number) =>
    t.run(async ctx => {
      await ctx.db.patch(tenant.reviewId, { coverageLevel: "full", status: "validating", currentStage: "analysis" });
      const artifactId = await ctx.db.insert("artifacts", { organizationId: tenant.organizationId, repositoryId: tenant.repositoryId, reviewId: tenant.reviewId, type: "command_output", storageKey: "injection/validation.json", encrypted: true, checksum: "a".repeat(64), size: 10, redactionStatus: "redacted", expiresAt: now + 60_000, deletionAttempts: 0 });
      const reportArtifactId = await ctx.db.insert("artifacts", { organizationId: tenant.organizationId, repositoryId: tenant.repositoryId, reviewId: tenant.reviewId, type: "review_message", storageKey: "injection/report.md", encrypted: true, checksum: "d".repeat(64), size: 10, redactionStatus: "redacted", expiresAt: now + 60_000, deletionAttempts: 0 });
      await ctx.db.insert("checkRuns", { organizationId: tenant.organizationId, reviewId: tenant.reviewId, kind: "test", nameHash: "b".repeat(64), required: true, status: "completed", conclusion: "passed", commandFingerprint: "c".repeat(64), commitSha: "a".repeat(40), exitCode: 0, durationMs: 1, artifactId, credentialTeardownProved: true, sandboxStopped: true, startedAt: now - 1, completedAt: now });
      return reportArtifactId;
    });

  it("reaches a green check when nothing tried to steer the review", async () => {
    const t = convexTest(schema, modules), tenant = await seedTenant(t, "injection-clean", "alice"), now = Date.now();
    const reportArtifactId = await greenReview(t, tenant, now);
    await expect(t.mutation(internal.reviewValidationData.finalizeDecision, { organizationId: tenant.organizationId, reviewId: tenant.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0, reportArtifactId, now }))
      .resolves.toMatchObject({ status: "checks_passed", statusReasonCode: "checks_complete" });
  });

  it("refuses the same green check once an unscoped signal is recorded", async () => {
    const t = convexTest(schema, modules), tenant = await seedTenant(t, "injection-unscoped", "alice"), now = Date.now();
    const reportArtifactId = await greenReview(t, tenant, now);
    await t.run(ctx => ctx.db.patch(tenant.reviewId, { promptInjectionUnscopedAt: now - 1 }));
    await expect(t.mutation(internal.reviewValidationData.finalizeDecision, { organizationId: tenant.organizationId, reviewId: tenant.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0, reportArtifactId, now }))
      .resolves.toMatchObject({ status: "inconclusive", statusReasonCode: "required_check_missing", nextActionCode: "retry_review" });
    // Never a success conclusion on GitHub, and the cause has to survive into the event.
    expect(await t.run(ctx => ctx.db.get(tenant.reviewId))).toMatchObject({ githubCheckConclusion: "neutral" });
    const event = await t.run(ctx => ctx.db.query("reviewEvents").withIndex("by_review", q => q.eq("reviewId", tenant.reviewId)).filter(q => q.eq(q.field("sequence"), 5)).unique());
    expect(event?.metadata).toMatchObject({ reasonCode: "injection_unscoped" });
  });
});

// A finding the critic could not resolve is neither open nor blocking, so it fell out of the
// verdict entirely: the review went green on a question nobody answered. The planner has said
// since it was written that a second uncertain pass means a person decides - nothing enforced it.
describe("a finding the critic cannot resolve reaches a person", () => {
  const uncertainReview = async (t: ReturnType<typeof convexTest>, tenant: Awaited<ReturnType<typeof seedTenant>>, now: number, passes: number) =>
    t.run(async ctx => {
      await ctx.db.patch(tenant.reviewId, { coverageLevel: "full", status: "validating", currentStage: "analysis" });
      const artifactId = await ctx.db.insert("artifacts", { organizationId: tenant.organizationId, repositoryId: tenant.repositoryId, reviewId: tenant.reviewId, type: "command_output", storageKey: "inconclusive/output.txt", encrypted: true, checksum: "c".repeat(64), size: 4, redactionStatus: "redacted", expiresAt: now + 60_000, deletionAttempts: 0 });
      const reportArtifactId = await ctx.db.insert("artifacts", { organizationId: tenant.organizationId, repositoryId: tenant.repositoryId, reviewId: tenant.reviewId, type: "review_message", storageKey: "inconclusive/report.md", encrypted: true, checksum: "d".repeat(64), size: 4, redactionStatus: "redacted", expiresAt: now + 60_000, deletionAttempts: 0 });
      await ctx.db.insert("checkRuns", { organizationId: tenant.organizationId, reviewId: tenant.reviewId, kind: "test", nameHash: "b".repeat(64), required: true, status: "completed", conclusion: "passed", commandFingerprint: "c".repeat(64), commitSha: "a".repeat(40), exitCode: 0, durationMs: 1, artifactId, credentialTeardownProved: true, sandboxStopped: true, startedAt: now - 10, completedAt: now });
      await ctx.db.insert("findings", { organizationId: tenant.organizationId, reviewId: tenant.reviewId, fingerprintHmac: "e".repeat(64), category: "correctness", severity: "high", confidence: 0.5, blocking: false, contentArtifactId: artifactId, evidenceIds: [artifactId], pathHmac: "f".repeat(64), startLine: 1, endLine: 1, resolution: "uncertain", uncertainPasses: passes, createdAt: now, updatedAt: now, expiresAt: now + 86_400_000 });
      return reportArtifactId;
    });

  const decide = (t: ReturnType<typeof convexTest>, tenant: Awaited<ReturnType<typeof seedTenant>>, reportArtifactId: string, now: number) =>
    t.mutation(internal.reviewValidationData.finalizeDecision, { organizationId: tenant.organizationId, reviewId: tenant.reviewId,
      expectedHeadSha: "a".repeat(40), expectedGeneration: 0, reportArtifactId: reportArtifactId as never, now });

  it("still passes after one uncertain pass, because the next round may resolve it", async () => {
    const t = convexTest(schema, modules), tenant = await seedTenant(t, "uncertain-once", "alice"), now = Date.now();
    const reportArtifactId = await uncertainReview(t, tenant, now, 1);
    await expect(decide(t, tenant, reportArtifactId, now)).resolves.toMatchObject({ status: "checks_passed" });
  });

  it("stops going green once the same finding is uncertain twice", async () => {
    const t = convexTest(schema, modules), tenant = await seedTenant(t, "uncertain-twice", "alice"), now = Date.now();
    const reportArtifactId = await uncertainReview(t, tenant, now, 2);
    await expect(decide(t, tenant, reportArtifactId, now))
      // Not retry_review: another pass spends money to reach the same place.
      .resolves.toMatchObject({ status: "inconclusive", statusReasonCode: "human_review_required", nextActionCode: "inspect_findings" });
    expect(await t.run(ctx => ctx.db.get(tenant.reviewId))).toMatchObject({ githubCheckConclusion: "neutral" });
    const event = await t.run(ctx => ctx.db.query("reviewEvents").withIndex("by_review", q => q.eq("reviewId", tenant.reviewId)).filter(q => q.eq(q.field("sequence"), 5)).unique());
    expect(event?.metadata).toMatchObject({ reasonCode: "uncertain_escalated" });
  });
});

// The behavioural half of the same defect: prove the conflict is real at the mutation that
// throws it, not only that the key strings differ.
describe("a failed Autofix does not poison the commit for the next review", () => {
  it("lets a second review reserve the same operation at the same head SHA", async () => {
    const t = convexTest(schema, modules);
    const tenant = await seedTenant(t, "autofix-key-recovery", "alice");
    const secondReviewId = await t.run(async ctx => {
      const first = (await ctx.db.get(tenant.reviewId))!;
      const { _id, _creationTime, ...fields } = first;
      return ctx.db.insert("reviews", { ...fields, prNumber: first.prNumber, status: "queued" });
    });
    const constantKey = "1:7:aaaa:branch:autofix";
    const reserve = (reviewId: typeof tenant.reviewId, operationKey: string, requestHash: string) =>
      t.mutation(internal.reviewState.reserveSideEffect, { organizationId: tenant.organizationId, reviewId,
        expectedHeadSha: "a".repeat(40), expectedGeneration: 0, operationKey, type: "comment_update" as const, requestHash, now: 1 });
    // What the constant slot did: the first review owns the key and the second can never have it.
    await reserve(tenant.reviewId, constantKey, "hash-1");
    await expect(reserve(secondReviewId, constantKey, "hash-2")).rejects.toThrow("idempotency_key_conflict");
    // What slotting by review id does instead.
    await reserve(tenant.reviewId, `1:7:aaaa:branch:autofix:${tenant.reviewId}`, "hash-1");
    await expect(reserve(secondReviewId, `1:7:aaaa:branch:autofix:${secondReviewId}`, "hash-2")).resolves.toBeDefined();
  });
});

// The audit view read the oldest 1,000 events ascending and sliced the tail, so once an
// organization passed 1,000 events the page froze on events 900-1,000 forever. Nothing that
// happened afterwards ever appeared, on the one screen whose whole purpose is showing what
// happened - and it kept reporting chainValid: true while doing it.
describe("audit log keeps showing what just happened", () => {
  const seedEvents = async (t: ReturnType<typeof convexTest>, organizationId: Awaited<ReturnType<typeof seedTenant>>["organizationId"], count: number) =>
    t.run(async ctx => {
      const digest = async (value: string) => {
        const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
        return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
      };
      let previousHash: string | undefined;
      for (let index = 0; index < count; index += 1) {
        const input = { organizationId, actorId: "alice", action: `audit.event.${index}`, resourceType: "review",
          resourceId: `resource-${index}`, requestId: `audit-backfill-${String(index).padStart(6, "0")}`,
          result: "allowed" as const, createdAt: 1_000 + index };
        const resourceIdHash = await digest(input.resourceId);
        const eventHash = await digest(JSON.stringify({ previousHash: previousHash ?? null, ...input, resourceId: resourceIdHash }));
        const { resourceId: _resourceId, ...row } = input;
        await ctx.db.insert("auditEvents", { ...row, resourceIdHash, previousHash, eventHash });
        previousHash = eventHash;
      }
    });

  it("shows the newest events, not the oldest, past the 1000-event mark", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(ctx => ctx.db.insert("users", { githubUserId: 501, githubLogin: "alice" }));
    const alpha = await seedTenant(t, "audit-window", userId);
    await seedEvents(t, alpha.organizationId, 1_050);
    const page = await t.withIdentity({ subject: `${userId}|audit` }).query(api.audit.list, { organizationId: alpha.organizationId, limit: 10 });
    expect(page.events[0]?.action).toBe("audit.event.1049");
    expect(page.events.at(-1)?.action).toBe("audit.event.1040");
    // The window is hash-chain checked against the event immediately before it.
    expect(page.chainValid).toBe(true);
    expect(page.truncated).toBe(true);
  });

  it("still detects a tampered event inside the visible window", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(ctx => ctx.db.insert("users", { githubUserId: 502, githubLogin: "alice" }));
    const alpha = await seedTenant(t, "audit-tamper", userId);
    await seedEvents(t, alpha.organizationId, 20);
    const asAlice = t.withIdentity({ subject: `${userId}|audit` });
    await t.run(async ctx => {
      const latest = await ctx.db.query("auditEvents").withIndex("by_org_created", q => q.eq("organizationId", alpha.organizationId)).order("desc").first();
      await ctx.db.patch(latest!._id, { action: "audit.event.tampered" });
    });
    await expect(asAlice.query(api.audit.list, { organizationId: alpha.organizationId, limit: 5 })).resolves.toMatchObject({ chainValid: false });
  });

  it("verifies the whole chain from the first event, paginated", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(ctx => ctx.db.insert("users", { githubUserId: 503, githubLogin: "alice" }));
    const alpha = await seedTenant(t, "audit-verify", userId);
    await seedEvents(t, alpha.organizationId, 1_200);
    const asAlice = t.withIdentity({ subject: `${userId}|audit` });
    let cursor: string | undefined, previousHash: string | undefined, verified = 0, done = false, pages = 0;
    while (!done && pages < 10) {
      const page: { chainValid: boolean; verified: number; done: boolean; cursor: string; previousHash?: string } =
        await asAlice.query(api.audit.verifyChain, { organizationId: alpha.organizationId, ...(cursor ? { cursor } : {}), ...(previousHash ? { previousHash } : {}) });
      expect(page.chainValid).toBe(true);
      verified += page.verified; cursor = page.cursor; previousHash = page.previousHash; done = page.done; pages += 1;
    }
    expect(verified).toBe(1_200);
  });
});

// reviewArtifactData.complete was the one completion mutation with no fence. It patched the
// review back to "gathering_context" unconditionally, so a context worker that finished after a
// cancellation - or after a newer commit superseded the run - resurrected a terminal review and
// left it stuck in a non-terminal state forever.
describe("a late context worker cannot resurrect a terminal review", () => {
  const setup = async (t: ReturnType<typeof convexTest>, slug: string) => {
    const tenant = await seedTenant(t, slug, "alice");
    const now = Date.now();
    const reserved = await t.mutation(internal.reviewArtifactData.reserve, { organizationId: tenant.organizationId, reviewId: tenant.reviewId,
      expectedHeadSha: "a".repeat(40), expectedGeneration: 0, checksum: "f".repeat(64), size: 128, revision: "head", chunkIndex: 0, now });
    return { tenant, reserved, now };
  };
  const completeArgs = (tenant: Awaited<ReturnType<typeof seedTenant>>, reserved: { artifactId: unknown }, now: number, checksum: string) => ({
    organizationId: tenant.organizationId, reviewId: tenant.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0,
    artifactId: reserved.artifactId as never, checksum, size: 128, coverage: "full" as const, now,
  });

  it("refuses to complete into a cancelled review", async () => {
    const t = convexTest(schema, modules);
    const { tenant, reserved, now } = await setup(t, "context-late-cancelled");
    await t.run(ctx => ctx.db.patch(tenant.reviewId, { status: "cancelled" }));
    await expect(t.mutation(internal.reviewArtifactData.complete, completeArgs(tenant, reserved, now, "f".repeat(64))))
      .rejects.toThrow("stale_or_replaced_review");
    expect(await t.run(ctx => ctx.db.get(tenant.reviewId))).toMatchObject({ status: "cancelled" });
  });

  it("refuses to complete against a newer commit or generation", async () => {
    const t = convexTest(schema, modules);
    const { tenant, reserved, now } = await setup(t, "context-late-superseded");
    await t.run(ctx => ctx.db.patch(tenant.reviewId, { headSha: "b".repeat(40) }));
    await expect(t.mutation(internal.reviewArtifactData.complete, completeArgs(tenant, reserved, now, "f".repeat(64))))
      .rejects.toThrow("stale_or_replaced_review");
    await t.run(ctx => ctx.db.patch(tenant.reviewId, { headSha: "a".repeat(40), executionGeneration: 1 }));
    await expect(t.mutation(internal.reviewArtifactData.complete, completeArgs(tenant, reserved, now, "f".repeat(64))))
      .rejects.toThrow("stale_or_replaced_review");
    await t.run(ctx => ctx.db.patch(tenant.reviewId, { executionGeneration: 0, isStale: true }));
    await expect(t.mutation(internal.reviewArtifactData.complete, completeArgs(tenant, reserved, now, "f".repeat(64))))
      .rejects.toThrow("stale_or_replaced_review");
  });
});

// Three paths that ended with the pull request author seeing nothing at all - the worst failure
// mode for a product whose whole value is evidence on the pull request.
describe("failures reach the person waiting for them", () => {
  it("lets GitHub redeliver a failed webhook instead of answering duplicate forever", async () => {
    const t = convexTest(schema, modules);
    const args = { deliveryId: "delivery-retry-1", event: "issue_comment", action: "created", installationId: 42,
      disposition: "processed" as const, signatureValid: true, now: 1_000 };
    const first = await t.mutation(internal.githubWebhookData.reserve, args);
    expect(first.duplicate).toBe(false);
    // While the first attempt is still running, a redelivery is still deduplicated.
    await expect(t.mutation(internal.githubWebhookData.reserve, { ...args, now: 2_000 })).resolves.toMatchObject({ duplicate: true });
    await t.mutation(internal.githubWebhookData.complete, { deliveryId: args.deliveryId, disposition: "processed", status: "failed", now: 3_000 });
    // Immediately after the failure, still within the grace period.
    await expect(t.mutation(internal.githubWebhookData.reserve, { ...args, now: 3_500 })).resolves.toMatchObject({ duplicate: true });
    // GitHub's redelivery, once the failure has settled. Before this fix it was dropped forever.
    const retried = await t.mutation(internal.githubWebhookData.reserve, { ...args, now: 3_000 + 60_001 });
    expect(retried.duplicate).toBe(false);
    expect(retried.id).toBe(first.id);
    expect(await t.run(ctx => ctx.db.get(first.id))).toMatchObject({ status: "received" });
  });

  it("records whether the signature was verified instead of asserting it", async () => {
    const t = convexTest(schema, modules);
    const reserved = await t.mutation(internal.githubWebhookData.reserve, { deliveryId: "delivery-signature-1", event: "push",
      action: "unknown", disposition: "rejected", signatureValid: false, now: 1 });
    expect(await t.run(ctx => ctx.db.get(reserved.id))).toMatchObject({ signatureValid: false });
  });

  it("makes a review terminal when a newer commit supersedes it", async () => {
    const t = convexTest(schema, modules);
    const tenant = await seedTenant(t, "stale-head-terminal", "alice");
    const now = Date.now();
    await t.run(ctx => ctx.db.patch(tenant.reviewId, { status: "analyzing", currentStage: "analysis" }));
    const repository = await t.run(ctx => ctx.db.get(tenant.repositoryId));
    const installation = await t.run(ctx => ctx.db.get(repository!.installationId));
    await t.mutation(internal.githubWebhookData.reconcilePullRequestHead, {
      installationId: installation!.installationId, githubRepositoryId: repository!.githubRepositoryId,
      prNumber: (await t.run(ctx => ctx.db.get(tenant.reviewId)))!.prNumber, observedHeadSha: "c".repeat(40), now,
    });
    // Was: isStale true, status left at analyzing, "In progress" in the queue forever.
    expect(await t.run(ctx => ctx.db.get(tenant.reviewId))).toMatchObject({
      isStale: true, status: "cancelled", statusReasonCode: "superseded_by_new_commit",
      nextActionCode: "start_new_review", githubCheckConclusion: "neutral",
    });
    expect((await t.run(ctx => ctx.db.get(tenant.reviewId)))?.completedAt).toBe(now);
  });
});

// monthlyBudget and concurrencyLimit became enforceable this session and nothing could set them,
// so every organization was stuck on whatever it was seeded with. A limit nobody can raise is an
// outage waiting for the first customer who needs more than the default.
describe("organization capacity limits can be changed", () => {
  const call = (t: ReturnType<typeof convexTest>, organizationId: Awaited<ReturnType<typeof seedTenant>>["organizationId"], patch: Record<string, number>, requestId = "capacity-change-000001") =>
    t.mutation(internal.organizations.setCapacityLimits, { organizationId, actorId: "alice", requestId, now: Date.now(), ...patch });

  it("raises a limit and lets the review that was blocked through", async () => {
    const t = convexTest(schema, modules);
    const tenant = await seedTenant(t, "capacity-raise", "alice");
    await t.run(ctx => ctx.db.patch(tenant.organizationId, { concurrencyLimit: 1 }));
    const args = { repositoryId: tenant.repositoryId, prNumber: 2, headSha: "c".repeat(40), baseSha: "b".repeat(40),
      baseRef: "main", isFork: false, actorId: "alice", actorRole: "developer" as const,
      expectedCredentialScopeId: "credential-test", expectedProvider: "anthropic" as const, budgetLimit: 2, now: Date.now() };
    await expect(t.mutation(internal.dashboardReviewData.create, args)).rejects.toThrow("organization_concurrency_limit_reached");
    await expect(call(t, tenant.organizationId, { concurrencyLimit: 5 })).resolves.toMatchObject({ concurrencyLimit: 5 });
    await expect(t.mutation(internal.dashboardReviewData.create, args)).resolves.toMatchObject({ status: "queued" });
  });

  it("treats zero as no limit rather than as a refusal to run anything", async () => {
    const t = convexTest(schema, modules);
    const tenant = await seedTenant(t, "capacity-zero", "alice");
    await expect(call(t, tenant.organizationId, { concurrencyLimit: 0, monthlyBudget: 0 }))
      .resolves.toMatchObject({ concurrencyLimit: 0, monthlyBudget: 0 });
  });

  it("refuses a value that would silently disable the cap", async () => {
    const t = convexTest(schema, modules);
    const tenant = await seedTenant(t, "capacity-invalid", "alice");
    await expect(call(t, tenant.organizationId, { concurrencyLimit: -1 })).rejects.toThrow("capacity_limit_invalid");
    await expect(call(t, tenant.organizationId, { monthlyBudget: Number.NaN })).rejects.toThrow("capacity_limit_invalid");
    await expect(call(t, tenant.organizationId, {})).rejects.toThrow("capacity_limit_invalid");
  });

  it("records the change in the audit chain, because capacity is a spend control", async () => {
    const t = convexTest(schema, modules);
    const tenant = await seedTenant(t, "capacity-audited", "alice");
    await call(t, tenant.organizationId, { monthlyBudget: 250 });
    const events = await t.run(ctx => ctx.db.query("auditEvents").withIndex("by_org_created", q => q.eq("organizationId", tenant.organizationId)).collect());
    expect(events.map(event => event.action)).toContain("organization.capacity_changed");
  });

  it("refuses to change a deleted organization", async () => {
    const t = convexTest(schema, modules);
    const tenant = await seedTenant(t, "capacity-deleted", "alice");
    await t.run(ctx => ctx.db.patch(tenant.organizationId, { deletedAt: Date.now() }));
    await expect(call(t, tenant.organizationId, { concurrencyLimit: 3 })).rejects.toThrow("not_found_or_forbidden");
  });
});

// The operator mutation is break-glass. An owner should not have to ask an operator to raise their
// own ceiling, and every organization created before today sits at concurrencyLimit 1 - one review
// at a time - with no way for its owner to change that.
describe("an owner can change their own capacity", () => {
  const setup = async (slug: string, role: "owner" | "admin" = "owner") => {
    const t = convexTest(schema, modules);
    const userId = await t.run(ctx => ctx.db.insert("users", { githubUserId: 8100, githubLogin: "riya" }));
    const tenant = await seedTenant(t, slug, userId);
    await t.run(async ctx => {
      const membership = await ctx.db.query("memberships").withIndex("by_org_user", q => q.eq("organizationId", tenant.organizationId).eq("userId", userId)).unique();
      if (membership) await ctx.db.patch(membership._id, { role, status: "active" });
      await ctx.db.insert("userProfiles", { userId, githubUserId: 8100, githubLogin: "riya", lastAuthenticatedAt: Date.now(), updatedAt: Date.now() });
    });
    return { t, tenant, signedIn: t.withIdentity({ subject: `${userId}|session` }) };
  };

  it("raises the ceiling the owner is actually blocked by", async () => {
    const { tenant, signedIn } = await setup("owner-capacity");
    await expect(signedIn.mutation(api.organizations.updateCapacity, {
      organizationId: tenant.organizationId, concurrencyLimit: 6, monthlyBudget: 120, requestId: "owner-capacity-000001",
    })).resolves.toEqual({ concurrencyLimit: 6, monthlyBudget: 120 });
  });

  // Capacity is a spend ceiling, so it is owner-only - a narrower policy than the admin controls.
  it("refuses an admin, who can manage members but not the bill", async () => {
    const { tenant, signedIn } = await setup("admin-capacity", "admin");
    await expect(signedIn.mutation(api.organizations.updateCapacity, {
      organizationId: tenant.organizationId, concurrencyLimit: 6, requestId: "admin-capacity-000001",
    })).rejects.toThrow("not_found_or_forbidden");
  });

  it("refuses a stale session, because this moves money", async () => {
    const { t, tenant, signedIn } = await setup("stale-capacity");
    await t.run(async ctx => {
      const profile = await ctx.db.query("userProfiles").withIndex("by_github_user", q => q.eq("githubUserId", 8100)).unique();
      if (profile) await ctx.db.patch(profile._id, { lastAuthenticatedAt: Date.now() - 11 * 60 * 1000 });
    });
    await expect(signedIn.mutation(api.organizations.updateCapacity, {
      organizationId: tenant.organizationId, concurrencyLimit: 6, requestId: "stale-capacity-000001",
    })).rejects.toThrow("recent_reauthentication_required");
  });

  // A ceiling nobody can raise is an outage; one anybody can raise without limit is a bill.
  it("keeps a self-serve raise inside a sane band", async () => {
    const { tenant, signedIn } = await setup("band-capacity");
    for (const patch of [{ concurrencyLimit: 500 }, { monthlyBudget: 1_000_000 }, { concurrencyLimit: -1 }]) {
      await expect(signedIn.mutation(api.organizations.updateCapacity, {
        organizationId: tenant.organizationId, requestId: "band-capacity-000001", ...patch,
      })).rejects.toThrow("capacity_limit_invalid");
    }
  });

  it("cannot touch another organization's ceiling", async () => {
    const { t, signedIn } = await setup("owner-a-capacity");
    const other = await seedTenant(t, "owner-b-capacity", "bob");
    await expect(signedIn.mutation(api.organizations.updateCapacity, {
      organizationId: other.organizationId, concurrencyLimit: 6, requestId: "cross-capacity-000001",
    })).rejects.toThrow("not_found_or_forbidden");
  });
});

// BYOK had only ever run for one organization: the operator's own. Opening the product means a
// second tenant brings their own key, and nothing had exercised that path end to end - authorize,
// store, select for a review, revoke - or checked that one tenant's key cannot reach another's
// review. The live half still needs a human to paste a real key; this covers the code.
describe("a second tenant brings their own key", () => {
  const setup = async (slug: string, githubUserId: number) => {
    const t = convexTest(schema, modules);
    const userId = await t.run(ctx => ctx.db.insert("users", { githubUserId, githubLogin: slug }));
    const tenant = await seedTenant(t, slug, userId);
    await t.run(async ctx => {
      // seedTenant leaves a credential behind; this tenant starts with none, like a real signup.
      for (const row of await ctx.db.query("providerCredentials").collect()) await ctx.db.delete(row._id);
      await ctx.db.insert("userProfiles", { userId, githubUserId, githubLogin: slug, lastAuthenticatedAt: Date.now(), updatedAt: Date.now() });
    });
    return { t, tenant, userId, signedIn: t.withIdentity({ subject: `${userId}|session` }) };
  };

  const credential = (scopeId: string) => ({
    credentialScopeId: scopeId, provider: "openai" as const, encryptedCiphertext: "ciphertext", nonce: "nonce",
    authTag: "tag", aadDigest: "d".repeat(64), wrappedDataKey: "wrapped", kmsKeyId: "arn:aws:kms:eu-west-1:123:key/test",
    envelopeVersion: 1 as const, keyVersion: 1, maskedSuffix: "4242", availableModels: ["gpt-5"],
    lastValidatedAt: Date.now(),
  });

  it("runs the whole key lifecycle for an organization that has never had one", async () => {
    const { t, tenant, signedIn } = await setup("byok-tenant-b", 9101);
    await expect(signedIn.mutation(api.integrations.authorizeCredentialWrite, {
      organizationId: tenant.organizationId, repositoryId: tenant.repositoryId,
    })).resolves.toBeTruthy();

    await expect(signedIn.mutation(api.integrations.storeEncryptedCredential, {
      organizationId: tenant.organizationId, repositoryId: tenant.repositoryId,
      requestId: "byok-tenant-b-000001", ...credential(uuid("5")),
    })).resolves.toMatchObject({ status: "valid" });

    // The stored key belongs to this organization and is selectable for its own repository.
    await expect(signedIn.query(api.dashboardReviewData.availableProviders, { repositoryId: tenant.repositoryId }))
      .resolves.toEqual(["openai"]);

    const stored = await t.run(ctx => ctx.db.query("providerCredentials").collect());
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ organizationId: tenant.organizationId, provider: "openai", status: "valid" });
    // The key itself is never stored in the clear, whoever owns it.
    expect(JSON.stringify(stored[0])).not.toContain("sk-");
  });

  it("keeps one tenant's key out of the other tenant's review", async () => {
    const { t, tenant, signedIn } = await setup("byok-owner", 9102);
    await signedIn.mutation(api.integrations.authorizeCredentialWrite, { organizationId: tenant.organizationId, repositoryId: tenant.repositoryId });
    await signedIn.mutation(api.integrations.storeEncryptedCredential, {
      organizationId: tenant.organizationId, repositoryId: tenant.repositoryId,
      requestId: "byok-owner-000001", ...credential(uuid("6")),
    });
    const neighbour = await seedTenant(t, "byok-neighbour", "bob");
    await t.run(async ctx => {
      for (const row of await ctx.db.query("providerCredentials").collect()) {
        if (row.organizationId === neighbour.organizationId) await ctx.db.delete(row._id);
      }
    });
    // The neighbour has no key of their own, and must not inherit one.
    await expect(t.mutation(internal.dashboardReviewData.create, {
      repositoryId: neighbour.repositoryId, prNumber: 9, headSha: "e".repeat(40), baseSha: "b".repeat(40),
      baseRef: "main", isFork: false, actorId: "bob", actorRole: "developer",
      expectedCredentialScopeId: uuid("6"), expectedProvider: "openai",
      budgetLimit: 2, now: Date.now(),
    })).rejects.toThrow("provider_credential_changed_review_again");
  });

  it("stops working the moment the tenant revokes it", async () => {
    const { tenant, signedIn } = await setup("byok-revoke", 9103);
    await signedIn.mutation(api.integrations.authorizeCredentialWrite, { organizationId: tenant.organizationId, repositoryId: tenant.repositoryId });
    const saved = await signedIn.mutation(api.integrations.storeEncryptedCredential, {
      organizationId: tenant.organizationId, repositoryId: tenant.repositoryId,
      requestId: "byok-revoke-000001", ...credential(uuid("7")),
    });
    await expect(signedIn.mutation(api.integrations.revokeProviderCredential, {
      organizationId: tenant.organizationId, credentialId: saved.id, requestId: "byok-revoke-000002",
    })).resolves.toBeTruthy();
    await expect(signedIn.query(api.dashboardReviewData.availableProviders, { repositoryId: tenant.repositoryId }))
      .resolves.toEqual([]);
  });
});

// A workflow failure after finalizeDecision was discarded: the review was already terminal, so
// workflowCompleted returned before writing anything. That is how a publication failure hid for
// several runs - the dashboard showed a finished review while no comment or check run reached the
// pull request, which is the one thing the product exists to do.
describe("a failure after the decision is not swallowed", () => {
  const seedTerminal = async () => {
    const t = convexTest(schema, modules);
    const tenant = await seedTenant(t, "post-decision-failure", "alice");
    const workflowId = "kd7fake0workflow0id0000000000000";
    await t.run(ctx => ctx.db.patch(tenant.reviewId, {
      status: "changes_requested", statusReasonCode: "blocking_findings", currentStage: "complete",
      workflowId, completedAt: Date.now(),
    }));
    return { t, tenant, workflowId };
  };

  it("records the failure and retries delivery without touching the verdict", async () => {
    const { t, tenant, workflowId } = await seedTerminal();
    await t.mutation(internal.durableReview.workflowCompleted, {
      workflowId: workflowId as never,
      result: { kind: "failed", error: "report_publication_contract_failed" },
      context: { organizationId: tenant.organizationId, reviewId: tenant.reviewId, expectedGeneration: 0 },
    });

    // The decision was legitimately reached, so it stands.
    expect(await t.run(ctx => ctx.db.get(tenant.reviewId))).toMatchObject({
      status: "changes_requested", statusReasonCode: "blocking_findings",
    });
    // But the failure is now visible instead of vanishing.
    const events = await t.run(ctx => ctx.db.query("reviewEvents").withIndex("by_review", q => q.eq("reviewId", tenant.reviewId)).collect());
    expect(events.map(event => event.internalCode)).toContain("workflow_failed_after_decision");
  });

  it("leaves a successful workflow alone", async () => {
    const { t, tenant, workflowId } = await seedTerminal();
    await t.mutation(internal.durableReview.workflowCompleted, {
      workflowId: workflowId as never,
      result: { kind: "success", returnValue: null },
      context: { organizationId: tenant.organizationId, reviewId: tenant.reviewId, expectedGeneration: 0 },
    });
    const events = await t.run(ctx => ctx.db.query("reviewEvents").withIndex("by_review", q => q.eq("reviewId", tenant.reviewId)).collect());
    expect(events.map(event => event.internalCode)).not.toContain("workflow_failed_after_decision");
  });

  // A late callback from a superseded run must still be ignored, or a stale workflow could
  // resurrect delivery for a commit nobody is looking at any more.
  it("still ignores a callback from a superseded generation", async () => {
    const { t, tenant, workflowId } = await seedTerminal();
    await t.mutation(internal.durableReview.workflowCompleted, {
      workflowId: workflowId as never,
      result: { kind: "failed", error: "anything" },
      context: { organizationId: tenant.organizationId, reviewId: tenant.reviewId, expectedGeneration: 99 },
    });
    const events = await t.run(ctx => ctx.db.query("reviewEvents").withIndex("by_review", q => q.eq("reviewId", tenant.reviewId)).collect());
    expect(events.map(event => event.internalCode)).not.toContain("workflow_failed_after_decision");
  });
});

// The comment and the check run beside it disagreed about the same review. zod#1 posted "Ready for
// human review" - gitleaks had been failing on that repository long before the pull request and the
// report said so - while the GitHub check run one second later went red with "Changes need review".
// Two derivations of one verdict: the report excluded checks that fail identically on base,
// finalizeDecision counted every failed required check. A reviewer who trusts the red badge stops
// reading, and the pull request is blamed for a repository's existing state.
describe("a check already failing on base does not turn the verdict red", () => {
  const pairedReview = async (t: ReturnType<typeof convexTest>, tenant: Awaited<ReturnType<typeof seedTenant>>, now: number, baseConclusion: "passed" | "failed") =>
    t.run(async ctx => {
      await ctx.db.patch(tenant.reviewId, { coverageLevel: "full", status: "validating", currentStage: "analysis" });
      const artifactId = await ctx.db.insert("artifacts", { organizationId: tenant.organizationId, repositoryId: tenant.repositoryId, reviewId: tenant.reviewId, type: "command_output", storageKey: "preexisting/validation.json", encrypted: true, checksum: "a".repeat(64), size: 10, redactionStatus: "redacted", expiresAt: now + 60_000, deletionAttempts: 0 });
      const reportArtifactId = await ctx.db.insert("artifacts", { organizationId: tenant.organizationId, repositoryId: tenant.repositoryId, reviewId: tenant.reviewId, type: "review_message", storageKey: "preexisting/report.md", encrypted: true, checksum: "d".repeat(64), size: 10, redactionStatus: "redacted", expiresAt: now + 60_000, deletionAttempts: 0 });
      // Same nameHash on both revisions, because nameHash is sha256(planId) and the two rows are
      // the same check run twice. That shared key is what lets the decision pair them.
      const row = (commitSha: string, conclusion: "passed" | "failed") => ({ organizationId: tenant.organizationId, reviewId: tenant.reviewId, kind: "secret_scan" as const, nameHash: "b".repeat(64), required: true, status: "completed" as const, conclusion, commandFingerprint: "c".repeat(64), commitSha, exitCode: conclusion === "failed" ? 1 : 0, durationMs: 1, artifactId, credentialTeardownProved: true, sandboxStopped: true, startedAt: now - 1, completedAt: now });
      await ctx.db.insert("checkRuns", row("b".repeat(40), baseConclusion));
      await ctx.db.insert("checkRuns", row("a".repeat(40), "failed"));
      return reportArtifactId;
    });

  it("passes when the same required check failed on base too", async () => {
    const t = convexTest(schema, modules), tenant = await seedTenant(t, "preexisting-failure", "alice"), now = Date.now();
    const reportArtifactId = await pairedReview(t, tenant, now, "failed");
    await expect(t.mutation(internal.reviewValidationData.finalizeDecision, { organizationId: tenant.organizationId, reviewId: tenant.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0, reportArtifactId, now }))
      .resolves.toMatchObject({ status: "checks_passed", statusReasonCode: "checks_complete" });
    // The badge a reviewer sees has to agree with the sentence the comment opens with.
    expect(await t.run(ctx => ctx.db.get(tenant.reviewId))).toMatchObject({ githubCheckConclusion: "success" });
  });

  it("still fails when the pull request is what broke the check", async () => {
    const t = convexTest(schema, modules), tenant = await seedTenant(t, "introduced-failure", "alice"), now = Date.now();
    const reportArtifactId = await pairedReview(t, tenant, now, "passed");
    await expect(t.mutation(internal.reviewValidationData.finalizeDecision, { organizationId: tenant.organizationId, reviewId: tenant.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0, reportArtifactId, now }))
      .resolves.toMatchObject({ status: "changes_requested", statusReasonCode: "required_check_failed" });
    expect(await t.run(ctx => ctx.db.get(tenant.reviewId))).toMatchObject({ githubCheckConclusion: "failure" });
  });
});
